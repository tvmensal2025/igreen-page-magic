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
  CALL_INTRO_CACHE_TAG,
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

    type NameRow = { raw: string; source: string | null };
    const nameRows: NameRow[] = namesIn
      .map((n) => ({ raw: String(n || "").trim(), source: "manual" as string | null }))
      .filter((n) => n.raw);

    if (campaignId && nameRows.length === 0) {
      const { data: targets } = await admin
        .from("voice_campaign_targets")
        .select("name, customer_id")
        .eq("campaign_id", campaignId)
        .in("status", ["queued", "pending", "dialing"])
        .limit(3000);
      const custIds = [
        ...new Set(
          (targets || [])
            .map((t) => String((t as { customer_id?: string | null }).customer_id || "").trim())
            .filter(Boolean),
        ),
      ];
      const custMap = new Map<string, { name: string | null; name_source: string | null }>();
      for (let i = 0; i < custIds.length; i += 200) {
        const slice = custIds.slice(i, i + 200);
        const { data: custs } = await admin
          .from("customers")
          .select("id, name, name_source")
          .in("id", slice);
        for (const c of custs || []) {
          custMap.set(String((c as { id: string }).id), {
            name: (c as { name?: string | null }).name ?? null,
            name_source: (c as { name_source?: string | null }).name_source ?? null,
          });
        }
      }
      for (const t of targets || []) {
        const cid = String((t as { customer_id?: string | null }).customer_id || "").trim();
        const cust = cid ? custMap.get(cid) : null;
        if (cust) {
          nameRows.push({
            raw: String(cust.name || (t as { name?: string | null }).name || "").trim(),
            source: cust.name_source,
          });
        } else {
          const raw = String((t as { name?: string | null }).name || "").trim();
          if (raw) nameRows.push({ raw, source: "manual" });
        }
      }
    }

    const { data: clipRaw } = await admin
      .from("voice_audio_clips")
      .select("voice_id, model_id")
      .eq("id", bodyClipId)
      .maybeSingle();
    const voiceId =
      String((clipRaw as { voice_id?: string | null } | null)?.voice_id || "").trim() ||
      "EJV7H2baGt5ab95tOoSG";
    const baseModel =
      String((clipRaw as { model_id?: string | null } | null)?.model_id || "eleven_v3")
        .split(":")[0] || "eleven_v3";
    const modelId = `${baseModel}:${CALL_INTRO_CACHE_TAG}`;

    const { data: cachedRenders } = await admin
      .from("voice_call_renders")
      .select("name_normalized")
      .eq("body_clip_id", bodyClipId)
      .eq("voice_id", voiceId)
      .eq("model_id", modelId);
    const cachedNorms = new Set(
      (cachedRenders || [])
        .map((r) => String((r as { name_normalized?: string }).name_normalized || ""))
        .filter(Boolean),
    );

    // Dedup por prenome normalizado — só quem ainda não tem áudio ElevenLabs+Velip.
    const seen = new Set<string>();
    const pending: string[] = [];
    let skippedNoName = 0;
    let alreadyCached = 0;
    for (const row of nameRows) {
      // Campanha: consultor já escolheu o contato — se a fonte bloquear, ainda usa
      // o nome legível como "manual" (não é push-name solto do Zap).
      let first = firstNameFrom(row.raw, row.source);
      if (!first && row.raw) {
        first = firstNameFrom(row.raw, "manual");
      }
      const key = normalizeCallName(first);
      if (!key) {
        skippedNoName++;
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      if (cachedNorms.has(key)) {
        alreadyCached++;
        continue;
      }
      pending.push(first);
    }

    const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 40);
    const batch = pending.slice(0, limit);

    await ensureBodyClipOnVelip(admin, bodyClipId, consultantId);

    const results: unknown[] = [];
    let created = 0;
    let cached = 0;
    let failed = 0;
    for (const display of batch) {
      const r = await resolvePersonalizedCallAudio(admin, {
        consultantId,
        bodyClipId,
        rawName: display,
        nameSource: "manual",
        fallbackToBody: false,
      });
      results.push({ name: display, ...r });
      if (r.ok && r.cached) cached++;
      else if (r.ok) created++;
      else failed++;
    }

    const remaining = Math.max(0, pending.length - batch.length);
    const ready = alreadyCached + created + cached;
    const totalUnique = seen.size;
    // Só "done" se realmente varreu nomes — 0/0 não conta como pronto.
    const done = remaining === 0 && totalUnique > 0;
    return json(200, {
      ok: true,
      total_unique: totalUnique,
      pending_before: pending.length,
      processed: batch.length,
      created,
      cached,
      failed,
      already_cached: alreadyCached,
      skipped_no_name: skippedNoName,
      remaining,
      ready,
      done,
      cache_note:
        "Olá+Nome! Tudo bem? fica em voice_call_renders por prenome+corpo; lead novo com o mesmo nome reaproveita.",
      results,
    });
  }

  return json(400, { error: "unknown_action", action });
});
