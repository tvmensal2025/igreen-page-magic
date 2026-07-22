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
  toVelipSmsDest,
  velipConfigured,
  velipWebhookAuthConfigured,
} from "../_shared/voice-dialer/velip.ts";
import { isAutomationEnabled } from "../_shared/automation-gate.ts";
import { onCallAnsweredPauseCadence } from "../_shared/cadence-hooks.ts";
import {
  finishOutboundEffect,
  markEffectSending,
  reserveOutboundEffect,
  voiceFallbackSmsKey,
} from "../_shared/journey-effects.ts";

/** Hash estável do callback p/ dedup (sem timestamp — retries Velip idênticos). */
async function eventHash(parts: (string | number)[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join("|"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Registra o evento; retorna false se já foi processado (callback repetido).
 * Erro de banco → fail-open no PROCESSAMENTO (updates são idempotentes),
 * mas os efeitos derivados (SMS) têm reserva própria fail-closed.
 */
async function registerWebhookEvent(
  admin: SB,
  hash: string,
  kind: string,
  targetId: string | null,
  campaignId: string | null,
  meta: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("voice_webhook_events")
      .upsert(
        { event_hash: hash, event_kind: kind, target_id: targetId, campaign_id: campaignId, meta },
        { onConflict: "event_hash", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      console.warn("[voice-webhook] dedup insert failed (processing anyway)", error.message);
      return true;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.warn("[voice-webhook] dedup threw (processing anyway)", (e as Error).message);
    return true;
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// deno-lint-ignore no-explicit-any
type SB = any;

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
  admin: SB,
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
  customer_id: string | null;
  attempts: number;
  max_attempts: number;
  status?: string | null;
  fallback_sms_at?: string | null;
}

const TARGET_COLS = "id, campaign_id, customer_id, attempts, max_attempts, status, fallback_sms_at";

async function matchTarget(
  admin: SB,
  ctid: string,
  velipCallId: string,
  dest: string,
): Promise<MatchResult | null> {
  // 1) ctid = target.id.slice(0,15)  → prefixo
  if (ctid) {
    const { data } = await admin
      .from("voice_campaign_targets")
      .select(TARGET_COLS)
      .ilike("id", `${ctid}%`)
      .limit(1)
      .maybeSingle();
    if (data) return data as unknown as MatchResult;
  }
  // 2) velip_call_id
  if (velipCallId) {
    const { data } = await admin
      .from("voice_campaign_targets")
      .select(TARGET_COLS)
      .eq("velip_call_id", velipCallId)
      .limit(1)
      .maybeSingle();
    if (data) return data as unknown as MatchResult;
  }
  // 3) dest + janela de 60 min (mais tolerante que 60s)
  if (dest) {
    const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data } = await admin
      .from("voice_campaign_targets")
      .select(`${TARGET_COLS}, dialed_at`)
      .eq("phone", dest)
      .in("status", ["dialing", "answered"])
      .gte("dialed_at", cutoff)
      .order("dialed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as unknown as MatchResult;
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
      const phoneCanon = toVelipSmsDest(dest) || dest.replace(/\D/g, "");
      const phoneAlt =
        phoneCanon.length === 13 && phoneCanon.startsWith("55") && phoneCanon[4] === "9"
          ? `55${phoneCanon.slice(2, 4)}${phoneCanon.slice(5)}`
          : null;
      const phones = [...new Set([phoneCanon, dest.replace(/\D/g, ""), phoneAlt].filter(Boolean))];
      const { data } = await admin
        .from("voice_sms_log").select("id")
        .in("phone", phones)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      smsRow = (data as { id: string } | null) ?? null;
    }

    if (smsRow) {
      // Velip/operadora usa códigos curtos: DELIVRD, UNDELIV, ACCEPTD, EXPIRED…
      const st = (delivstatus || "").toUpperCase().trim();
      const delivered = /^(DELIVRD|DELIVERED|SUCCESS|ENTREGUE|OK)$/.test(st) ||
        /SUCCESS|DELIVERED|ENTREGUE|DELIVRD/i.test(delivstatus);
      const undelivered = /^(UNDELIV|REJECTD|EXPIRED|DELETED|UNKNOWN)$/.test(st);
      await admin.from("voice_sms_log").update({
        delivery_status: delivstatus || null,
        delivered_at: delivered ? new Date().toISOString() : null,
        status: delivered ? "delivered" : undelivered ? "failed" : (delivstatus ? "sent" : "sent"),
        error: undelivered ? (delivstatus || "undelivered") : null,
      }).eq("id", smsRow.id);

      // Auto-DNC de SMS: 2+ UNDELIV/REJECTD/EXPIRED nas últimas 72h para o mesmo
      // consultor+telefone = número morto para SMS (e provavelmente para voz).
      // Bloqueia futuros envios de SMS e ligações sem depender do guard em memória.
      if (undelivered) {
        const { data: full } = await admin
          .from("voice_sms_log")
          .select("consultant_id, phone")
          .eq("id", smsRow.id).maybeSingle();
        const consultantId = (full as { consultant_id?: string | null } | null)?.consultant_id ?? null;
        const phoneDigits = String((full as { phone?: string | null } | null)?.phone || dest || "").replace(/\D/g, "");
        if (consultantId && phoneDigits) {
          const cutoff = new Date(Date.now() - 72 * 3600_000).toISOString();
          const { data: recentFails } = await admin
            .from("voice_sms_log")
            .select("id, delivery_status, status, error")
            .eq("consultant_id", consultantId)
            .eq("phone", phoneDigits)
            .gte("created_at", cutoff)
            .limit(20);
          const undelivCount = ((recentFails as { delivery_status: string | null; status: string | null; error: string | null }[] | null) || [])
            .filter((r) => {
              const s = String(r.delivery_status || "").toUpperCase();
              return /^(UNDELIV|REJECTD|EXPIRED|DELETED|UNKNOWN)$/.test(s) ||
                String(r.error || "").toUpperCase() === "UNDELIV";
            }).length;
          if (undelivCount >= 2) {
            try {
              await admin.from("voice_dnc_list").upsert({
                consultant_id: consultantId,
                phone: phoneDigits,
                reason: "auto_sms_undeliv",
                source: "velip_callback_sms",
              }, { onConflict: "consultant_id,phone" });
            } catch (_e) { /* ignore */ }
          }
        }
      }
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

  // Dedup: o MESMO callback (mesmos identificadores + status) processa 1x.
  // Retries idênticos da Velip retornam 200 sem repetir efeitos derivados.
  const callHash = await eventHash([
    "call", cd_id, ctid, dest, called_status,
    Number.isFinite(time_sec) ? time_sec : "",
    target?.id ?? "",
  ]);
  const isNewEvent = await registerWebhookEvent(
    admin, callHash, "call_status", target?.id ?? null, target?.campaign_id ?? null,
    { cd_id, ctid, dest, called_status },
  );
  if (!isNewEvent) {
    return json(200, { ok: true, duplicate: true, matched: !!target });
  }
  if (!target) {
    // Cadência / reheat: log já existe com velip_call_id (dialing). Atualiza em vez de órfão.
    if (cd_id) {
      const outcome = interpretStatus(called_status);
      const newStatus = outcomeToTargetStatus(outcome) ?? (called_status || "unknown");
      const patch: Record<string, unknown> = {
        status: newStatus,
        velip_status: called_status || null,
        velip_time_sec: Number.isFinite(time_sec) ? time_sec : null,
        velip_cost: Number.isFinite(cost) ? cost : null,
        velip_saldo_after: Number.isFinite(saldo) ? saldo : null,
        velip_dtmf: Object.keys(dtmf).length ? dtmf : null,
        velip_raw: params,
        raw: params,
        error: null,
      };
      if (dest) patch.to_phone = dest;
      const { data: updated } = await admin
        .from("voice_call_logs")
        .update(patch)
        .eq("velip_call_id", cd_id)
        .is("velip_status", null)
        .select("id, consultant_id, to_phone");
      if (updated && updated.length > 0) {
        // Auto-DNC também para chamadas do motor de cadência (sem campaign_id).
        // Antes: DNC só era gravado quando havia target/campaign — cadence-tick ficava
        // dependendo do guard in-memory, e voice_dnc_list nascia vazio.
        if (outcome === "do_not_disturb" || outcome === "invalid_number" || outcome === "nonexistent") {
          const logRow = updated[0] as { consultant_id?: string | null; to_phone?: string | null };
          const consultantId = logRow.consultant_id ?? null;
          const phoneDigits = String(logRow.to_phone || dest || "").replace(/\D/g, "");
          if (consultantId && phoneDigits) {
            try {
              await admin.from("voice_dnc_list").upsert({
                consultant_id: consultantId,
                phone: phoneDigits,
                reason: `auto_${outcome}`,
                source: "velip_callback_cadence",
              }, { onConflict: "consultant_id,phone" });
            } catch (_e) { /* ignore */ }
          }
        }
        return json(200, { ok: true, matched: true, cadence_log: true, updated: updated.length });
      }
    }
    // Sem log prévio — grava solto para auditoria (Velip não deve retentar).
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

  // CAS em attempts: callback concorrente do mesmo target não incrementa 2x.
  const { data: casRows } = await admin
    .from("voice_campaign_targets")
    .update(patch)
    .eq("id", target.id)
    .eq("attempts", target.attempts ?? 0)
    .select("id");
  if (!casRows || casRows.length === 0) {
    // Outro worker processou um callback deste target primeiro — não repete
    // contagem nem efeitos derivados; registra o log e sai.
    await admin.from("voice_call_logs").insert({
      campaign_id: target.campaign_id,
      target_id: target.id,
      velip_call_id: cd_id || null,
      velip_status: called_status || null,
      velip_raw: params,
      raw: params,
      to_phone: dest || "",
      status: newStatus ?? "unknown",
      error: "concurrent_callback_skipped",
    });
    return json(200, { ok: true, matched: true, concurrent: true });
  }

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

  // Ligação atendida → pausa cadência (só se toggle ON).
  // customer_id agora vem no match (antes ficava sempre null — bug do plano).
  if (outcome === "answered") {
    try {
      await onCallAnsweredPauseCadence(admin, target.customer_id ?? null);
    } catch (_e) { /* ignore */ }
  }

  // SMS de fallback para NA terminal — exige toggle call_outcome_sms_branch.
  // Idempotente: 1 SMS por (target, tentativa terminal); callback repetido
  // ou reconciliador concorrente não duplicam (reserva em outbound_effects).
  if (!shouldRetry && newStatus === "no_answer" && target.campaign_id && velipConfigured()) {
    if (!(await isAutomationEnabled(admin, "call_outcome_sms_branch"))) {
      return json(200, { ok: true, matched: true, outcome, retry: shouldRetry, sms_skipped: "toggle_off" });
    }
    if (target.fallback_sms_at) {
      return json(200, { ok: true, matched: true, outcome, retry: shouldRetry, sms_skipped: "already_sent" });
    }
    const { data: campFull } = await admin
      .from("voice_campaigns")
      .select("sms_on_no_answer_text")
      .eq("id", target.campaign_id)
      .maybeSingle();
    const smsText = (campFull as { sms_on_no_answer_text?: string | null } | null)?.sms_on_no_answer_text?.trim();
    const smsDest = toVelipSmsDest(dest);
    if (smsText && smsDest && smsDest.length === 13) {
      const eff = await reserveOutboundEffect(admin, {
        idempotencyKey: voiceFallbackSmsKey(target.id, attempts),
        engineKey: "voice_dialer_webhook",
        channel: "sms",
        customerId: target.customer_id ?? null,
        consultantId,
        provider: "velip",
        actionKey: "voice_fallback_sms",
      });
      if (!eff.canSend) {
        return json(200, { ok: true, matched: true, outcome, retry: shouldRetry, sms_skipped: `effect_${eff.status}` });
      }
      try {
        await markEffectSending(admin, eff.effectId);
        const smsRes = await makeSMS({
          to: smsDest,
          message: smsText,
          ctid: toCtid(target.id),
        });
        await admin.from("voice_sms_log").insert({
          consultant_id: consultantId,
          campaign_id: target.campaign_id,
          phone: smsDest,
          message: `[fallback NA] ${smsText}`,
          status: smsRes.ok ? "sent" : "failed",
          velip_sms_id: smsRes.cdls_id ?? null,
          velip_ctid: toCtid(target.id),
          error: smsRes.ok ? null : (smsRes.error ?? "unknown"),
        });
        await finishOutboundEffect(admin, eff.effectId, smsRes.ok ? "sent" : "failed_final", {
          providerRequestId: smsRes.cdls_id ? String(smsRes.cdls_id) : null,
          errorCode: smsRes.ok ? null : String(smsRes.error ?? "sms_failed").slice(0, 120),
        });
        if (smsRes.ok) {
          await admin.from("voice_campaign_targets").update({
            fallback_sms_at: new Date().toISOString(),
            fallback_sms_effect_id: eff.effectId,
          }).eq("id", target.id).is("fallback_sms_at", null);
        }
      } catch (e) {
        // Exceção APÓS chamar o provider → ambíguo: unknown, nunca repetir cego.
        await finishOutboundEffect(admin, eff.effectId, "unknown", {
          errorCode: String((e as Error).message || "exception").slice(0, 120),
        });
        console.error("[voice-webhook] SMS fallback falhou:", (e as Error).message);
      }
    }
  }

  return json(200, { ok: true, matched: true, outcome, retry: shouldRetry });
});
