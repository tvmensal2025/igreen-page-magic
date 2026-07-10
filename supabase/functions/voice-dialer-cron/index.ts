// voice-dialer-cron
// Worker: promove campanhas e disca via Twilio.
// Auth OBRIGATÓRIA (não aceita anon key pública):
//   header x-voice-dialer-cron-secret == VOICE_DIALER_CRON_SECRET
//   OU x-service-secret == SERVICE_SHARED_SECRET
//   OU Authorization Bearer == SUPABASE_SERVICE_ROLE_KEY
// Isolado do WhatsApp.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  createOutboundCall,
  inCallWindow,
  twilioConfigured,
  webhookAuthConfigured,
  webhookAuthQuery,
} from "../_shared/voice-dialer/twilio.ts";

const MAX_CAMPAIGNS = 5;
const MAX_CALLS_PER_CAMPAIGN = 10;
const MAX_EXEC_MS = 45_000;

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

  // Fail-closed: sem secret de cron configurado, só service_role / service secret
  if (!okCron && !okServiceSecret && !okServiceRole) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const started = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  if (!serviceRoleKey) {
    return new Response(JSON.stringify({ error: "missing_service_role" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (!twilioConfigured()) {
    return new Response(
      JSON.stringify({ ok: false, skipped: true, reason: "twilio_not_configured" }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  if (!webhookAuthConfigured()) {
    return new Response(
      JSON.stringify({ ok: false, skipped: true, reason: "twilio_webhook_auth_missing" }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const nowIso = new Date().toISOString();

  await admin
    .from("voice_campaigns")
    .update({ status: "running", started_at: nowIso })
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso);

  const { data: camps, error: e1 } = await admin
    .from("voice_campaigns")
    .select("id, consultant_id, audio_url, config, status, total, dialed, answered, failed")
    .eq("status", "running")
    .order("created_at", { ascending: true })
    .limit(MAX_CAMPAIGNS);

  if (e1) {
    return new Response(JSON.stringify({ error: e1.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const report: unknown[] = [];
  const authQ = webhookAuthQuery();
  const baseFn = `${supabaseUrl}/functions/v1/voice-dialer-webhook`;

  for (const camp of camps ?? []) {
    if (Date.now() - started > MAX_EXEC_MS) break;

    const cfg = (camp.config ?? {}) as {
      windowStart?: string;
      windowEnd?: string;
      weekdaysOnly?: boolean;
    };

    if (!inCallWindow(cfg)) {
      report.push({ campaign_id: camp.id, skipped: "outside_window" });
      continue;
    }

    // Claim atômico: queued → dialing antes de chamar Twilio (evita double-dial)
    const { data: targets } = await admin
      .from("voice_campaign_targets")
      .select("id, phone, name")
      .eq("campaign_id", camp.id)
      .eq("status", "queued")
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

      // Claim: só segue se ainda estiver queued
      const { data: claimed } = await admin
        .from("voice_campaign_targets")
        .update({ status: "dialing", dialed_at: new Date().toISOString() })
        .eq("id", t.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();

      if (!claimed) continue;

      const twimlUrl =
        `${baseFn}?action=twiml&target_id=${t.id}&campaign_id=${camp.id}${authQ}`;
      const statusUrl =
        `${baseFn}?action=status&target_id=${t.id}&campaign_id=${camp.id}${authQ}`;
      const amdUrl =
        `${baseFn}?action=amd&target_id=${t.id}&campaign_id=${camp.id}${authQ}`;

      const call = await createOutboundCall({
        to: t.phone,
        twimlUrl,
        statusCallbackUrl: statusUrl,
        amdCallbackUrl: amdUrl,
        machineDetection: "Enable",
        timeLimitSec: 40,
      });

      if (!call.ok) {
        failedNow++;
        await admin
          .from("voice_campaign_targets")
          .update({
            status: "failed",
            error: call.error ?? "twilio_error",
            finished_at: new Date().toISOString(),
          })
          .eq("id", t.id);
        await admin.from("voice_call_logs").insert({
          campaign_id: camp.id,
          target_id: t.id,
          consultant_id: camp.consultant_id,
          to_phone: t.phone,
          from_phone: Deno.env.get("TWILIO_FROM_NUMBER") ?? null,
          status: "failed",
          error: call.error ?? null,
          raw: call.raw ?? {},
        });
        continue;
      }

      dialedNow++;
      await admin
        .from("voice_campaign_targets")
        .update({ twilio_sid: call.sid ?? null })
        .eq("id", t.id);

      await admin.from("voice_call_logs").insert({
        campaign_id: camp.id,
        target_id: t.id,
        consultant_id: camp.consultant_id,
        twilio_sid: call.sid ?? null,
        to_phone: t.phone,
        from_phone: Deno.env.get("TWILIO_FROM_NUMBER") ?? null,
        status: call.status ?? "queued",
        raw: call.raw ?? {},
      });

      await new Promise((r) => setTimeout(r, 400));
    }

    // Recount a partir dos targets (fonte da verdade)
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
