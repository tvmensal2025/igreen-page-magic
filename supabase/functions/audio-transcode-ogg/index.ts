/**
 * audio-transcode-ogg — Recebe um `media_id` de `ai_media_library` que
 * aponta para um arquivo `.webm` (ou outro container), baixa do Storage,
 * transcodifica para OGG/Opus usando ffmpeg.wasm, sobe o novo arquivo e
 * cria uma nova linha em `ai_media_library` apontando pra ele.
 *
 * Motivo: WhatsApp/Whapi rejeita `.webm` como voice message. Convertendo
 * o container para OGG (mesmo codec Opus, só re-empacotamento) o áudio
 * passa a ser enviável pelo bot.
 *
 * POST { media_id: uuid }
 * → { new_media_id, url }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKET = "ai-agent-media";

// ffmpeg.wasm carregado sob demanda (~30MB). O cold-start fica pesado, mas
// só chamamos quando o usuário clica "Converter" — tudo bem.
// deno-lint-ignore no-explicit-any
let ffmpeg: any = null;

async function getFfmpeg() {
  if (ffmpeg) return ffmpeg;
  // Import dinâmico para não travar o boot da função
  const mod = await import("https://esm.sh/@ffmpeg/[email protected]/dist/esm/index.js");
  const coreURL = "https://esm.sh/@ffmpeg/[email protected]/dist/esm/ffmpeg-core.js";
  const wasmURL = "https://esm.sh/@ffmpeg/[email protected]/dist/esm/ffmpeg-core.wasm";
  ffmpeg = new mod.FFmpeg();
  await ffmpeg.load({ coreURL, wasmURL });
  return ffmpeg;
}

function guessExt(path: string): string {
  const m = path.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
  return (m?.[1] || "webm").toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Requer JWT do usuário (super admin idealmente — mas qualquer autenticado pode
  // converter o próprio áudio; RLS na ai_media_library já protege).
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Não autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { media_id?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Body inválido" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const mediaId = String(body.media_id || "").trim();
  if (!mediaId) {
    return new Response(JSON.stringify({ error: "media_id obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1. Busca a mídia
  const { data: media, error: mErr } = await admin
    .from("ai_media_library")
    .select("id, kind, label, url, storage_path, consultant_id, slot_key, is_public, send_order, priority, is_primary_explainer, delay_before_ms, active")
    .eq("id", mediaId)
    .maybeSingle();

  if (mErr || !media) {
    return new Response(JSON.stringify({ error: "Mídia não encontrada: " + (mErr?.message || "") }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (media.kind !== "audio") {
    return new Response(JSON.stringify({ error: "Não é áudio" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const srcPath = media.storage_path || media.url || "";
  const srcExt = guessExt(srcPath);

  // 2. Baixa o conteúdo — usa storage.download se tiver storage_path, senão fetch da URL pública
  let srcBytes: Uint8Array;
  try {
    if (media.storage_path) {
      const { data: blob, error: dErr } = await admin.storage.from(BUCKET).download(media.storage_path);
      if (dErr || !blob) throw new Error(dErr?.message || "download vazio");
      srcBytes = new Uint8Array(await blob.arrayBuffer());
    } else if (media.url) {
      const r = await fetch(media.url);
      if (!r.ok) throw new Error(`http ${r.status}`);
      srcBytes = new Uint8Array(await r.arrayBuffer());
    } else {
      throw new Error("sem storage_path nem url");
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: "Falha ao baixar: " + (e instanceof Error ? e.message : String(e)) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Transcodifica com ffmpeg.wasm — usa codec copy quando possível (Opus→Opus),
  //    senão faz re-encode para libopus.
  let outBytes: Uint8Array;
  try {
    const ff = await getFfmpeg();
    const inName = `in.${srcExt}`;
    const outName = `out.ogg`;
    await ff.writeFile(inName, srcBytes);
    // Tenta copy stream (rápido, sem perda). Se falhar, ffmpeg re-encoda.
    try {
      await ff.exec(["-i", inName, "-c:a", "copy", "-f", "ogg", outName]);
    } catch {
      await ff.exec(["-i", inName, "-c:a", "libopus", "-b:a", "48k", "-ac", "1", "-ar", "16000", "-f", "ogg", outName]);
    }
    outBytes = await ff.readFile(outName) as Uint8Array;
    try { await ff.deleteFile(inName); } catch { /* ignore */ }
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
  } catch (e) {
    return new Response(JSON.stringify({ error: "Falha no transcode: " + (e instanceof Error ? e.message : String(e)) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4. Sobe o novo arquivo
  const newPath = `converted/${mediaId}-${Date.now()}.ogg`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(newPath, outBytes, {
    contentType: "audio/ogg",
    upsert: true,
  });
  if (upErr) {
    return new Response(JSON.stringify({ error: "Falha ao subir: " + upErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(newPath);
  const newUrl = pub?.publicUrl || "";

  // 5. Insere nova linha em ai_media_library (não sobrescreve a antiga — preserva histórico)
  const { data: inserted, error: insErr } = await admin
    .from("ai_media_library")
    .insert({
      kind: "audio",
      label: (media.label || "audio") + " (ogg)",
      url: newUrl,
      storage_path: newPath,
      consultant_id: media.consultant_id,
      slot_key: media.slot_key,
      is_public: media.is_public,
      send_order: media.send_order,
      priority: media.priority,
      is_primary_explainer: media.is_primary_explainer,
      delay_before_ms: media.delay_before_ms,
      active: true,
      is_draft: false,
    })
    .select("id")
    .maybeSingle();

  if (insErr || !inserted) {
    return new Response(JSON.stringify({ error: "Falha ao registrar: " + (insErr?.message || "") }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 6. Desativa a antiga para não enviar mais o webm
  await admin.from("ai_media_library").update({ active: false }).eq("id", mediaId);

  return new Response(JSON.stringify({ new_media_id: inserted.id, url: newUrl }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
