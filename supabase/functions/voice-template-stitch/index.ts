// Voice template stitcher.
// Concatena os blocos (audio fixo + slot de nome) em UM ÚNICO OGG/Opus
// e devolve a URL final. Usa cache (voice_template_renders) por
// (template_id, name_normalized).
//
// Estratégia de concatenação: byte-concat dos arquivos OGG/Opus.
// Funciona porque o gravador (opus-recorder) usa SEMPRE os mesmos
// parâmetros (mono 16 kHz, frame 20 ms). WhatsApp/Whapi aceitam o
// resultado como mensagem de voz. Granule positions ficam levemente
// fora, mas todos os players testados tocam normalmente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { uploadAudioFile, velipConfigured } from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Normaliza nome: lowercase, sem acento, troca espaços por _.
function normalizeName(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Falha ao baixar ${url} (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Tenta encontrar o clipe de nome do consultor. Tenta o nome normalizado
// completo, depois só o primeiro pedaço (ex: "maria_jose" → "maria").
async function findNameClip(
  admin: ReturnType<typeof createClient>,
  consultantId: string,
  nameNormalized: string,
): Promise<{ audio_url: string; matched: string } | null> {
  const tries = [nameNormalized, nameNormalized.split("_")[0]].filter(Boolean);
  for (const key of tries) {
    const { data } = await admin
      .from("voice_name_clips")
      .select("audio_url, name_normalized")
      .eq("consultant_id", consultantId)
      .eq("name_normalized", key)
      .maybeSingle();
    if (data?.audio_url) return { audio_url: data.audio_url, matched: data.name_normalized };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "render");
    const templateId = String(body?.template_id || "");
    const rawName = String(body?.name || "");
    const variables: Record<string, string> = (body?.variables && typeof body.variables === "object") ? body.variables : {};
    const force = Boolean(body?.force || false);

    if (!templateId) return json(400, { error: "template_id obrigatório" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: tpl, error: tplErr } = await admin
      .from("voice_templates")
      .select("id, consultant_id, name")
      .eq("id", templateId)
      .maybeSingle();
    if (tplErr || !tpl) return json(404, { error: "template não encontrado" });

    const { data: blocks } = await admin
      .from("voice_template_blocks")
      .select("id, position, kind, audio_url, variable_key")
      .eq("template_id", templateId)
      .order("position", { ascending: true });

    if (!blocks?.length) return json(400, { error: "template sem blocos" });

    const hasNameSlot = blocks.some((b) => b.kind === "name_slot");
    const variableBlocks = blocks.filter((b) => b.kind === "variable_slot");
    const nameNorm = normalizeName(rawName);

    if (hasNameSlot && !rawName) return json(400, { error: "name obrigatório (template tem slot de nome)" });

    // Cache key combina nome + variáveis ordenadas
    const varEntries = variableBlocks
      .map((b) => [b.variable_key || "", normalizeName(variables[b.variable_key || ""] || "")])
      .filter(([k]) => k)
      .sort(([a], [b]) => a.localeCompare(b));
    const varSig = varEntries.map(([k, v]) => `${k}:${v}`).join("|");
    const cacheKey = [hasNameSlot ? nameNorm : "_static_", varSig].filter(Boolean).join("||") || "_static_";

    if (!force) {
      const { data: cached } = await admin
        .from("voice_template_renders")
        .select("final_audio_url")
        .eq("template_id", templateId)
        .eq("name_normalized", cacheKey)
        .maybeSingle();
      if (cached?.final_audio_url) {
        return json(200, { url: cached.final_audio_url, cached: true });
      }
    }

    if (action === "check") {
      if (hasNameSlot) {
        const clip = await findNameClip(admin, tpl.consultant_id, nameNorm);
        if (!clip) return json(200, { available: false });
      }
      for (const b of variableBlocks) {
        const v = normalizeName(variables[b.variable_key || ""] || "");
        if (!v) return json(200, { available: false });
        const clip = await findNameClip(admin, tpl.consultant_id, v);
        if (!clip) return json(200, { available: false });
      }
      return json(200, { available: true });
    }

    // Resolve URLs em ordem
    const urls: string[] = [];
    for (const b of blocks) {
      if (b.kind === "fixed_audio") {
        if (!b.audio_url) return json(400, { error: `bloco ${b.position} sem áudio gravado` });
        urls.push(b.audio_url);
      } else if (b.kind === "name_slot") {
        const clip = await findNameClip(admin, tpl.consultant_id, nameNorm);
        if (!clip) {
          return json(409, {
            error: "name_not_recorded",
            missing_name: rawName,
            missing_key: "nome",
            message: `Você ainda não gravou o nome "${rawName}".`,
          });
        }
        urls.push(clip.audio_url);
      } else if (b.kind === "variable_slot") {
        const key = b.variable_key || "";
        const rawVal = variables[key] || "";
        if (!rawVal) return json(400, { error: `valor obrigatório para {{${key}}}` });
        const valNorm = normalizeName(rawVal);
        const clip = await findNameClip(admin, tpl.consultant_id, valNorm);
        if (!clip) {
          return json(409, {
            error: "name_not_recorded",
            missing_name: rawVal,
            missing_key: key,
            message: `Você ainda não gravou "${rawVal}" para {{${key}}}.`,
          });
        }
        urls.push(clip.audio_url);
      } else {
        return json(400, { error: `tipo de bloco não suportado: ${b.kind}` });
      }
    }

    // Baixa em paralelo
    const parts = await Promise.all(urls.map(downloadBytes));
    const merged = concatBytes(parts);

    // Upload do resultado via upload-media (mesma rota usada pelo front)
    const fd = new FormData();
    const slug = `voz-${tpl.id.slice(0, 8)}-${cacheKey}`;
    const filename = `${slug}.ogg`;
    fd.append("file", new Blob([merged], { type: "audio/ogg; codecs=opus" }), filename);
    fd.append("scope", "template");
    fd.append("consultant_id", tpl.consultant_id);
    fd.append("kind", "voice-render");
    fd.append("slug", slug);

    const uploadRes = await fetch(`${SUPABASE_URL}/functions/v1/upload-media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
      body: fd,
    });
    if (!uploadRes.ok) {
      const t = await uploadRes.text();
      return json(502, { error: `upload falhou: ${t.slice(0, 200)}` });
    }
    const uploaded = await uploadRes.json();
    const finalUrl = uploaded?.url;
    if (!finalUrl) return json(502, { error: "upload sem url" });

    // Upload para Velip (lazy) — usado por PlayAudioFile nas ligações
    let velipAudioId: string | null = null;
    if (velipConfigured()) {
      try {
        const up = await uploadAudioFile(merged, slug, "audio/ogg");
        if (up.ok && up.audio_id) velipAudioId = up.audio_id;
        else console.warn("[stitch] velip upload failed:", up.error);
      } catch (e) {
        console.warn("[stitch] velip upload threw:", (e as Error).message);
      }
    }

    // Salva cache (upsert)
    await admin.from("voice_template_renders").upsert(
      {
        template_id: templateId,
        name_normalized: cacheKey,
        final_audio_url: finalUrl,
        velip_audio_id: velipAudioId,
        velip_uploaded_at: velipAudioId ? new Date().toISOString() : null,
      },
      { onConflict: "template_id,name_normalized" },
    );

    return json(200, { url: finalUrl, cached: false, matched_name: hasNameSlot ? nameNorm : null, velip_audio_id: velipAudioId });
  } catch (e: any) {
    console.error("[voice-template-stitch] erro:", e);
    return json(500, { error: e?.message || "erro interno" });
  }
});
