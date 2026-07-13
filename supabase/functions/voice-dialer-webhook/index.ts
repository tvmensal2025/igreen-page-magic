// voice-dialer-webhook (Velip)
// Callback global cadastrado no painel Velip → Integrações → URLs para Retorno.
// Auth OBRIGATÓRIA via ?auth=VELIP_WEBHOOK_AUTH.
// Aceita POST JSON e POST x-www-form-urlencoded.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  getVelipWebhookAuth,
  interpretStatus,
  isRetryable,
  isVelipCallerIp,
  makeSMS,
  outcomeToTargetStatus,
  toCtid,
  velipConfigured,
  velipWebhookAuthConfigured,
} from "../_shared/voice-dialer/velip.ts";
import { isAutomationEnabled } from "../_shared/automation-gate.ts";
import { onCallAnsweredPauseCadence } from "../_shared/cadence-hooks.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

async function parsePayload(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) ?? {};
    } catch {
      return {};
    }
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const out: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) out[k] = typeof v === "string" ? v : String(v);
    return out;
  }
  // fallback: tenta ambos
  const text = await req.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    try {
      const p = new URLSearchParams(text);
      const o: Record<string, unknown> = {};
      p.forEach((v, k) => (o[k] = v));
      return o;
    } catch {
      return { _raw: text };
    }
  }
}

const TERMINAL = new Set(["completed", "no_answer", "failed", "machine"]);

async function recountCampaign(
  admin: ReturnType<typeof createClient>,
  campaignId: string,
) {
  const { data: targets } = await admin
    .from("voice_campaign_targets")
    .select("status")
    .eq("campaign_id", campaignId);

  let answered = 0, failed = 0, dialed = 0, pending = 0;
  for (const t of targets ?? []) {
    const s = String(t.status || "");
    if (s === "queued") { pending++; continue; }
    if (s === "dialing" || s === "answered") { dialed++; pending++; continue; }
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

interface MatchResult {
  id: string;
  campaign_id: string | null;
  attempts: number;
  max_attempts: number;
}

async function matchTarget(
  admin: ReturnType<typeof createClient>,
  ctid: string,
  velipCallId: string,
  dest: string,
): Promise<MatchResult | null> {
  // 1) ctid = target.id.slice(0,15)  → prefixo
  if (ctid) {
    const { data } = await admin
      .from("voice_campaign_targets")
      .select("id, campaign_id, attempts, max_attempts")
      .ilike("id", `${ctid}%`)
      .limit(1)
      .maybeSingle();
    if (data) return data as MatchResult;
  }
  // 2) velip_call_id
  if (velipCallId) {
    const { data } = await admin
      .from("voice_campaign_targets")
      .select("id, campaign_id, attempts, max_attempts")
      .eq("velip_call_id", velipCallId)
      .limit(1)
      .maybeSingle();
    if (data) return data as MatchResult;
  }
  // 3) dest + janela de 60 min (mais tolerante que 60s)
  if (dest) {
    const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data } = await admin
      .from("voice_campaign_targets")
      .select("id, campaign_id, attempts, max_attempts, dialed_at")
      .eq("phone", dest)
      .in("status", ["dialing", "answered"])
      .gte("dialed_at", cutoff)
      .order("dialed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as MatchResult;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!velipWebhookAuthConfigured()) {
    return json(503, {
      error: "velip_webhook_auth_missing",
      message: "Configure VELIP_WEBHOOK_AUTH nos secrets antes de receber callbacks.",
    });
  }

  const url = new URL(req.url);
  const authParam = url.searchParams.get("auth");
  if (authParam !== getVelipWebhookAuth()) {
    return json(401, { error: "unauthorized" });
  }

  // Soft-warn IP não Velip (não bloqueia — proxies podem esconder)
  const xfwd = req.headers.get("x-forwarded-for");
  const callerIp = xfwd?.split(",")[0]?.trim() ?? null;
  const trusted = isVelipCallerIp(callerIp);

  if (req.method === "GET") {
    // Endpoint de teste do painel Velip
    return json(200, { ok: true, service: "voice-dialer-webhook", driver: "velip", ip_trusted: trusted });
  }

  const params = await parsePayload(req);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ─── Callback SMS (command:"sms") ─────────────────────────────────────
  if (String(params.command || "").toLowerCase() === "sms") {
    const cdls_id = String(params.cdls_id ?? params.sms_id ?? "");
    const ctid = String(params.ctid ?? "");
    const dest = String(params.dest ?? "");
    const delivstatus = String(params.delivstatus ?? "");

    let smsRow: { id: string } | null = null;
    if (cdls_id) {
      const { data } = await admin
        .from("voice_sms_log").select("id").eq("velip_sms_id", cdls_id).maybeSingle();
      smsRow = (data as { id: string } | null) ?? null;
    }
    if (!smsRow && ctid) {
      const { data } = await admin
        .from("voice_sms_log").select("id").eq("velip_ctid", ctid).maybeSingle();
      smsRow = (data as { id: string } | null) ?? null;
    }
    if (!smsRow && dest) {
      const { data } = await admin
        .from("voice_sms_log").select("id")
        .eq("phone", dest.replace(/\D/g, ""))
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      smsRow = (data as { id: string } | null) ?? null;
    }

    if (smsRow) {
      const delivered = /SUCCESS|DELIVERED|ENTREGUE/i.test(delivstatus);
      await admin.from("voice_sms_log").update({
        delivery_status: delivstatus || null,
        delivered_at: delivered ? new Date().toISOString() : null,
        status: delivered ? "delivered" : (delivstatus ? "failed" : "sent"),
      }).eq("id", smsRow.id);
    }
    return json(200, { ok: true, sms: true, matched: !!smsRow });
  }

  const cd_id = String(params.cd_id ?? params.call_id ?? "");
  const ctid = String(params.ctid ?? "");
  const dest = String(params.dest ?? params.destino ?? params.to ?? "");
  const called_status = String(params.cd_called_status ?? params.called_status ?? "");
  const time_sec = Number(params.cd_time_sec ?? params.time_sec ?? NaN);
  const cost = Number(params.cd_value ?? params.cd_price ?? params.cost ?? NaN);
  const saldo = Number(params.saldo ?? params.balance ?? NaN);
  const price_per_min = Number(params.cd_price ?? NaN);
  const dtmf: Record<string, string> = {};
  for (let i = 1; i <= 12; i++) {
    const k = `cd_resp${i}`;
    if (params[k] != null && String(params[k]) !== "") dtmf[`resp${i}`] = String(params[k]);
  }

  if (!cd_id && !ctid && !dest) {
    return json(400, { error: "missing_identifiers" });
  }

  const target = await matchTarget(admin, ctid, cd_id, dest);
  if (!target) {
    // Não achamos target — grava log solto para auditoria e retorna 200 pra Velip não retentar
    await admin.from("voice_call_logs").insert({
      to_phone: dest || "",
      status: called_status || "unknown",
      velip_call_id: cd_id || null,
      velip_status: called_status || null,
      velip_time_sec: Number.isFinite(time_sec) ? time_sec : null,
      velip_cost: Number.isFinite(cost) ? cost : null,
      velip_saldo_after: Number.isFinite(saldo) ? saldo : null,
      velip_dtmf: Object.keys(dtmf).length ? dtmf : null,
      velip_raw: params,
      raw: params,
      error: "unmatched_callback",
    });
    return json(200, { ok: true, matched: false });
  }

  const outcome = interpretStatus(called_status);
  const newStatus = outcomeToTargetStatus(outcome);
  const patch: Record<string, unknown> = {
    velip_call_id: cd_id || null,
    velip_status: called_status || null,
    velip_cost: Number.isFinite(cost) ? cost : null,
    velip_saldo_after: Number.isFinite(saldo) ? saldo : null,
  };

  const attempts = (target.attempts ?? 0) + 1;
  const maxAttempts = target.max_attempts ?? 1;
  const shouldRetry = isRetryable(outcome) && attempts < maxAttempts;

  if (shouldRetry) {
    patch.status = "queued";
    patch.attempts = attempts;
    patch.next_attempt_at = new Date(Date.now() + 15 * 60_000).toISOString();
  } else if (newStatus) {
    patch.status = newStatus;
    patch.attempts = attempts;
    patch.finished_at = new Date().toISOString();
  }

  await admin.from("voice_campaign_targets").update(patch).eq("id", target.id);

  // Log detalhado
  const { data: camp } = target.campaign_id
    ? await admin
        .from("voice_campaigns")
        .select("consultant_id")
        .eq("id", target.campaign_id)
        .maybeSingle()
    : { data: null };

  await admin.from("voice_call_logs").insert({
    campaign_id: target.campaign_id,
    target_id: target.id,
    consultant_id: (camp as { consultant_id?: string } | null)?.consultant_id ?? null,
    velip_call_id: cd_id || null,
    velip_status: called_status || null,
    velip_time_sec: Number.isFinite(time_sec) ? time_sec : null,
    velip_cost: Number.isFinite(cost) ? cost : null,
    velip_saldo_after: Number.isFinite(saldo) ? saldo : null,
    velip_dtmf: Object.keys(dtmf).length ? dtmf : null,
    dtmf_responses: Object.keys(dtmf).length ? dtmf : {},
    price_per_min: Number.isFinite(price_per_min) ? price_per_min : null,
    velip_raw: params,
    raw: params,
    to_phone: dest || "",
    status: newStatus ?? "unknown",
    duration_sec: Number.isFinite(time_sec) ? time_sec : null,
  });

  if (target.campaign_id && (newStatus || shouldRetry)) {
    await recountCampaign(admin, target.campaign_id);
  }

  // ── Automações pós-callback ────────────────────────────────────────────
  const consultantId = (camp as { consultant_id?: string } | null)?.consultant_id ?? null;

  // Auto-DNC: bloqueios permanentes viram Não Perturbe
  if (consultantId && (outcome === "do_not_disturb" || outcome === "invalid_number" || outcome === "nonexistent")) {
    try {
      await admin.from("voice_dnc_list").upsert({
        consultant_id: consultantId,
        phone: (dest || "").replace(/\D/g, ""),
        reason: `auto_${outcome}`,
        source: "velip_callback",
      }, { onConflict: "consultant_id,phone" });
    } catch (_e) { /* ignore */ }
  }

  // Ligação atendida → pausa cadência (só se toggle ON)
  if (outcome === "answered") {
    try {
      const customerId = (target as { customer_id?: string | null }).customer_id ?? null;
      await onCallAnsweredPauseCadence(admin, customerId);
    } catch (_e) { /* ignore */ }
  }

  // SMS de fallback para NA terminal — exige toggle call_outcome_sms_branch
  if (!shouldRetry && newStatus === "no_answer" && target.campaign_id && velipConfigured()) {
    if (!(await isAutomationEnabled(admin, "call_outcome_sms_branch"))) {
      return json(200, { ok: true, matched: true, outcome, retry: shouldRetry, sms_skipped: "toggle_off" });
    }
    const { data: campFull } = await admin
      .from("voice_campaigns")
      .select("sms_on_no_answer_text")
      .eq("id", target.campaign_id)
      .maybeSingle();
    const smsText = (campFull as { sms_on_no_answer_text?: string | null } | null)?.sms_on_no_answer_text?.trim();
    if (smsText && dest) {
      try {
        const smsRes = await makeSMS({
          to: dest.replace(/\D/g, ""),
          message: smsText,
          ctid: toCtid(target.id),
        });
        await admin.from("voice_sms_log").insert({
          consultant_id: consultantId,
          campaign_id: target.campaign_id,
          phone: dest.replace(/\D/g, ""),
          message: `[fallback NA] ${smsText}`,
          status: smsRes.ok ? "sent" : "failed",
          velip_sms_id: smsRes.cdls_id ?? null,
          velip_ctid: toCtid(target.id),
          error: smsRes.ok ? null : (smsRes.error ?? "unknown"),
        });
      } catch (e) {
        console.error("[voice-webhook] SMS fallback falhou:", (e as Error).message);
      }
    }
  }

  return json(200, { ok: true, matched: true, outcome, retry: shouldRetry });
});
