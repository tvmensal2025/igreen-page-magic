// cadence-tick — cron 5 min do motor "Zero Lead Perdido" (Fases 2 e 3).
//
// COLD_*  → WhatsApp (Evolution/Whapi)
// CALL_*  → Ligação Velip (TTS ou áudio pré-gravado)
// SMS_*   → SMS Velip
// META    → placeholder para Fase 5

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { STAGE_MAP, computeNextActionAt, shouldDispatch, type Stage } from "../_shared/cadence-engine.ts";
import { isBusinessHour } from "../_shared/business-window.ts";
import { resolveChannelForCustomer, isUnavailable, ctx } from "../_shared/channel-sender.ts";
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";
import {
  makeTTSCall, playAudioFile, makeSMS,
  toVelipBRDest, toCtid, velipConfigured,
} from "../_shared/voice-dialer/velip.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { gateProactiveTouch, recordProactiveTouch } from "../_shared/retention-orchestrator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Maps cadence stage → automation_toggles.key (per-stage kill switches). */
const STAGE_TOGGLE_KEY: Partial<Record<Stage, string>> = {
  COLD_1: "cadence_cold_1",
  COLD_2: "cadence_cold_2",
  COLD_3: "cadence_cold_3",
  COLD_4: "cadence_cold_4",
  CALL_1: "cadence_call_1",
  CALL_2: "cadence_call_2",
  CALL_3: "cadence_call_3",
  SMS_1: "cadence_sms_1",
  SMS_2: "cadence_sms_2",
};

interface StageConfig {
  enabled: boolean;
  delay_hours: number;
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
  velip_audio_id: string | null;
}

async function loadStageConfig(
  supabase: any,
  consultantId: string | null,
  stage: string,
): Promise<StageConfig | null> {
  const cols = "enabled, delay_hours, message_text, media_url, media_type, velip_audio_id";
  if (consultantId) {
    const { data } = await supabase
      .from("cadence_stage_config")
      .select(cols)
      .eq("consultant_id", consultantId)
      .eq("stage", stage)
      .maybeSingle();
    if (data) return data;
  }
  const { data: g } = await supabase
    .from("cadence_stage_config")
    .select(cols)

    .is("consultant_id", null)
    .eq("stage", stage)
    .maybeSingle();
  return g ?? null;
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

async function dispatchWhatsApp(
  supabase: any,
  env: { evolutionUrl?: string; evolutionKey?: string; whapiToken: string },
  row: any,
  stage: Stage,
  cfg: StageConfig,
): Promise<{ ok: boolean; detail: string }> {
  const { data: cust } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp, consultant_id")
    .eq("id", row.customer_id)
    .maybeSingle();

  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };

  const ch = await resolveChannelForCustomer(supabase, row.customer_id, {
    evolutionUrl: env.evolutionUrl,
    evolutionKey: env.evolutionKey,
    whapiToken: env.whapiToken,
  });
  if (isUnavailable(ch)) return { ok: false, detail: `channel_${ch.reason}` };

  const quota = await checkSendQuota(supabase, ch.instanceName);
  if (!quota.allowed) return { ok: false, detail: `quota_${quota.reason}` };

  const firstName = (cust.name || "").split(" ")[0] || "";
  const text = renderTemplate(cfg.message_text || "", { nome: firstName });
  const jid = `${String(cust.phone_whatsapp).replace(/\D/g, "")}@s.whatsapp.net`;
  const sendCtx = ctx(row.consultant_id || "system", row.customer_id, `cadence:${stage}`);

  try {
    const mtype = cfg.media_type || "text";
    let r;
    if (mtype === "audio" && cfg.media_url) {
      r = await ch.adapter.sendMedia(jid, { kind: "audio", url: cfg.media_url, ptt: true } as any, sendCtx);
    } else if ((mtype === "image" || mtype === "video") && cfg.media_url) {
      r = await ch.adapter.sendMedia(jid, { kind: mtype, url: cfg.media_url, caption: text } as any, sendCtx);
    } else {
      if (!text.trim()) return { ok: false, detail: "empty_message" };
      r = await ch.adapter.sendText(jid, text, { ...sendCtx, supabase } as any);
    }
    if (!(r as any)?.ok) return { ok: false, detail: `send_failed:${(r as any)?.detail ?? "?"}` };
    await registerSend(supabase, ch.instanceName);
    return { ok: true, detail: `sent_via_${ch.kind}` };
  } catch (e) {
    return { ok: false, detail: `exception:${(e as Error).message}` };
  }
}

/** Busca telefone + nome do consultor para merge nas variáveis do template. */
async function loadLeadContext(supabase: any, customerId: string, consultantId: string | null) {
  const { data: cust } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp")
    .eq("id", customerId).maybeSingle();
  let consultantName = "";
  let consultantPhone = "";
  if (consultantId) {
    const { data: c } = await supabase
      .from("consultants")
      .select("name, whatsapp_number, phone")
      .eq("id", consultantId).maybeSingle();
    consultantName = (c?.name || "").split(" ")[0] || "";
    consultantPhone = String(c?.whatsapp_number || c?.phone || "").replace(/\D/g, "");
  }
  return { cust, consultantName, consultantPhone };
}

async function dispatchVoiceCall(
  supabase: any, row: any, stage: Stage, cfg: StageConfig,
): Promise<{ ok: boolean; detail: string }> {
  if (!velipConfigured()) return { ok: false, detail: "velip_not_configured" };
  const { cust, consultantName, consultantPhone } = await loadLeadContext(supabase, row.customer_id, row.consultant_id);
  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };
  const dest = toVelipBRDest(cust.phone_whatsapp);
  if (!dest) return { ok: false, detail: "invalid_phone" };

  const firstName = (cust.name || "").split(" ")[0] || "";
  const text = renderTemplate(cfg.message_text || "", { nome: firstName, consultor: consultantName, consultor_phone: consultantPhone });
  const ctid = toCtid(`cad_${stage}_${row.customer_id.slice(0, 8)}_${Date.now()}`);

  try {
    const r = cfg.velip_audio_id
      ? await playAudioFile({ to: dest, audioId: cfg.velip_audio_id, ctid })
      : await makeTTSCall({ to: dest, ttsText: text, ctid });
    if (!r.ok) return { ok: false, detail: `velip:${r.error || "call_failed"}` };
    return { ok: true, detail: `call_placed:${r.cd_id ?? "?"}` };
  } catch (e) {
    return { ok: false, detail: `exception:${(e as Error).message}` };
  }
}

async function dispatchSMS(
  supabase: any, row: any, stage: Stage, cfg: StageConfig,
): Promise<{ ok: boolean; detail: string }> {
  if (!velipConfigured()) return { ok: false, detail: "velip_not_configured" };
  const { cust, consultantName, consultantPhone } = await loadLeadContext(supabase, row.customer_id, row.consultant_id);
  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };
  const dest = toVelipBRDest(cust.phone_whatsapp);
  if (!dest) return { ok: false, detail: "invalid_phone" };

  const firstName = (cust.name || "").split(" ")[0] || "";
  const text = renderTemplate(cfg.message_text || "", { nome: firstName, consultor: consultantName, consultor_phone: consultantPhone });
  if (!text.trim()) return { ok: false, detail: "empty_message" };

  try {
    // MakeSMSOpts espera `message` — com `text` o SMS sairia "undefined".
    const r = await makeSMS({ to: dest, message: text });
    await supabase.from("voice_sms_log").insert({
      consultant_id: row.consultant_id, phone: dest, message: text,
      velip_sms_id: r.cdls_id ?? null, velip_ctid: (r.raw as { ctid?: string } | undefined)?.ctid ?? null,
      status: r.ok ? "sent" : "failed",
      error: r.ok ? null : (r.error ?? "velip_error"),
      raw: r.raw ?? {}, sent_at: r.ok ? new Date().toISOString() : null,
    });
    if (!r.ok) return { ok: false, detail: `velip:${r.error || "sms_failed"}` };
    return { ok: true, detail: `sms_sent:${r.cdls_id ?? "?"}` };
  } catch (e) {
    return { ok: false, detail: `exception:${(e as Error).message}` };
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
    if (!(await isAutomationEnabled(supabase, "cadence_engine"))) {
      await logSkipped(supabase, "cadence_engine");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "cadence_engine" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }


  const env = {
    evolutionUrl: Deno.env.get("EVOLUTION_API_URL") ?? undefined,
    evolutionKey: Deno.env.get("EVOLUTION_API_KEY") ?? undefined,
    whapiToken: Deno.env.get("WHAPI_TOKEN") ?? "",
  };

  // Kill-switch global
  const { data: settings } = await supabase
    .from("app_settings")
    .select("cadence_engine_enabled")
    .eq("id", "global")
    .maybeSingle();

  if (!settings?.cadence_engine_enabled) {
    return json({ skipped: "cadence_disabled" });
  }

  const now = new Date();
  const { data: due, error } = await supabase
    .from("lead_cadence_state")
    .select("id, customer_id, consultant_id, stage, attempts_by_channel, paused_until")
    .lte("next_action_at", now.toISOString())
    .not("stage", "in", "(CLOSE_LOST,WON,PAUSED,RETARGET_META)")
    .order("next_action_at", { ascending: true })
    .limit(100);

  if (error) return json({ error: error.message }, 500);
  if (!due || due.length === 0) return json({ processed: 0 });

  // Batch: leads com bot pausado (fixo/temporário) ou em mão humana não
  // recebem cadência — a state machine só volta a olhar em 6h.
  const customerIds = due.map((r) => r.customer_id).filter(Boolean);
  const { data: custRows } = await supabase
    .from("customers")
    .select("id, bot_paused, bot_paused_until, assigned_human_id")
    .in("id", customerIds);
  const blockedCustomers = new Set(
    (custRows || [])
      .filter((c: any) =>
        !!c.bot_paused ||
        !!c.assigned_human_id ||
        (c.bot_paused_until && new Date(c.bot_paused_until) > now))
      .map((c: any) => c.id),
  );

  let dispatched = 0, deferred = 0, skipped = 0, sent = 0, failed = 0;

  for (const row of due) {
    const stage = row.stage as Stage;
    if (row.paused_until && new Date(row.paused_until) > now) {
      await supabase.from("lead_cadence_state").update({ next_action_at: row.paused_until }).eq("id", row.id);
      deferred++; continue;
    }
    if (blockedCustomers.has(row.customer_id)) {
      await supabase.from("lead_cadence_state")
        .update({ next_action_at: new Date(now.getTime() + 6 * 3600_000).toISOString() })
        .eq("id", row.id);
      deferred++; continue;
    }
    if (!(await gateProactiveTouch(supabase, row.customer_id, "cadence_engine"))) {
      deferred++; continue;
    }
    const def = STAGE_MAP[stage];
    if (!def) { skipped++; continue; }

    if (def.requiresBusinessHours && !isBusinessHour(now)) {
      const nextSlot = computeNextActionAt(stage, now);
      await supabase.from("lead_cadence_state").update({ next_action_at: nextSlot?.toISOString() }).eq("id", row.id);
      deferred++; continue;
    }
    if (!shouldDispatch(stage, now)) { skipped++; continue; }

    let status: "queued" | "sent" | "failed" = "queued";
    let detail: Record<string, unknown> = { note: "phase3_orchestrator", scheduled_next: def.next };

    const needsDispatch =
      (def.channel === "whatsapp" && stage.startsWith("COLD_")) ||
      (def.channel === "voice"    && stage.startsWith("CALL_")) ||
      (def.channel === "sms"      && stage.startsWith("SMS_"));

    if (needsDispatch) {
      const stageToggle = STAGE_TOGGLE_KEY[stage];
      if (stageToggle && !(await isAutomationEnabled(supabase, stageToggle))) {
        await logSkipped(supabase, stageToggle, { customer_id: row.customer_id, stage });
        detail = { ...detail, reason: "stage_toggle_off", key: stageToggle };
      } else {
        const cfg = await loadStageConfig(supabase, row.consultant_id, stage);
        if (!cfg || !cfg.enabled) {
          detail = { ...detail, reason: "config_disabled_or_missing" };
        } else {
          let res: { ok: boolean; detail: string };
          if (def.channel === "whatsapp") res = await dispatchWhatsApp(supabase, env, row, stage, cfg);
          else if (def.channel === "voice") res = await dispatchVoiceCall(supabase, row, stage, cfg);
          else res = await dispatchSMS(supabase, row, stage, cfg);
          status = res.ok ? "sent" : "failed";
          detail = { ...detail, dispatch: res.detail };
          if (res.ok) {
            sent++;
            await recordProactiveTouch(supabase, row.customer_id, "cadence_engine", { stage, channel: def.channel });
          } else failed++;
        }
      }
    }


    const insertRes = await supabase.from("cadence_action_log").insert({
      customer_id: row.customer_id,
      consultant_id: row.consultant_id,
      stage, channel: def.channel, status, detail,
    });
    if (insertRes.error && !String(insertRes.error.message).includes("duplicate")) {
      console.error("cadence log insert failed", insertRes.error);
    }

    // Falha de disparo NÃO avança a state machine: reagenda o MESMO stage
    // em 30min. (Antes o lead pulava para o próximo stage sem ter recebido
    // nada — etapas inteiras da cadência sumiam em caso de erro.)
    if (status === "failed") {
      await supabase.from("lead_cadence_state").update({
        next_action_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
      }).eq("id", row.id);
      continue;
    }

    const nextAt = computeNextActionAt(def.next, now);
    const attempts = (row.attempts_by_channel as Record<string, number>) ?? {};
    attempts[def.channel] = (attempts[def.channel] ?? 0) + 1;

    await supabase.from("lead_cadence_state").update({
      stage: def.next,
      last_action_at: now.toISOString(),
      next_action_at: nextAt?.toISOString() ?? null,
      attempts_by_channel: attempts,
    }).eq("id", row.id);

    dispatched++;
  }

  return json({ processed: due.length, dispatched, deferred, skipped, sent, failed });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}