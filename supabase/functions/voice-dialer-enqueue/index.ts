// voice-dialer-enqueue
// Cria campanha PSTN + targets, ou dispara teste de 1 número.
// Autenticado por JWT do consultor. Isolado do WhatsApp/bot.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import {
  createOutboundCall,
  toE164BR,
  twilioConfigured,
  webhookAuthConfigured,
  webhookAuthQuery,
} from "../_shared/voice-dialer/twilio.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface TargetIn {
  phone: string;
  name?: string | null;
  customer_id?: string | null;
}

interface Body {
  action?: "create_campaign" | "test_call";
  campaign_name?: string;
  audio_clip_id?: string | null;
  audio_url?: string | null;
  scheduled_at?: string | null;
  config?: Record<string, unknown>;
  /** Lista manual de phones */
  phones?: TargetIn[];
  /** Filtrar customers por conversation_step */
  conversation_step?: string | null;
  /** Lead frio: sem atividade há N horas (default 24) */
  cold_hours?: number | null;
  /** Limite máximo de targets */
  max_targets?: number;
  /** Só para test_call */
  test_phone?: string | null;
}

const MAX_TARGETS = 2000;

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
  if (caller.mode !== "jwt") return json(403, { error: "forbidden" });
  const consultantId = caller.consultantId;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const action = body.action ?? "create_campaign";

  // ─── Teste: 1 ligação imediata ───────────────────────────────────────────
  if (action === "test_call") {
    if (!twilioConfigured()) {
      return json(422, {
        error: "twilio_not_configured",
        message:
          "Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_FROM_NUMBER nos secrets da Edge Function.",
      });
    }
    if (!webhookAuthConfigured()) {
      return json(422, {
        error: "twilio_webhook_auth_missing",
        message:
          "Configure TWILIO_WEBHOOK_AUTH (token aleatório) nos secrets — obrigatório para callbacks seguros.",
      });
    }
    const e164 = toE164BR(body.test_phone);
    if (!e164) return json(400, { error: "invalid_test_phone" });

    let audioUrl = (body.audio_url ?? "").trim();
    if (!audioUrl && body.audio_clip_id) {
      const { data: clip } = await admin
        .from("voice_audio_clips")
        .select("audio_url")
        .eq("id", body.audio_clip_id)
        .eq("consultant_id", consultantId)
        .maybeSingle();
      audioUrl = clip?.audio_url ?? "";
    }
    if (!audioUrl) return json(400, { error: "missing_audio_url" });

    const { data: campaign, error: campErr } = await admin
      .from("voice_campaigns")
      .insert({
        consultant_id: consultantId,
        name: body.campaign_name?.trim() || "Teste de ligação",
        audio_clip_id: body.audio_clip_id ?? null,
        audio_url: audioUrl,
        config: { ...(body.config ?? {}), test: true, weekdaysOnly: false, windowStart: "00:00", windowEnd: "23:59" },
        status: "running",
        total: 1,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (campErr || !campaign?.id) {
      return json(500, { error: campErr?.message ?? "campaign_insert_failed" });
    }

    const { data: target, error: tgtErr } = await admin
      .from("voice_campaign_targets")
      .insert({
        campaign_id: campaign.id,
        phone: e164,
        name: "Teste",
        status: "queued",
      })
      .select("id")
      .single();

    if (tgtErr || !target?.id) {
      await admin.from("voice_campaigns").delete().eq("id", campaign.id);
      return json(500, { error: tgtErr?.message ?? "target_insert_failed" });
    }

    const baseFn = `${SUPABASE_URL}/functions/v1/voice-dialer-webhook`;
    const authQ = webhookAuthQuery();
    const twimlUrl =
      `${baseFn}?action=twiml&target_id=${target.id}&campaign_id=${campaign.id}${authQ}`;
    const statusUrl =
      `${baseFn}?action=status&target_id=${target.id}&campaign_id=${campaign.id}${authQ}`;
    const amdUrl =
      `${baseFn}?action=amd&target_id=${target.id}&campaign_id=${campaign.id}${authQ}`;

    const call = await createOutboundCall({
      to: e164,
      twimlUrl,
      statusCallbackUrl: statusUrl,
      amdCallbackUrl: amdUrl,
      machineDetection: "Enable",
      timeLimitSec: 40,
    });

    if (!call.ok) {
      await admin
        .from("voice_campaign_targets")
        .update({ status: "failed", error: call.error ?? "twilio_error", finished_at: new Date().toISOString() })
        .eq("id", target.id);
      await admin
        .from("voice_campaigns")
        .update({ status: "finished", failed: 1, dialed: 1, finished_at: new Date().toISOString() })
        .eq("id", campaign.id);
      return json(502, { error: "twilio_call_failed", detail: call.error });
    }

    await admin
      .from("voice_campaign_targets")
      .update({
        status: "dialing",
        twilio_sid: call.sid ?? null,
        dialed_at: new Date().toISOString(),
      })
      .eq("id", target.id);

    await admin.from("voice_call_logs").insert({
      campaign_id: campaign.id,
      target_id: target.id,
      consultant_id: consultantId,
      twilio_sid: call.sid ?? null,
      to_phone: e164,
      from_phone: Deno.env.get("TWILIO_FROM_NUMBER") ?? null,
      status: call.status ?? "queued",
      raw: call.raw ?? {},
    });

    await admin
      .from("voice_campaigns")
      .update({ dialed: 1 })
      .eq("id", campaign.id);

    return json(200, {
      ok: true,
      campaign_id: campaign.id,
      target_id: target.id,
      twilio_sid: call.sid,
    });
  }

  // ─── create_campaign ─────────────────────────────────────────────────────
  if (!twilioConfigured()) {
    return json(422, {
      error: "twilio_not_configured",
      message:
        "Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_FROM_NUMBER nos secrets antes de criar campanhas.",
    });
  }
  if (!webhookAuthConfigured()) {
    return json(422, {
      error: "twilio_webhook_auth_missing",
      message: "Configure TWILIO_WEBHOOK_AUTH nos secrets antes de criar campanhas.",
    });
  }

  let audioUrl = (body.audio_url ?? "").trim();
  if (!audioUrl && body.audio_clip_id) {
    const { data: clip } = await admin
      .from("voice_audio_clips")
      .select("audio_url")
      .eq("id", body.audio_clip_id)
      .eq("consultant_id", consultantId)
      .maybeSingle();
    audioUrl = clip?.audio_url ?? "";
  }
  if (!audioUrl) return json(400, { error: "missing_audio_url" });

  const targets: TargetIn[] = [];
  const seen = new Set<string>();

  const pushPhone = (raw: string, name?: string | null, customerId?: string | null) => {
    const e164 = toE164BR(raw);
    if (!e164 || seen.has(e164)) return;
    seen.add(e164);
    targets.push({ phone: e164, name: name ?? null, customer_id: customerId ?? null });
  };

  // 1) Lista manual
  if (Array.isArray(body.phones)) {
    for (const p of body.phones) {
      if (p?.phone) pushPhone(p.phone, p.name, p.customer_id);
    }
  }

  // 2) Customers por conversation_step e/ou lead frio
  const step = (body.conversation_step ?? "").trim();
  const coldHours = body.cold_hours != null ? Number(body.cold_hours) : null;
  if (step || (coldHours != null && coldHours > 0)) {
    let q = admin
      .from("customers")
      .select(
        "id, name, phone_whatsapp, phone_landline, portal2_celular_alt, phone_contact_confirmed, conversation_step, last_bot_interaction_at, updated_at",
      )
      .eq("consultant_id", consultantId)
      .limit(Math.min(body.max_targets ?? MAX_TARGETS, MAX_TARGETS));

    if (step) q = q.eq("conversation_step", step);

    if (coldHours != null && coldHours > 0) {
      const cutoff = new Date(Date.now() - coldHours * 3600_000).toISOString();
      q = q.or(
        `last_bot_interaction_at.lt.${cutoff},and(last_bot_interaction_at.is.null,updated_at.lt.${cutoff})`,
      );
    }

    const { data: customers, error: cErr } = await q;
    if (cErr) return json(500, { error: cErr.message });

    for (const c of customers ?? []) {
      const row = c as Record<string, unknown>;
      const alt = String(row.portal2_celular_alt ?? "");
      const land = String(row.phone_landline ?? "");
      const wa = String(row.phone_whatsapp ?? "");
      const confirmed = row.phone_contact_confirmed === true;
      const phone =
        (alt && toE164BR(alt)) ||
        (confirmed && land && toE164BR(land)) ||
        toE164BR(wa);
      if (phone) pushPhone(phone, (row.name as string) ?? null, row.id as string);
    }
  }

  if (targets.length === 0) return json(422, { error: "no_valid_targets" });
  if (targets.length > MAX_TARGETS) {
    return json(400, { error: "too_many_targets", max: MAX_TARGETS });
  }

  const scheduled = body.scheduled_at ?? null;
  const defaultConfig = {
    windowStart: "09:00",
    windowEnd: "18:00",
    weekdaysOnly: true,
    leaveVoicemail: false,
    conversation_step: step || null,
    cold_hours: coldHours,
    ...(body.config ?? {}),
  };

  const { data: campaign, error: campErr } = await admin
    .from("voice_campaigns")
    .insert({
      consultant_id: consultantId,
      name: body.campaign_name?.trim() || "Campanha de ligação",
      audio_clip_id: body.audio_clip_id ?? null,
      audio_url: audioUrl,
      config: defaultConfig,
      status: scheduled ? "scheduled" : "running",
      scheduled_at: scheduled,
      started_at: scheduled ? null : new Date().toISOString(),
      total: targets.length,
    })
    .select("id")
    .single();

  if (campErr || !campaign?.id) {
    return json(500, { error: campErr?.message ?? "campaign_insert_failed" });
  }

  const rows = targets.map((t) => ({
    campaign_id: campaign.id,
    phone: t.phone,
    name: t.name ?? null,
    customer_id: t.customer_id ?? null,
    status: "queued",
  }));

  // insert em chunks
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: tgtErr } = await admin
      .from("voice_campaign_targets")
      .insert(rows.slice(i, i + CHUNK));
    if (tgtErr) {
      await admin.from("voice_campaigns").delete().eq("id", campaign.id);
      return json(500, { error: tgtErr.message });
    }
  }

  return json(200, {
    ok: true,
    campaign_id: campaign.id,
    total: targets.length,
    status: scheduled ? "scheduled" : "running",
  });
});
