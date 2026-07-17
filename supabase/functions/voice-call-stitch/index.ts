/**
 * voice-call-stitch
 * - stitch: intro "Olá, Nome." + corpo → Velip (cache voice_call_renders)
 * - export_body: áudio do Estúdio → voice_audio_clips (corpo para ligação)
 * - prewarm: costura em lote (sem discar) para campanhas grandes
 *
 * Auth: JWT consultor (resolveCaller) ou service_role / x-service-secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import {
  ensureBodyClipOnVelip,
  firstNameFrom,
  normalizeCallName,
  resolvePersonalizedCallAudio,
} from "../_shared/voice-dialer/call-stitch.ts";
import { velipConfigured } from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  let consultantId: string | null = null;
  if (caller.mode === "jwt") {
    consultantId = caller.consultantId;
  } else if (caller.mode === "service") {
    consultantId = String(body.consultant_id || "").trim() || null;
  }
  if (!consultantId) return json(400, { error: "consultant_id_required" });

  const action = String(body.action || "stitch");

  // ── export_body ──────────────────────────────────────────────────────────
  if (action === "export_body") {
    const audioUrl = String(body.audio_url || "").trim();
    const name = String(body.name || "Corpo para ligação").trim().slice(0, 120);
    const voiceId = String(body.voice_id || "").trim() || null;
    const modelId = String(body.model_id || "").trim() || null;
    const sourceLibraryId = String(body.source_audio_library_id || "").trim() || null;
    if (!audioUrl) return json(400, { error: "audio_url_required" });

    const { data: clip, error } = await admin
      .from("voice_audio_clips")
      .insert({
        consultant_id: consultantId,
        name,
        audio_url: audioUrl,
        voice_id: voiceId,
        model_id: modelId,
        source_audio_library_id: sourceLibraryId,
        is_call_body: true,
      })
      .select("id, name, audio_url, voice_id, model_id, velip_audio_id, is_call_body")
      .single();

    if (error || !clip) return json(500, { error: error?.message || "insert_failed" });

    let velip_audio_id = clip.velip_audio_id as string | null;
    if (velipConfigured()) {
      const ensured = await ensureBodyClipOnVelip(admin, clip.id, consultantId);
      if (ensured.ok) velip_audio_id = ensured.audio_id;
    }

    return json(200, { ok: true, clip: { ...clip, velip_audio_id } });
  }

  // ── stitch ───────────────────────────────────────────────────────────────
  if (action === "stitch") {
    const bodyClipId = String(body.body_clip_id || "").trim();
    const rawName = String(body.name || "").trim();
    if (!bodyClipId) return json(400, { error: "body_clip_id_required" });
    if (!velipConfigured()) return json(503, { error: "velip_not_configured" });

    await ensureBodyClipOnVelip(admin, bodyClipId, consultantId);
    const r = await resolvePersonalizedCallAudio(admin, {
      consultantId,
      bodyClipId,
      rawName,
      fallbackToBody: body.fallback_to_body !== false,
    });
    if (!r.ok) return json(502, r);
    return json(200, r);
  }

  // ── prewarm ──────────────────────────────────────────────────────────────
  if (action === "prewarm") {
    const bodyClipId = String(body.body_clip_id || "").trim();
    const namesIn = Array.isArray(body.names) ? body.names : [];
    const campaignId = String(body.campaign_id || "").trim();
    if (!bodyClipId) return json(400, { error: "body_clip_id_required" });
    if (!velipConfigured()) return json(503, { error: "velip_not_configured" });

    let names: string[] = namesIn.map((n) => String(n || "").trim()).filter(Boolean);

    if (campaignId && names.length === 0) {
      const { data: targets } = await admin
        .from("voice_campaign_targets")
        .select("name")
        .eq("campaign_id", campaignId)
        .limit(2000);
      names = (targets || []).map((t) => String(t.name || "").trim()).filter(Boolean);
    }

    // Dedup por primeiro nome normalizado
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const n of names) {
      const first = firstNameFrom(n);
      const key = normalizeCallName(first);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(first);
    }

    const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 80);
    const batch = unique.slice(0, limit);

    await ensureBodyClipOnVelip(admin, bodyClipId, consultantId);

    const results: unknown[] = [];
    let ok = 0;
    let cached = 0;
    let failed = 0;
    for (const display of batch) {
      const r = await resolvePersonalizedCallAudio(admin, {
        consultantId,
        bodyClipId,
        rawName: display,
        fallbackToBody: false,
      });
      results.push({ name: display, ...r });
      if (r.ok && r.cached) cached++;
      else if (r.ok) ok++;
      else failed++;
    }

    return json(200, {
      ok: true,
      total_unique: unique.length,
      processed: batch.length,
      created: ok,
      cached,
      failed,
      remaining: Math.max(0, unique.length - batch.length),
      results,
    });
  }

  return json(400, { error: "unknown_action", action });
});
