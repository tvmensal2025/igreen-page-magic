// cadence-tick — cron 5 min do motor "Zero Lead Perdido" (Fases 2 e 3).
//
// COLD_*  → WhatsApp (Evolution/Whapi)
// CALL_*  → Ligação Velip (áudio Sofia pré-gravado)
// SMS_*   → SMS Velip
// META    → placeholder para Fase 5

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  STAGE_MAP,
  computeNextActionAt,
  shouldDispatch,
  isColdOutreachStage,
  type Stage,
} from "../_shared/cadence-engine.ts";
import { isBusinessHour } from "../_shared/business-window.ts";
import { resolveChannelForCustomerWithFailover, isUnavailable, ctx } from "../_shared/channel-sender.ts";
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";
import {
  playAudioFile, makeSMS,
  toVelipBRDest, toCtid, velipConfigured,
} from "../_shared/voice-dialer/velip.ts";
import { resolveCallDialAudio } from "../_shared/voice-dialer/call-stitch.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { gateProactiveTouch, recordProactiveTouch } from "../_shared/retention-orchestrator.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";
import { resolveConsultantConnectedWaPhone } from "../_shared/consultant-wa-phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
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
  RETARGET_ADS_15D: "cadence_retarget_ads_15d",
  RECALL_60D: "cadence_recall_60d",
  RECALL_90D: "cadence_recall_90d",
  RECALL_5M: "cadence_recall_5m",
  RECALL_8M: "cadence_recall_8m",
  RECALL_12M: "cadence_recall_12m",
  RECALL_YEARLY: "cadence_recall_yearly",
};

const DEFAULT_COLD_DAILY_CAP = 60;

/** Cap diário de pessoas frias (BRT) — reutiliza daily_reheat_settings.daily_whapi_cap. */
async function loadColdDailyCap(supabase: any): Promise<number> {
  try {
    const { data } = await supabase
      .from("daily_reheat_settings")
      .select("daily_whapi_cap")
      .limit(1)
      .maybeSingle();
    const n = Number(data?.daily_whapi_cap);
    if (Number.isFinite(n) && n >= 1 && n <= 600) return Math.floor(n);
  } catch { /* fallback */ }
  return DEFAULT_COLD_DAILY_CAP;
}

/** Pessoas distintas tocadas hoje (BRT) em estágios frios. */
async function countColdTouchesToday(supabase: any): Promise<number> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(new Date()); // YYYY-MM-DD
  const startIso = new Date(`${day}T00:00:00-03:00`).toISOString();
  const { data, error } = await supabase
    .from("cadence_action_log")
    .select("customer_id")
    .eq("status", "sent")
    .gte("created_at", startIso)
    .in("stage", [
      "COLD_1", "COLD_2", "COLD_3", "COLD_4",
      "CALL_1", "CALL_2", "CALL_3",
      "SMS_1", "SMS_2",
      "RECALL_60D", "RECALL_90D", "RECALL_5M", "RECALL_8M", "RECALL_12M", "RECALL_YEARLY",
    ]);
  if (error || !data) return 0;
  return new Set(data.map((r: { customer_id: string }) => r.customer_id)).size;
}

/** Lead engajou desde o último toque da cadência? (anti-spam: skip SMS/call). */
async function hasEngagedSinceLastAction(
  supabase: any,
  customerId: string,
  lastActionAt: string | null,
): Promise<boolean> {
  const since = lastActionAt || new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data: state } = await supabase
    .from("lead_cadence_state")
    .select("last_response_at")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (state?.last_response_at && new Date(state.last_response_at) > new Date(since)) {
    return true;
  }
  try {
    const { count } = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("direction", "inbound")
      .gte("created_at", since);
    if ((count || 0) > 0) return true;
  } catch { /* schema pode variar */ }
  return false;
}

function tomorrowMorningBRT(): string {
  const now = new Date();
  // +1 dia 09:00 America/Sao_Paulo (approx -03)
  const d = new Date(now.getTime() + 24 * 3600_000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(d);
  return new Date(`${day}T09:00:00-03:00`).toISOString();
}

interface StageConfig {
  enabled: boolean;
  delay_hours: number;
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
  velip_audio_id: string | null;
  voice_audio_clip_id: string | null;
  personalize_name: boolean;
  max_per_lead: number | null;
  window_start_hour: number | null;
  window_end_hour: number | null;
  window_days: number[] | null;
}

async function loadStageConfig(
  supabase: any,
  consultantId: string | null,
  stage: string,
): Promise<StageConfig | null> {
  const cols = "enabled, delay_hours, message_text, media_url, media_type, velip_audio_id, voice_audio_clip_id, personalize_name, max_per_lead, window_start_hour, window_end_hour, window_days";
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

/** Verifica se `now` (São Paulo) cai na janela específica do estágio. */
function isInStageWindow(now: Date, cfg: StageConfig): boolean {
  if (cfg.window_start_hour == null || cfg.window_end_hour == null) return true;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", hour12: false, weekday: "short", hour: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = map[wd] ?? 1;
  if (Array.isArray(cfg.window_days) && cfg.window_days.length > 0 && !cfg.window_days.includes(dow)) return false;
  return hour >= cfg.window_start_hour && hour < cfg.window_end_hour;
}

/** Conta quantos disparos deste canal já enviados para o lead. */
async function countChannelSends(supabase: any, customerId: string, channel: string): Promise<number> {
  const { count } = await supabase
    .from("cadence_action_log")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("channel", channel)
    .eq("status", "sent");
  return count || 0;
}

/** Dispara notificação formatada de "lead perdido por exaustão de cadência" ao parceiro. */
async function notifyPartnerOfLoss(supabase: any, customerId: string, consultantId: string | null) {
  try {
    const { data: cust } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, referral_partner_id, source_campaign_id, address_city, address_state")
      .eq("id", customerId)
      .maybeSingle();
    if (!cust?.referral_partner_id) return;

    const { data: partner } = await supabase
      .from("referral_partners")
      .select("nome, notification_phone")
      .eq("id", cust.referral_partner_id)
      .maybeSingle();
    if (!partner?.notification_phone) return;

    // Conta tentativas por canal
    const [{ count: wa }, { count: call }, { count: sms }] = await Promise.all([
      supabase.from("cadence_action_log").select("id", { count: "exact", head: true }).eq("customer_id", customerId).eq("channel", "whatsapp").eq("status", "sent"),
      supabase.from("cadence_action_log").select("id", { count: "exact", head: true }).eq("customer_id", customerId).eq("channel", "voice").eq("status", "sent"),
      supabase.from("cadence_action_log").select("id", { count: "exact", head: true }).eq("customer_id", customerId).eq("channel", "sms").eq("status", "sent"),
    ]);

    const cityLine = cust.address_city ? `📍 ${cust.address_city}${cust.address_state ? "/" + cust.address_state : ""}\n` : "";
    const msg =
      `🔴 *Lead esgotado - cadência sem resposta*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 ${cust.name || "sem nome"}\n` +
      `📱 ${cust.phone_whatsapp || "-"}\n` +
      cityLine +
      `\n📊 *Tentativas realizadas:*\n` +
      `   💬 WhatsApp: ${wa ?? 0}\n` +
      `   📞 Ligações: ${call ?? 0}\n` +
      `   💌 SMS: ${sms ?? 0}\n` +
      `\n❗ Lead não respondeu à cadência completa (9 estágios).\n` +
      `➡️ Adicionado automaticamente ao retargeting Meta.`;

    const { sendRawToNumber } = await import("../_shared/notify-consultant.ts");
    await sendRawToNumber(consultantId || "system", partner.notification_phone, msg);

    // Encerra captação silenciosamente
    await supabase.from("customers").update({
      capture_closed_at: new Date().toISOString(),
      capture_closed_by: consultantId,
      capture_mode: null,
    }).eq("id", customerId).is("capture_closed_at", null);
  } catch (e) {
    console.warn("[cadence-tick] notifyPartnerOfLoss failed:", (e as Error).message);
  }
}



function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

/** Todo SMS sai com wa.me do consultor clicável. */
function ensureSmsWaLink(text: string, consultorPhone: string): string {
  let t = String(text || "").trim();
  if (!t) return t;
  if (!/wa\.me\//i.test(t) && !/\{\{\s*consultor_phone\s*\}\}/i.test(t) && !/\{\{\s*link_wa\s*\}\}/i.test(t)) {
    t = `${t} wa.me/{{consultor_phone}}`;
  }
  const phone = String(consultorPhone || "").replace(/\D/g, "");
  const link = phone ? `wa.me/${phone}` : "";
  return t
    .replace(/\{\{\s*link_wa\s*\}\}/gi, link)
    .replace(/\{\{\s*consultor_phone\s*\}\}/gi, phone)
    .replace(/(?:https?:\/\/)?wa\.me\/(?![\d+])/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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

  const gate = await assertBotOutboundAllowed(supabase, {
    customerId: row.customer_id,
    phone: cust.phone_whatsapp,
    consultantId: row.consultant_id,
  });
  if (!gate.allowed) return { ok: false, detail: `suppressed:${gate.reason}` };

  const ch = await resolveChannelForCustomerWithFailover(supabase, row.customer_id, {
    evolutionUrl: env.evolutionUrl,
    evolutionKey: env.evolutionKey,
    whapiToken: env.whapiToken,
  });
  if (isUnavailable(ch)) return { ok: false, detail: `channel_${ch.reason}` };

  const quota = await checkSendQuota(supabase, ch.instanceName);
  if (!quota.allowed) return { ok: false, detail: `quota_${quota.reason}` };

  // Carrega consultor p/ substituir {{consultor}} e {{consultor_phone}} — sem
  // isso, o link `wa.me/{{consultor_phone}}` saía literal ou como `wa.me/`.
  const { consultantName, consultantPhone } = await loadLeadContext(
    supabase, row.customer_id, row.consultant_id,
  );
  const firstName = (cust.name || "").split(" ")[0] || "";
  const text = renderTemplate(cfg.message_text || "", {
    nome: firstName,
    consultor: consultantName,
    consultor_phone: consultantPhone,
  });
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
      .select("name, display_name")
      .eq("id", consultantId).maybeSingle();
    const display = String(c?.display_name || c?.name || "").trim();
    consultantName = display.split(" ")[0] || display;
    // Link wa.me = WhatsApp CONECTADO (chip), nunca notification_phone (alerta humano).
    consultantPhone = await resolveConsultantConnectedWaPhone(supabase, consultantId);
  }
  return { cust, consultantName, consultantPhone };
}

async function dispatchVoiceCall(
  supabase: any, row: any, stage: Stage, cfg: StageConfig,
): Promise<{ ok: boolean; detail: string }> {
  if (!velipConfigured()) return { ok: false, detail: "velip_not_configured" };
  const { cust } = await loadLeadContext(supabase, row.customer_id, row.consultant_id);
  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };
  const dest = toVelipBRDest(cust.phone_whatsapp);
  if (!dest) return { ok: false, detail: "invalid_phone" };

  const ctid = toCtid(`cad_${stage}_${row.customer_id.slice(0, 8)}_${Date.now()}`);

  // Regra Sofia: clip ElevenLabs → Velip. Sem TTS robótico Velip.
  const resolved = await resolveCallDialAudio(supabase, {
    consultantId: row.consultant_id,
    clipId: cfg.voice_audio_clip_id,
    legacyVelipAudioId: cfg.velip_audio_id,
    rawName: cust?.name,
    personalize: Boolean(cfg.personalize_name),
  });
  if (!resolved.ok || !resolved.velip_audio_id) {
    return { ok: false, detail: `sofia_required_no_audio:${resolved.error || "missing"}` };
  }

  try {
    const r = await playAudioFile({ to: dest, audioId: resolved.velip_audio_id, ctid });
    if (!r.ok) return { ok: false, detail: `velip:${r.error || "call_failed"}` };
    const stitchTag = cfg.personalize_name
      ? (resolved.cached ? ":stitched_cached" : ":stitched_new")
      : "";
    return { ok: true, detail: `call_placed:${r.cd_id ?? "?"}${stitchTag}` };
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
  let text = renderTemplate(cfg.message_text || "", {
    nome: firstName,
    consultor: consultantName,
    consultor_phone: consultantPhone,
    link_wa: consultantPhone ? `wa.me/${consultantPhone}` : "",
  });
  text = ensureSmsWaLink(text, consultantPhone);
  if (!text.trim()) return { ok: false, detail: "empty_message" };
  if (!consultantPhone) return { ok: false, detail: "consultant_phone_missing" };

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
  const cronAuth = await assertCronAuth(req, supabase);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

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
  const coldCap = await loadColdDailyCap(supabase);
  let coldTouchesToday = await countColdTouchesToday(supabase);

  // Inclui PAUSED com next_action_at vencido (retoma após inbound).
  // Exclui só WON (CLOSE_LOST / RETARGET_* / RECALL_* avançam na máquina).
  const { data: due, error } = await supabase
    .from("lead_cadence_state")
    .select("id, customer_id, consultant_id, stage, attempts_by_channel, paused_until, last_action_at, last_response_at")
    .lte("next_action_at", now.toISOString())
    .not("stage", "eq", "WON")
    .order("next_action_at", { ascending: true })
    .limit(100);

  if (error) return json({ error: error.message }, 500);
  if (!due || due.length === 0) return json({ processed: 0, cold_cap: coldCap, cold_today: coldTouchesToday });

  const customerIds = due.map((r) => r.customer_id).filter(Boolean);
  const { data: custRows } = await supabase
    .from("customers")
    .select("id, bot_paused, bot_paused_until, assigned_human_id, do_not_contact")
    .in("id", customerIds);
  const blockedCustomers = new Set(
    (custRows || [])
      .filter((c: any) =>
        !!c.do_not_contact ||
        !!c.bot_paused ||
        !!c.assigned_human_id ||
        (c.bot_paused_until && new Date(c.bot_paused_until) > now))
      .map((c: any) => c.id),
  );

  let dispatched = 0, deferred = 0, skipped = 0, sent = 0, failed = 0, resumed = 0;

  for (const row of due) {
    let stage = row.stage as Stage;

    // Retomada pós-inbound: PAUSED vencido → volta à onda curta (COLD_1).
    if (stage === "PAUSED") {
      if (row.paused_until && new Date(row.paused_until) > now) {
        await supabase.from("lead_cadence_state").update({ next_action_at: row.paused_until }).eq("id", row.id);
        deferred++; continue;
      }
      const resumeAt = computeNextActionAt("GREETED", now);
      await supabase.from("lead_cadence_state").update({
        stage: "COLD_1",
        next_action_at: resumeAt?.toISOString() ?? tomorrowMorningBRT(),
        paused_until: null,
        paused_reason: null,
      }).eq("id", row.id);
      resumed++;
      continue;
    }

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

    // Cap 60 pessoas/dia — adia, nunca descarta.
    if (isColdOutreachStage(stage) && coldTouchesToday >= coldCap) {
      await supabase.from("lead_cadence_state").update({
        next_action_at: tomorrowMorningBRT(),
      }).eq("id", row.id);
      deferred++; continue;
    }

    if (def.requiresBusinessHours && !isBusinessHour(now)) {
      const nextSlot = computeNextActionAt(stage, now);
      await supabase.from("lead_cadence_state").update({ next_action_at: nextSlot?.toISOString() }).eq("id", row.id);
      deferred++; continue;
    }
    if (!shouldDispatch(stage, now)) { skipped++; continue; }

    // Anti-spam: SMS/call (e similares) pulam se o lead já engajou.
    if (def.skipIfEngaged) {
      const engaged = await hasEngagedSinceLastAction(
        supabase, row.customer_id, row.last_action_at || null,
      );
      if (engaged) {
        const cfgSkip = await loadStageConfig(supabase, row.consultant_id, def.next);
        const nextAt = computeNextActionAt(def.next, now, cfgSkip?.delay_hours);
        await supabase.from("lead_cadence_state").update({
          stage: def.next,
          next_action_at: nextAt?.toISOString() ?? null,
          paused_reason: null,
        }).eq("id", row.id);
        await supabase.from("cadence_action_log").insert({
          customer_id: row.customer_id, consultant_id: row.consultant_id,
          stage, channel: "system", status: "queued",
          detail: { reason: "skipped_engaged", next: def.next },
        }).then(() => {}, () => {});
        skipped++; continue;
      }
    }

    let status: "queued" | "sent" | "failed" = "queued";
    let detail: Record<string, unknown> = { note: "zero_lead_v5", scheduled_next: def.next };
    let cfgForDelay: StageConfig | null = null;

    const needsDispatch =
      def.channel === "whatsapp" ||
      def.channel === "voice" ||
      def.channel === "sms";

    if (def.channel === "meta_audience" || def.channel === "system") {
      // Avanço de máquina (Meta/ads) — facebook-retarget-sync faz o sync pesado.
      status = "queued";
      detail = { ...detail, reason: "meta_or_system_advance" };
      const stageToggle = STAGE_TOGGLE_KEY[stage];
      if (stageToggle && !(await isAutomationEnabled(supabase, stageToggle))) {
        // Fase longa OFF: adia 24h sem avançar (não perde o lead).
        await supabase.from("lead_cadence_state").update({
          next_action_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
        }).eq("id", row.id);
        await logSkipped(supabase, stageToggle, { customer_id: row.customer_id, stage });
        deferred++; continue;
      }
      cfgForDelay = await loadStageConfig(supabase, row.consultant_id, stage);
    } else if (needsDispatch) {
      const stageToggle = STAGE_TOGGLE_KEY[stage];
      if (stageToggle && !(await isAutomationEnabled(supabase, stageToggle))) {
        await logSkipped(supabase, stageToggle, { customer_id: row.customer_id, stage });
        // Recall/ads OFF: adia (não perde). Onda curta OFF: avança sem enviar (legado).
        if (stage.startsWith("RECALL_") || stage === "RETARGET_ADS_15D") {
          await supabase.from("lead_cadence_state").update({
            next_action_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
          }).eq("id", row.id);
          deferred++; continue;
        }
        detail = { ...detail, reason: "stage_toggle_off", key: stageToggle };
        cfgForDelay = await loadStageConfig(supabase, row.consultant_id, stage);
        // cai no avanço abaixo sem disparar
      } else {
        const cfg = await loadStageConfig(supabase, row.consultant_id, stage);
        cfgForDelay = cfg;
        if (!cfg || !cfg.enabled) {
          if (stage.startsWith("RECALL_") || stage === "RETARGET_ADS_15D") {
            await supabase.from("lead_cadence_state").update({
              next_action_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
            }).eq("id", row.id);
            deferred++; continue;
          }
          detail = { ...detail, reason: "config_disabled_or_missing" };
        } else if (!isInStageWindow(now, cfg)) {
          await supabase.from("lead_cadence_state").update({
            next_action_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
          }).eq("id", row.id);
          deferred++; continue;
        } else if (cfg.max_per_lead && cfg.max_per_lead > 0
                   && (await countChannelSends(supabase, row.customer_id, def.channel)) >= cfg.max_per_lead) {
          await supabase.from("lead_cadence_state").update({
            stage: "CLOSE_LOST",
            next_action_at: computeNextActionAt("CLOSE_LOST", now)?.toISOString() ?? null,
            paused_reason: "channel_limit_reached",
          }).eq("id", row.id);
          await notifyPartnerOfLoss(supabase, row.customer_id, row.consultant_id);
          skipped++; continue;
        } else {
          let res: { ok: boolean; detail: string };
          if (def.channel === "whatsapp") res = await dispatchWhatsApp(supabase, env, row, stage, cfg);
          else if (def.channel === "voice") res = await dispatchVoiceCall(supabase, row, stage, cfg);
          else res = await dispatchSMS(supabase, row, stage, cfg);
          status = res.ok ? "sent" : "failed";
          detail = { ...detail, dispatch: res.detail, via: "evo_or_whapi" };
          if (res.ok) {
            sent++;
            if (isColdOutreachStage(stage)) coldTouchesToday++;
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

    if (status === "failed") {
      await supabase.from("lead_cadence_state").update({
        next_action_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
      }).eq("id", row.id);
      continue;
    }

    // Espera do PRÓXIMO estágio (delay_hours do banco ou STAGE_MAP).
    const nextCfg = await loadStageConfig(supabase, row.consultant_id, def.next);
    const nextAt = computeNextActionAt(def.next, now, nextCfg?.delay_hours ?? null);
    const attempts = (row.attempts_by_channel as Record<string, number>) ?? {};
    attempts[def.channel] = (attempts[def.channel] ?? 0) + 1;

    await supabase.from("lead_cadence_state").update({
      stage: def.next,
      last_action_at: now.toISOString(),
      next_action_at: nextAt?.toISOString() ?? null,
      attempts_by_channel: attempts,
      paused_until: null,
    }).eq("id", row.id);

    if (def.next === "CLOSE_LOST") {
      await notifyPartnerOfLoss(supabase, row.customer_id, row.consultant_id);
    }

    dispatched++;
  }

  return json({
    processed: due.length,
    dispatched,
    deferred,
    skipped,
    sent,
    failed,
    resumed,
    cold_cap: coldCap,
    cold_today: coldTouchesToday,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}