// voice-dialer-cron (Velip)
// Worker: promove campanhas e disca via Velip PlayAudioFile.
// Também reconcilia targets travados em "dialing" via GetCallStatus.
// Auth OBRIGATÓRIA (fail-closed).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getCallStatus,
  inCallWindow,
  interpretStatus,
  outcomeToTargetStatus,
  playAudioFile,
  toCtid,
  toVelipBRDest,
  velipConfigured,
  velipWebhookAuthConfigured,
} from "../_shared/voice-dialer/velip.ts";
import { resolvePersonalizedCallAudio, firstNameFrom, normalizeCallName, ensureBodyClipOnVelip, CALL_INTRO_CACHE_TAG } from "../_shared/voice-dialer/call-stitch.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";
import { onCallAnsweredPauseCadence } from "../_shared/cadence-hooks.ts";
import { customerIdFromCadenceVoiceLog } from "../_shared/voice-dialer/cadence-log.ts";

const MAX_CAMPAIGNS = 5;
/** Por tick do cron (~5 min). Velip campanha aceita até 100/min; no modo 1-a-1
 *  limitamos pelo tempo da edge (~45s) + custo ElevenLabs do stitch. */
const MAX_CALLS_PER_CAMPAIGN = 40;
const MAX_PREWARM_PER_CAMP = 8;
const MAX_EXEC_MS = 50_000;
const RECONCILE_STALE_MIN = 10;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret, x-voice-dialer-cron-secret",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const cronSecret = Deno.env.get("VOICE_DIALER_CRON_SECRET") ?? "";
  const cronHeader = req.headers.get("x-voice-dialer-cron-secret") ?? "";
  const serviceSecret = Deno.env.get("SERVICE_SHARED_SECRET") ?? "";
  const headerSecret = req.headers.get("x-service-secret") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const okCron = !!(cronSecret && timingSafeEqual(cronHeader, cronSecret));
  const okServiceSecret = !!(serviceSecret && timingSafeEqual(headerSecret, serviceSecret));
  const okServiceRole = !!(serviceRoleKey && bearer && timingSafeEqual(bearer, serviceRoleKey));
  if (!okCron && !okServiceSecret && !okServiceRole) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const started = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  if (!serviceRoleKey) {
    return new Response(JSON.stringify({ error: "missing_service_role" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (!velipConfigured()) {
    return new Response(
      JSON.stringify({ ok: false, skipped: true, reason: "velip_not_configured" }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  if (!velipWebhookAuthConfigured()) {
    return new Response(
      JSON.stringify({ ok: false, skipped: true, reason: "velip_webhook_auth_missing" }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const nowIso = new Date().toISOString();

  // Promove scheduled → running
  await admin
    .from("voice_campaigns")
    .update({ status: "running", started_at: nowIso })
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);

  const { data: camps, error: e1 } = await admin
    .from("voice_campaigns")
    .select("id, consultant_id, audio_clip_id, audio_url, config, status, total, dialed, answered, failed, velip_mode, velip_campaign_id, dispatch_kind, tts_text, caller_id")
    .eq("status", "running")
    // Batch com ID remoto é responsabilidade da Velip e não pode ocupar as
    // cinco vagas do worker, senão campanhas single podem ficar sem execução.
    .or("velip_mode.neq.batch,velip_campaign_id.is.null")
    .order("created_at", { ascending: true })
    .limit(MAX_CAMPAIGNS);

  if (e1) {
    return new Response(JSON.stringify({ error: e1.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const report: unknown[] = [];

  // Reconciliação: targets em "dialing" há > RECONCILE_STALE_MIN sem callback
  try {
    const staleCutoff = new Date(Date.now() - RECONCILE_STALE_MIN * 60_000).toISOString();
    const { data: stale } = await admin
      .from("voice_campaign_targets")
      .select("id, campaign_id, velip_call_id, dialed_at")
      .eq("status", "dialing")
      .not("velip_call_id", "is", null)
      .lt("dialed_at", staleCutoff)
      .limit(20);
    for (const t of stale ?? []) {
      if (Date.now() - started > MAX_EXEC_MS) break;
      const s = await getCallStatus(String(t.velip_call_id));
      if (!s.ok || !s.called_status) continue;
      const outcome = interpretStatus(s.called_status);
      const newStatus = outcomeToTargetStatus(outcome);
      if (!newStatus) continue;
      await admin
        .from("voice_campaign_targets")
        .update({
          status: newStatus,
          velip_status: s.called_status,
          finished_at: new Date().toISOString(),
        })
        .eq("id", t.id);
    }
  } catch (e) {
    console.warn("reconcile_failed:", (e as Error).message);
  }

  // Cadência / logs soltos: discagem gravada sem callback → GetCallStatus.
  try {
    const logCutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: pendingLogs } = await admin
      .from("voice_call_logs")
      .select("id, velip_call_id")
      .in("status", ["dialing", "sent", "unknown"])
      .is("velip_status", null)
      .not("velip_call_id", "is", null)
      .lt("created_at", logCutoff)
      .order("created_at", { ascending: true })
      .limit(25);
    for (const log of pendingLogs ?? []) {
      if (Date.now() - started > MAX_EXEC_MS) break;
      const cdId = String(log.velip_call_id || "");
      if (!cdId) continue;
      const s = await getCallStatus(cdId);
      if (!s.ok || !s.called_status) continue;
      const outcome = interpretStatus(s.called_status);
      const newStatus = outcomeToTargetStatus(outcome) ?? "unknown";
      const patch: Record<string, unknown> = {
        status: newStatus,
        velip_status: s.called_status,
      };
      if (typeof s.time_sec === "number") {
        patch.velip_time_sec = s.time_sec;
        patch.duration_sec = s.time_sec;
      }
      const { data: reconciledLog, error: reconcileError } = await admin
        .from("voice_call_logs")
        .update(patch)
        .eq("id", log.id)
        .is("velip_status", null)
        .select("id, raw")
        .maybeSingle();
      if (reconcileError) {
        console.warn("reconcile_call_log_update_failed:", reconcileError.message);
        continue;
      }
      if (reconciledLog?.id && outcome === "answered") {
        const customerId = customerIdFromCadenceVoiceLog(reconciledLog.raw);
        if (customerId) {
          await onCallAnsweredPauseCadence(admin, customerId);
        }
      }
    }
  } catch (e) {
    console.warn("reconcile_call_logs_failed:", (e as Error).message);
  }

  // Pré-aquece ElevenLabs (Olá+nome+corpo) ANTES de discar — inclusive campanhas ainda agendadas.
  try {
    const { data: warmCamps } = await admin
      .from("voice_campaigns")
      .select("id, consultant_id, audio_clip_id, config, status")
      .in("status", ["scheduled", "running"])
      .not("audio_clip_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(6);

    for (const camp of warmCamps ?? []) {
      if (Date.now() - started > MAX_EXEC_MS - 12_000) break;
      const cfg = (camp.config ?? {}) as { personalize_name?: boolean };
      if (!cfg.personalize_name || !camp.audio_clip_id) continue;

      const { data: qTargets } = await admin
        .from("voice_campaign_targets")
        .select("name, customer_id")
        .eq("campaign_id", camp.id)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(120);

      if (!qTargets?.length) continue;

      const custIds = [
        ...new Set(
          qTargets
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

      const { data: clipMeta } = await admin
        .from("voice_audio_clips")
        .select("voice_id, model_id")
        .eq("id", camp.audio_clip_id)
        .maybeSingle();
      const voiceId =
        String((clipMeta as { voice_id?: string | null } | null)?.voice_id || "").trim() ||
        "EJV7H2baGt5ab95tOoSG";
      const baseModel =
        String((clipMeta as { model_id?: string | null } | null)?.model_id || "eleven_v3")
          .split(":")[0] || "eleven_v3";
      const modelId = `${baseModel}:${CALL_INTRO_CACHE_TAG}`;

      const { data: cachedRenders } = await admin
        .from("voice_call_renders")
        .select("name_normalized")
        .eq("body_clip_id", camp.audio_clip_id)
        .eq("voice_id", voiceId)
        .eq("model_id", modelId);
      const cachedNorms = new Set(
        (cachedRenders || [])
          .map((r) => String((r as { name_normalized?: string }).name_normalized || ""))
          .filter(Boolean),
      );

      const seen = new Set<string>();
      const pending: { display: string; source: string | null }[] = [];
      for (const t of qTargets) {
        const cid = String((t as { customer_id?: string | null }).customer_id || "").trim();
        const cust = cid ? custMap.get(cid) : null;
        const raw = cust?.name ?? (t as { name?: string | null }).name;
        const source = cust ? cust.name_source : raw ? "manual" : null;
        const display = firstNameFrom(raw, source);
        const key = normalizeCallName(display);
        if (!key || seen.has(key) || cachedNorms.has(key)) continue;
        seen.add(key);
        pending.push({ display, source: source || "manual" });
        if (pending.length >= MAX_PREWARM_PER_CAMP) break;
      }

      if (!pending.length) {
        report.push({ campaign_id: camp.id, prewarm: "already_ready" });
        continue;
      }

      await ensureBodyClipOnVelip(admin, String(camp.audio_clip_id), String(camp.consultant_id));
      let created = 0;
      let failed = 0;
      for (const row of pending) {
        if (Date.now() - started > MAX_EXEC_MS - 8_000) break;
        const st = await resolvePersonalizedCallAudio(admin, {
          consultantId: String(camp.consultant_id),
          bodyClipId: String(camp.audio_clip_id),
          rawName: row.display,
          nameSource: row.source,
          fallbackToBody: false,
        });
        if (st.ok) created++;
        else failed++;
      }
      report.push({
        campaign_id: camp.id,
        prewarm: { created, failed, attempted: pending.length, status: camp.status },
      });
    }
  } catch (e) {
    console.warn("prewarm_failed:", (e as Error).message);
  }

  // Disparo modo `single` — batch válido é orquestrado pela Velip sozinha.
  // Campanha batch sem ID remoto é inválida; degrada para single para não travar.
  for (const camp of camps ?? []) {
    if (Date.now() - started > MAX_EXEC_MS) break;
    if ((camp as { velip_mode?: string }).velip_mode === "batch") {
      if ((camp as { velip_campaign_id?: string | null }).velip_campaign_id) {
        report.push({ campaign_id: camp.id, skipped: "batch_mode" });
        continue;
      }
      await admin
        .from("voice_campaigns")
        .update({ velip_mode: "single" })
        .eq("id", camp.id)
        .eq("velip_mode", "batch")
        .is("velip_campaign_id", null);
      console.warn(`[voice-dialer-cron] batch sem campanha Velip; usando single: ${camp.id}`);
    }

    const cfg = (camp.config ?? {}) as {
      windowStart?: string;
      windowEnd?: string;
      weekdaysOnly?: boolean;
      scheduledExact?: boolean;
      personalize_name?: boolean;
      timezone?: string;
    };
    if (!cfg.scheduledExact && !inCallWindow(cfg)) {
      report.push({ campaign_id: camp.id, skipped: "outside_window" });
      continue;
    }

    const dispatchKind = ((camp as { dispatch_kind?: string }).dispatch_kind || "audio") as "audio" | "tts";
    const callerId = ((camp as { caller_id?: string }).caller_id || undefined) as string | undefined;

    // Regra Sofia: nunca discar com TTS Velip — só áudio (ElevenLabs).
    if (dispatchKind === "tts") {
      report.push({ campaign_id: camp.id, skipped: "sofia_required_no_velip_tts" });
      continue;
    }

    // Resolve audio_id Velip
    let audioId: string | null = null;
    if (camp.audio_clip_id) {
      const { data: clip } = await admin
        .from("voice_audio_clips")
        .select("velip_audio_id")
        .eq("id", camp.audio_clip_id)
        .maybeSingle();
      audioId = clip?.velip_audio_id ?? null;
    }
    if (!audioId) {
      report.push({ campaign_id: camp.id, skipped: "no_velip_audio_id" });
      continue;
    }

    const { data: targets } = await admin
      .from("voice_campaign_targets")
      .select("id, phone, name, customer_id")
      .eq("campaign_id", camp.id)
      .eq("status", "queued")
      .or(`next_attempt_at.is.null,next_attempt_at.lte."${nowIso}"`)
      .order("created_at", { ascending: true })
      .limit(MAX_CALLS_PER_CAMPAIGN);

    if (!targets?.length) {
      const { count } = await admin
        .from("voice_campaign_targets")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", camp.id)
        .in("status", ["queued", "dialing", "answered"]);

      if ((count ?? 0) === 0) {
        await admin
          .from("voice_campaigns")
          .update({ status: "finished", finished_at: new Date().toISOString() })
          .eq("id", camp.id);
        report.push({ campaign_id: camp.id, finished: true });
      }
      continue;
    }

    let dialedNow = 0;
    let failedNow = 0;

    for (const t of targets) {
      if (Date.now() - started > MAX_EXEC_MS) break;

      // Claim só por id+queued. O filtro next_attempt_at já veio no SELECT;
      // repetir `.or(lte.ISO)` no UPDATE quebra o PostgREST (dois-pontos do timestamp)
      // e todas as claims falham → dialed:0 eterno com fila cheia.
      const { data: claimed } = await admin
        .from("voice_campaign_targets")
        .update({ status: "dialing", dialed_at: new Date().toISOString(), next_attempt_at: null })
        .eq("id", t.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      const suppression = await assertCanContact(admin, {
        phone: t.phone,
        consultantId: camp.consultant_id,
        channel: "voice",
      });
      if (!suppression.allowed) {
        await admin
          .from("voice_campaign_targets")
          .update({
            status: "failed",
            error: suppression.reason || "do_not_contact",
            finished_at: new Date().toISOString(),
          })
          .eq("id", t.id);
        await admin.from("voice_call_logs").insert({
          campaign_id: camp.id,
          target_id: t.id,
          consultant_id: camp.consultant_id,
          to_phone: t.phone,
          status: "failed",
          error: suppression.reason || "do_not_contact",
          raw: { skipped: "dnc" },
          velip_raw: {},
        });
        failedNow++;
        continue;
      }

      const dest = toVelipBRDest(t.phone) || t.phone;

      let dialAudioId = audioId;
      let stitchMeta: Record<string, unknown> | null = null;
      if (
        dispatchKind === "audio" &&
        Boolean(cfg.personalize_name) &&
        camp.audio_clip_id
      ) {
        // Só costura "Olá, Nome" se a fonte for confiável (não push do Zap).
        let nameSource: string | null = null;
        let rawName = (t as { name?: string | null }).name;
        const customerId = (t as { customer_id?: string | null }).customer_id;
        if (customerId) {
          const { data: cust } = await admin
            .from("customers")
            .select("name, name_source")
            .eq("id", customerId)
            .maybeSingle();
          if (cust) {
            rawName = (cust as { name?: string | null }).name ?? rawName;
            nameSource = (cust as { name_source?: string | null }).name_source ?? null;
          }
        } else if (rawName) {
          // Lista digitada pelo consultor na campanha → trata como manual.
          nameSource = "manual";
        }
        const st = await resolvePersonalizedCallAudio(admin, {
          consultantId: camp.consultant_id,
          bodyClipId: String(camp.audio_clip_id),
          rawName,
          nameSource,
          fallbackToBody: true,
        });
        stitchMeta = {
          stitch_ok: st.ok,
          stitch_cached: st.cached ?? false,
          stitch_fallback_body: st.fallback_body ?? false,
          stitch_error: st.error ?? null,
        };
        if (st.ok && st.velip_audio_id) dialAudioId = st.velip_audio_id;
      }

      const call = await playAudioFile({
        to: dest,
        audioId: dialAudioId!,
        ctid: toCtid(t.id),
        timeLimitSec: 40,
        callerId,
      });

      if (!call.ok) {
        failedNow++;
        await admin
          .from("voice_campaign_targets")
          .update({
            status: "failed",
            error: call.error ?? "velip_error",
            finished_at: new Date().toISOString(),
          })
          .eq("id", t.id);
        await admin.from("voice_call_logs").insert({
          campaign_id: camp.id,
          target_id: t.id,
          consultant_id: camp.consultant_id,
          to_phone: dest,
          status: "failed",
          error: call.error ?? null,
          raw: { ...(call.raw as object ?? {}), ...(stitchMeta || {}) },
          velip_raw: call.raw ?? {},
        });
        continue;
      }

      dialedNow++;
      await admin
        .from("voice_campaign_targets")
        .update({ velip_call_id: call.cd_id ?? null })
        .eq("id", t.id);
      await admin.from("voice_call_logs").insert({
        campaign_id: camp.id,
        target_id: t.id,
        consultant_id: camp.consultant_id,
        to_phone: dest,
        status: "dialing",
        velip_call_id: call.cd_id ?? null,
        raw: { ...(call.raw as object ?? {}), ...(stitchMeta || {}) },
        velip_raw: call.raw ?? {},
      });
      await new Promise((r) => setTimeout(r, 150));
    }

    const { data: allT } = await admin
      .from("voice_campaign_targets")
      .select("status")
      .eq("campaign_id", camp.id);
    let answered = 0;
    let failed = 0;
    let dialed = 0;
    for (const row of allT ?? []) {
      const s = String(row.status || "");
      if (s === "queued") continue;
      dialed++;
      if (s === "completed") answered++;
      else if (["failed", "busy", "no_answer", "machine"].includes(s)) failed++;
    }
    await admin
      .from("voice_campaigns")
      .update({ dialed, answered, failed })
      .eq("id", camp.id);

    report.push({ campaign_id: camp.id, dialed: dialedNow, failed: failedNow });
  }

  return new Response(JSON.stringify({ ok: true, report }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
