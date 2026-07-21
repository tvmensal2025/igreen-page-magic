/**
 * regen-corrected-call-bodies
 *
 * Regenera 1 áudio de CORPO (sem “Olá, Nome”) por stage CALL corrigido,
 * sobe no tts-cache, cria voice_audio_clips (is_call_body) e aponta
 * cadence_stage_config (consultor + global).
 *
 * NÃO gera stitch por nome — só o corpo da plataforma.
 * Depois: chamar admin-call-audio-bootstrap com limit_per_clip=1 para Velip.
 *
 * POST body opcional: { consultant_id?: string, stages?: string[] }
 *
 * Mesmo padrão de regen-a2-audio (sem JWT de usuário; usa secrets do server).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SOFIA_VOICE = "EJV7H2baGt5ab95tOoSG";
const MODEL_V3 = "eleven_v3";
const DEFAULT_CONSULTANT = "0c2711ad-4836-41e6-afba-edd94f698ae3";

const DEFAULT_STAGES = [
  "RECALL_60D_CALL",
  "RECALL_5M_CALL",
  "RECALL_8M_CALL",
  "RECALL_12M_CALL",
  "RECALL_YEARLY_CALL",
] as const;

const VOICE_SETTINGS_V3 = {
  stability: 0.55,
  similarity_boost: 0.8,
  style: 0.15,
  use_speaker_boost: true,
  speed: 0.98,
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function extractCallBody(messageText: string): string {
  let t = String(messageText || "").replace(/\r\n/g, "\n").trim();
  t = t.replace(/^Olá,\s*\{\{nome\}\}[!.,]?\s*(Tudo bem\?)?\s*\n+/i, "");
  t = t.replace(/^Olá[!.,]?\s*\n+/i, "");
  return t.trim();
}

function renderIdentity(text: string, assistente: string, consultor: string): string {
  return text
    .replace(/\{\{\s*assistente\s*\}\}/gi, assistente)
    .replace(/\{\{\s*consultor\s*\}\}/gi, consultor)
    .replace(/\{\{\s*nome\s*\}\}/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ELEVENLABS_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";

  if (!ELEVENLABS_KEY) return json(503, { error: "ELEVENLABS_API_KEY_missing" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(503, { error: "supabase_env_missing" });

  const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const consultantId = String(payload.consultant_id || DEFAULT_CONSULTANT).trim();
  const stages = Array.isArray(payload.stages) && payload.stages.length
    ? payload.stages.map((s) => String(s)).filter(Boolean)
    : [...DEFAULT_STAGES];

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: cons } = await admin
    .from("consultants")
    .select("name, display_name, assistant_name")
    .eq("id", consultantId)
    .maybeSingle();

  const assistente = String(cons?.assistant_name || "Sofia").trim() || "Sofia";
  const consultor =
    String(cons?.display_name || cons?.name || "consultor").trim() || "consultor";

  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some((b) => b.id === "tts-cache")) {
    await admin.storage.createBucket("tts-cache", {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ["audio/mpeg", "audio/mp3"],
    });
  }

  const report: Record<string, unknown>[] = [];

  for (const stage of stages) {
    try {
      let { data: row } = await admin
        .from("cadence_stage_config")
        .select("message_text")
        .eq("stage", stage)
        .eq("consultant_id", consultantId)
        .maybeSingle();
      if (!row?.message_text) {
        const g = await admin
          .from("cadence_stage_config")
          .select("message_text")
          .eq("stage", stage)
          .is("consultant_id", null)
          .maybeSingle();
        row = g.data;
      }
      if (!row?.message_text) {
        report.push({ stage, ok: false, error: "no_message_text" });
        continue;
      }

      const bodyText = renderIdentity(extractCallBody(row.message_text), assistente, consultor);
      if (bodyText.length < 20) {
        report.push({ stage, ok: false, error: "body_too_short", preview: bodyText });
        continue;
      }

      const elRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${SOFIA_VOICE}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": ELEVENLABS_KEY,
          },
          body: JSON.stringify({
            text: bodyText,
            model_id: MODEL_V3,
            language_code: "pt",
            voice_settings: VOICE_SETTINGS_V3,
          }),
        },
      );
      if (!elRes.ok) {
        const errBody = await elRes.text();
        report.push({
          stage,
          ok: false,
          error: `elevenlabs_${elRes.status}`,
          detail: errBody.slice(0, 300),
        });
        continue;
      }

      const audioBuf = new Uint8Array(await elRes.arrayBuffer());
      const ts = Date.now();
      const path = `call-bodies/${stage.toLowerCase()}-${ts}.mp3`;
      const { error: upErr } = await admin.storage.from("tts-cache").upload(path, audioBuf, {
        contentType: "audio/mpeg",
        upsert: true,
      });
      if (upErr) {
        report.push({ stage, ok: false, error: `upload_${upErr.message}` });
        continue;
      }
      const { data: pub } = admin.storage.from("tts-cache").getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { data: clip, error: clipErr } = await admin
        .from("voice_audio_clips")
        .insert({
          consultant_id: consultantId,
          name: `[Regen corpo] ${stage} · ${new Date().toISOString().slice(0, 16)}`.slice(0, 120),
          audio_url: publicUrl,
          voice_id: SOFIA_VOICE,
          model_id: MODEL_V3,
          is_call_body: true,
        })
        .select("id")
        .single();
      if (clipErr || !clip?.id) {
        report.push({ stage, ok: false, error: `clip_insert_${clipErr?.message || "no_id"}` });
        continue;
      }

      await admin
        .from("cadence_stage_config")
        .update({
          voice_audio_clip_id: clip.id,
          personalize_name: true,
          updated_at: new Date().toISOString(),
        })
        .eq("stage", stage)
        .eq("consultant_id", consultantId);

      await admin
        .from("cadence_stage_config")
        .update({
          voice_audio_clip_id: clip.id,
          personalize_name: true,
          updated_at: new Date().toISOString(),
        })
        .eq("stage", stage)
        .is("consultant_id", null);

      report.push({
        stage,
        ok: true,
        clip_id: clip.id,
        url: publicUrl,
        bytes: audioBuf.byteLength,
        body_preview: bodyText.slice(0, 160),
      });
    } catch (e) {
      report.push({ stage, ok: false, error: (e as Error).message || "unknown" });
    }
  }

  const okCount = report.filter((r) => (r as { ok?: boolean }).ok).length;
  return json(200, {
    ok: okCount === stages.length,
    consultant_id: consultantId,
    assistente,
    consultor,
    generated: okCount,
    total: stages.length,
    report,
    next: "Chamar admin-call-audio-bootstrap com names=['Maria'] e limit_per_clip=1 para subir na Velip.",
  });
});
