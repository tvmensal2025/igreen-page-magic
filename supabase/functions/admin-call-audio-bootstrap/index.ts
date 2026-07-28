/**
 * admin-call-audio-bootstrap
 * Gera e valida áudios de ligação Sofia (corpo → Velip + intro “Olá, Nome! Tudo bem?”).
 *
 * Auth: Authorization Bearer = SUPABASE_SERVICE_ROLE_KEY (somente interno).
 * Body: { consultant_id?: string, names?: string[], limit_per_clip?: number }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  CALL_INTRO_CACHE_TAG,
  ensureBodyClipOnVelip,
  resolvePersonalizedCallAudio,
} from "../_shared/voice-dialer/call-stitch.ts";
import { velipConfigured } from "../_shared/voice-dialer/velip.ts";
import { buildOlaTudoBemTtsText } from "../_shared/tts-ptbr-anchor.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_CONSULTANT = "0c2711ad-4836-41e6-afba-edd94f698ae3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function assertServiceRole(req: Request): boolean {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  if (SERVICE_ROLE && token === SERVICE_ROLE) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1] || ""));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

async function probeMp3Url(url: string): Promise<{ ok: boolean; bytes: number; detail?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return { ok: false, bytes: 0, detail: `http_${res.status}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 500) return { ok: false, bytes: buf.byteLength, detail: "too_small" };
    const head = buf.slice(0, 3);
    const looksMp3 =
      (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || head[0] === 0xff;
    if (!looksMp3) return { ok: false, bytes: buf.byteLength, detail: "not_mp3" };
    return { ok: true, bytes: buf.byteLength };
  } catch (e) {
    return { ok: false, bytes: 0, detail: (e as Error)?.message || "fetch_error" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!assertServiceRole(req)) return json(401, { error: "unauthorized" });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const consultantId = String(body.consultant_id || DEFAULT_CONSULTANT).trim();
  const namesIn = Array.isArray(body.names)
    ? body.names.map((n) => String(n || "").trim()).filter(Boolean)
    : ["Maria", "João", "Ana", "Carlos", "Fernanda"];
  const limitPerClip = Math.min(Math.max(Number(body.limit_per_clip) || namesIn.length, 1), 20);

  if (!velipConfigured()) return json(503, { error: "velip_not_configured" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: stages, error: stErr } = await admin
    .from("cadence_stage_config")
    .select("stage, personalize_name, voice_audio_clip_id, enabled")
    .eq("consultant_id", consultantId)
    .or(
      "stage.eq.CALL_1,stage.eq.CALL_2,stage.eq.CALL_3,stage.eq.A_CALL,stage.eq.A_CALL_RETRY,stage.like.%_CALL",
    );

  if (stErr) return json(500, { error: stErr.message });

  const callStages = (stages || []).filter((s) => s.voice_audio_clip_id);
  const report: Record<string, unknown>[] = [];
  let bodiesOk = 0;
  let stitchesOk = 0;
  let stitchesFail = 0;

  for (const row of callStages) {
    const clipId = String(row.voice_audio_clip_id);
    const { data: clip } = await admin
      .from("voice_audio_clips")
      .select("id, name, audio_url, velip_audio_id, voice_id, model_id, is_call_body")
      .eq("id", clipId)
      .maybeSingle();

    if (!clip?.audio_url) {
      report.push({ stage: row.stage, ok: false, error: "clip_missing_url" });
      continue;
    }

    const probe = await probeMp3Url(clip.audio_url);
    if (!probe.ok) {
      report.push({
        stage: row.stage,
        ok: false,
        error: `body_probe_${probe.detail}`,
        bytes: probe.bytes,
      });
      continue;
    }

    const ensured = await ensureBodyClipOnVelip(admin, clipId, consultantId);
    if (!ensured.ok) {
      report.push({ stage: row.stage, ok: false, error: `velip_${ensured.error}` });
      continue;
    }
    bodiesOk++;

    const nameResults: unknown[] = [];
    for (const name of namesIn.slice(0, limitPerClip)) {
      const introText = buildOlaTudoBemTtsText(name);
      const r = await resolvePersonalizedCallAudio(admin, {
        consultantId,
        bodyClipId: clipId,
        rawName: name,
        nameSource: "manual",
        fallbackToBody: false,
      });
      if (r.ok && r.velip_audio_id) {
        stitchesOk++;
        nameResults.push({
          name,
          introText,
          ok: true,
          cached: !!r.cached,
          velip_audio_id: r.velip_audio_id,
          fallback_body: !!r.fallback_body,
        });
      } else {
        stitchesFail++;
        nameResults.push({ name, introText, ok: false, error: r.error || "stitch_failed" });
      }
    }

    report.push({
      stage: row.stage,
      ok: nameResults.every((n) => (n as { ok?: boolean }).ok),
      personalize_name: row.personalize_name,
      enabled: row.enabled,
      clip_id: clipId,
      clip_name: clip.name,
      is_call_body: clip.is_call_body,
      body_bytes: probe.bytes,
      velip_body_id: ensured.audio_id,
      names: nameResults,
    });
  }

  const { count: renderCount } = await admin
    .from("voice_call_renders")
    .select("id", { count: "exact", head: true })
    .eq("consultant_id", consultantId)
    .like("model_id", `%${CALL_INTRO_CACHE_TAG}%`);

  return json(200, {
    ok: stitchesFail === 0 && bodiesOk === callStages.length,
    consultant_id: consultantId,
    stages: callStages.length,
    bodies_on_velip: bodiesOk,
    stitches_ok: stitchesOk,
    stitches_fail: stitchesFail,
    renders_ci_v3: renderCount ?? 0,
    intro_template: buildOlaTudoBemTtsText("Nome"),
    report,
  });
});
