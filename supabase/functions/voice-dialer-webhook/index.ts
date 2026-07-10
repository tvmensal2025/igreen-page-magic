// voice-dialer-webhook
// TwiML + StatusCallback + AsyncAMD.
// Auth OBRIGATÓRIA: ?auth=TWILIO_WEBHOOK_AUTH
// Assinatura Twilio: hard-fail quando TWILIO_AUTH_TOKEN está setado.
// Isolado do WhatsApp/bot.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  hangupCall,
  isMachineAnsweredBy,
  twimlHangup,
  twimlPlay,
  validateTwilioSignature,
  webhookAuthConfigured,
} from "../_shared/voice-dialer/twilio.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

function xml(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...cors, "Content-Type": "text/xml; charset=utf-8" },
  });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function parseForm(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of fd.entries()) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  try {
    const j = await req.json();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j ?? {})) {
      if (v != null) out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

const TERMINAL = new Set(["completed", "busy", "no_answer", "failed", "machine"]);

async function recountCampaign(
  admin: ReturnType<typeof createClient>,
  campaignId: string,
) {
  const { data: targets } = await admin
    .from("voice_campaign_targets")
    .select("status")
    .eq("campaign_id", campaignId);

  let answered = 0;
  let failed = 0;
  let dialed = 0;
  let pending = 0;
  for (const t of targets ?? []) {
    const s = String(t.status || "");
    if (s === "queued") {
      pending++;
      continue;
    }
    if (s === "dialing" || s === "answered") {
      dialed++;
      pending++;
      continue;
    }
    dialed++;
    if (s === "completed") answered++;
    else if (TERMINAL.has(s)) failed++;
  }

  const patch: Record<string, unknown> = { answered, failed, dialed };
  if (pending === 0) {
    patch.status = "finished";
    patch.finished_at = new Date().toISOString();
  }
  await admin.from("voice_campaigns").update(patch).eq("id", campaignId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!webhookAuthConfigured()) {
    return json(503, {
      error: "twilio_webhook_auth_missing",
      message: "Configure TWILIO_WEBHOOK_AUTH nos secrets antes de receber callbacks.",
    });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "status";
  const targetId = url.searchParams.get("target_id");
  const campaignId = url.searchParams.get("campaign_id");
  const authParam = url.searchParams.get("auth");
  const expectedAuth = Deno.env.get("TWILIO_WEBHOOK_AUTH")!.trim();

  if (authParam !== expectedAuth) {
    return json(401, { error: "unauthorized" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const params = req.method === "POST" ? await parseForm(req) : {};

  // Assinatura Twilio: hard-fail se token configurado
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim();
  const sig = req.headers.get("X-Twilio-Signature");
  if (authToken) {
    if (!sig) return json(401, { error: "missing_twilio_signature" });
    const publicUrl = `${SUPABASE_URL}/functions/v1/voice-dialer-webhook${url.search}`;
    const ok = await validateTwilioSignature(sig, publicUrl, params);
    if (!ok) {
      // Tenta também a URL do request (proxies às vezes divergem)
      const ok2 = await validateTwilioSignature(sig, req.url, params);
      if (!ok2) return json(401, { error: "invalid_twilio_signature" });
    }
  }

  // ─── AsyncAMD: máquina → hangup ──────────────────────────────────────────
  if (action === "amd") {
    const answeredBy = (params.AnsweredBy || "").toLowerCase();
    const callSid = params.CallSid || "";
    if (isMachineAnsweredBy(answeredBy)) {
      if (callSid) await hangupCall(callSid);
      if (targetId) {
        await admin
          .from("voice_campaign_targets")
          .update({
            status: "machine",
            answered_by: answeredBy,
            finished_at: new Date().toISOString(),
            twilio_sid: callSid || null,
          })
          .eq("id", targetId)
          .in("status", ["queued", "dialing", "answered"]);
        if (campaignId) await recountCampaign(admin, campaignId);
      }
    }
    return json(200, { ok: true });
  }

  // ─── TwiML ───────────────────────────────────────────────────────────────
  if (action === "twiml") {
    if (!targetId || !campaignId) return xml(twimlHangup());

    const answeredBy = (params.AnsweredBy || params.answered_by || "").toLowerCase();
    if (isMachineAnsweredBy(answeredBy)) {
      await admin
        .from("voice_campaign_targets")
        .update({
          status: "machine",
          answered_by: answeredBy,
          finished_at: new Date().toISOString(),
        })
        .eq("id", targetId);
      await recountCampaign(admin, campaignId);
      return xml(twimlHangup());
    }

    // Se já marcado machine por AsyncAMD, não toca áudio
    const { data: tgt } = await admin
      .from("voice_campaign_targets")
      .select("status")
      .eq("id", targetId)
      .maybeSingle();
    if (tgt?.status === "machine") return xml(twimlHangup());

    const { data: camp } = await admin
      .from("voice_campaigns")
      .select("audio_url")
      .eq("id", campaignId)
      .maybeSingle();

    const audioUrl = camp?.audio_url;
    if (!audioUrl) return xml(twimlHangup());

    await admin
      .from("voice_campaign_targets")
      .update({
        status: "answered",
        answered_by: answeredBy || null,
      })
      .eq("id", targetId)
      .in("status", ["queued", "dialing", "answered"]);

    return xml(twimlPlay(audioUrl));
  }

  // ─── Status callback ─────────────────────────────────────────────────────
  if (action === "status") {
    if (!targetId) return json(400, { error: "missing_target_id" });

    const callStatus = (params.CallStatus || "").toLowerCase();
    const answeredBy = (params.AnsweredBy || "").toLowerCase() || null;
    const duration = params.CallDuration ? parseInt(params.CallDuration, 10) : null;
    const sid = params.CallSid || null;
    const price = params.Price || null;

    // Estado atual do target (idempotência)
    const { data: current } = await admin
      .from("voice_campaign_targets")
      .select("status, campaign_id")
      .eq("id", targetId)
      .maybeSingle();

    const alreadyTerminal = current?.status && TERMINAL.has(current.status);

    let targetStatus: string | null = null;
    if (callStatus === "completed") {
      targetStatus = isMachineAnsweredBy(answeredBy) ? "machine" : "completed";
    } else if (callStatus === "busy") {
      targetStatus = "busy";
    } else if (callStatus === "no-answer" || callStatus === "canceled") {
      targetStatus = "no_answer";
    } else if (callStatus === "failed") {
      targetStatus = "failed";
    } else if (callStatus === "answered" || callStatus === "in-progress") {
      targetStatus = isMachineAnsweredBy(answeredBy) ? "machine" : "answered";
    }

    if (targetStatus && !alreadyTerminal) {
      const patch: Record<string, unknown> = {
        status: targetStatus,
        answered_by: answeredBy,
      };
      if (sid) patch.twilio_sid = sid;
      if (TERMINAL.has(targetStatus)) {
        patch.finished_at = new Date().toISOString();
      }
      await admin.from("voice_campaign_targets").update(patch).eq("id", targetId);
    } else if (sid && current) {
      await admin
        .from("voice_campaign_targets")
        .update({ twilio_sid: sid, answered_by: answeredBy })
        .eq("id", targetId);
    }

    // Log: 1 por SID+status terminal (evita spam de initiated/ringing)
    const campId = campaignId || current?.campaign_id;
    if (campId && targetStatus && TERMINAL.has(targetStatus)) {
      const { data: camp } = await admin
        .from("voice_campaigns")
        .select("consultant_id")
        .eq("id", campId)
        .maybeSingle();

      if (camp) {
        // Evita duplicar log do mesmo SID+status
        let shouldInsert = true;
        if (sid) {
          const { count } = await admin
            .from("voice_call_logs")
            .select("id", { count: "exact", head: true })
            .eq("twilio_sid", sid)
            .eq("status", callStatus || targetStatus);
          if ((count ?? 0) > 0) shouldInsert = false;
        }

        if (shouldInsert) {
          await admin.from("voice_call_logs").insert({
            campaign_id: campId,
            target_id: targetId,
            consultant_id: camp.consultant_id,
            twilio_sid: sid,
            to_phone: params.To || "",
            from_phone: params.From || null,
            status: callStatus || targetStatus,
            answered_by: answeredBy,
            duration_sec: Number.isFinite(duration as number) ? duration : null,
            price,
            raw: params,
          });
        }

        await recountCampaign(admin, campId);
      }
    }

    return json(200, { ok: true });
  }

  return json(400, { error: "unknown_action" });
});
