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
import { safeFirstNameForAddress, scrubEmptyNameGreeting } from "../_shared/customer-display-name.ts";
import {
  playAudioFile, makeSMS,
  toVelipBRDest, toCtid, velipConfigured,
} from "../_shared/voice-dialer/velip.ts";
import { resolveCallDialAudio } from "../_shared/voice-dialer/call-stitch.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { gateProactiveTouch } from "../_shared/retention-orchestrator.ts";
import {
  cadenceEffectKey,
  finishAutomationRun,
  finishOutboundEffect,
  finishProactiveTouch,
  markEffectSending,
  reserveOutboundEffect,
  reserveProactiveTouch,
  startAutomationRun,
} from "../_shared/journey-effects.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";
import {
  normalizeWaPhoneDigits,
  resolveConsultantConnectedWaPhone,
} from "../_shared/consultant-wa-phone.ts";
import {
  loadLastThemeId,
  needsSmsTheme,
  needsWhatsAppTheme,
  pickCadenceTheme,
} from "../_shared/cadence-themes.ts";
import {
  buildAvailabilityPhrase,
  createAvailabilityLoader,
  type AvailabilityOverrides,
} from "../_shared/cadence-availability.ts";
import { syncCustomerToMetaAudience } from "../_shared/meta-audience-sync.ts";
import { resolveStageButtons } from "../_shared/cadence-stage-buttons.ts";
import {
  decideAudienceDdd,
  loadCadenceAudienceConfig,
} from "../_shared/audience-ddd.ts";

type AvailLoader = (consultantId: string | null | undefined) => Promise<AvailabilityOverrides>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

/** Maps cadence stage → automation_toggles.key (per-stage kill switches). */
const STAGE_TOGGLE_KEY: Partial<Record<Stage, string>> = {
  A_NUDGE: "cadence_a_nudge",
  A_SMS: "cadence_a_sms",
  A_CALL: "cadence_a_call",
  A_CALL_RETRY: "cadence_a_call",
  COLD_1: "cadence_cold_1",
  COLD_2: "cadence_cold_2",
  COLD_3: "cadence_cold_3",
  COLD_4: "cadence_cold_4",
  CALL_1: "cadence_call_1",
  CALL_2: "cadence_call_2",
  CALL_3: "cadence_call_3",
  SMS_1: "cadence_sms_1",
  SMS_2: "cadence_sms_2",
  SMS_TEMA_2: "cadence_sms_tema_2",
  SMS_TEMA_7: "cadence_sms_tema_7",
  RETARGET_ADS_15D: "cadence_retarget_ads_15d",
  // Grupo C: SMS/CALL do marco compartilham o toggle do WA principal
  RECALL_60D: "cadence_recall_60d",
  RECALL_60D_SMS: "cadence_recall_60d",
  RECALL_60D_CALL: "cadence_recall_60d",
  RECALL_90D: "cadence_recall_90d",
  RECALL_90D_SMS: "cadence_recall_90d",
  RECALL_90D_CALL: "cadence_recall_90d",
  RECALL_5M: "cadence_recall_5m",
  RECALL_5M_SMS: "cadence_recall_5m",
  RECALL_5M_CALL: "cadence_recall_5m",
  RECALL_8M: "cadence_recall_8m",
  RECALL_8M_SMS: "cadence_recall_8m",
  RECALL_8M_CALL: "cadence_recall_8m",
  RECALL_12M: "cadence_recall_12m",
  RECALL_12M_SMS: "cadence_recall_12m",
  RECALL_12M_CALL: "cadence_recall_12m",
  RECALL_YEARLY: "cadence_recall_yearly",
  RECALL_YEARLY_SMS: "cadence_recall_yearly",
  RECALL_YEARLY_CALL: "cadence_recall_yearly",
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
      "SMS_1", "SMS_2", "SMS_TEMA_2", "SMS_TEMA_7",
      "RECALL_60D", "RECALL_60D_SMS", "RECALL_60D_CALL",
      "RECALL_90D", "RECALL_90D_SMS", "RECALL_90D_CALL",
      "RECALL_5M", "RECALL_5M_SMS", "RECALL_5M_CALL",
      "RECALL_8M", "RECALL_8M_SMS", "RECALL_8M_CALL",
      "RECALL_12M", "RECALL_12M_SMS", "RECALL_12M_CALL",
      "RECALL_YEARLY", "RECALL_YEARLY_SMS", "RECALL_YEARLY_CALL",
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
  /** ContentContract (painel Multicanal). null = fallback hardcoded. */
  buttons?: unknown;
}

async function loadStageConfig(
  supabase: any,
  consultantId: string | null,
  stage: string,
): Promise<StageConfig | null> {
  // Preferência: colunas do ContentContract (inclui buttons). Se o select falhar
  // (coluna ainda não migrada em algum ambiente), cai no select legado.
  const colsFull =
    "enabled, delay_hours, message_text, media_url, media_type, velip_audio_id, voice_audio_clip_id, personalize_name, max_per_lead, window_start_hour, window_end_hour, window_days, buttons";
  const colsLegacy =
    "enabled, delay_hours, message_text, media_url, media_type, velip_audio_id, voice_audio_clip_id, personalize_name, max_per_lead, window_start_hour, window_end_hour, window_days";

  async function pick(consultantFilter: string | null): Promise<StageConfig | null> {
    let q = supabase.from("cadence_stage_config").select(colsFull).eq("stage", stage);
    q = consultantFilter
      ? q.eq("consultant_id", consultantFilter)
      : q.is("consultant_id", null);
    const { data, error } = await q.maybeSingle();
    if (!error && data) return data as StageConfig;
    if (error) {
      let q2 = supabase.from("cadence_stage_config").select(colsLegacy).eq("stage", stage);
      q2 = consultantFilter
        ? q2.eq("consultant_id", consultantFilter)
        : q2.is("consultant_id", null);
      const { data: legacy } = await q2.maybeSingle();
      return (legacy as StageConfig) ?? null;
    }
    return null;
  }

  if (consultantId) {
    const own = await pick(consultantId);
    if (own) return own;
  }
  return await pick(null);
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
  let out = tpl;
  const nome = String(vars.nome || "").trim();
  if (!nome) {
    out = scrubEmptyNameGreeting(out);
  }
  out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
  if (!nome) {
    out = scrubEmptyNameGreeting(out);
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Fail-closed de identidade (PLANO §10): se o template exige {{consultor}} /
 * {{consultor_phone}} e não temos valor real, NÃO enviar — nunca inventar nome.
 */
function missingIdentityVar(tpl: string, consultantName: string, consultantPhone: string): string | null {
  if (/\{\{\s*consultor\s*\}\}/i.test(tpl) && !consultantName.trim()) return "consultor";
  if (/\{\{\s*(consultor_phone|link_wa)\s*\}\}/i.test(tpl) && !consultantPhone.trim()) return "consultor_phone";
  return null;
}

/** Todo SMS sai com https://wa.me do consultor clicável. */
function ensureSmsWaLink(text: string, consultorPhone: string): string {
  let t = String(text || "").trim();
  if (!t) return t;
  if (!/wa\.me\//i.test(t) && !/\{\{\s*consultor_phone\s*\}\}/i.test(t) && !/\{\{\s*link_wa\s*\}\}/i.test(t)) {
    t = `${t} https://wa.me/{{consultor_phone}}`;
  }
  const phone = normalizeWaPhoneDigits(consultorPhone);
  const link = phone ? `https://wa.me/${phone}` : "";
  return t
    .replace(/\{\{\s*link_wa\s*\}\}/gi, link)
    .replace(/\{\{\s*consultor_phone\s*\}\}/gi, phone)
    .replace(/(?:https?:\/\/)?wa\.me\/(?=[\d+]|\{\{)/gi, "https://wa.me/")
    .replace(/(?:https?:\/\/)?wa\.me\/(?![\d+])/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type DispatchResult = {
  ok: boolean;
  detail: string;
  theme_id?: string;
  /** Texto exatamente enviado (já com {{nome}} resolvido ou vazio). */
  message_body?: string;
  /** true = usou prenome confiável; false = só o corpo. */
  with_name?: boolean;
  media_url?: string;
  media_type?: string;
};

async function dispatchWhatsApp(
  supabase: any,
  env: { evolutionUrl?: string; evolutionKey?: string; whapiToken: string },
  row: any,
  stage: Stage,
  cfg: StageConfig,
  loadAvail: AvailLoader,
): Promise<DispatchResult> {
  const { data: cust } = await supabase
    .from("customers")
    .select("id, name, name_source, phone_whatsapp, consultant_id")
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
  const { consultantName, consultantPhone, assistantName } = await loadLeadContext(
    supabase, row.customer_id, row.consultant_id,
  );
  const firstName = safeFirstNameForAddress(cust.name, (cust as any).name_source);
  let rawTpl = cfg.message_text || "";
  let themeId: string | undefined;
  if (needsWhatsAppTheme(rawTpl, stage)) {
    const last = await loadLastThemeId(supabase, row.customer_id);
    const theme = pickCadenceTheme({ customerId: row.customer_id, stage, lastThemeId: last });
    themeId = theme.id;
    rawTpl = rawTpl.includes("{{tema_whatsapp}}")
      ? rawTpl.replaceAll("{{tema_whatsapp}}", theme.wa)
      : theme.wa;
  }
  const availOverrides = await loadAvail(row.consultant_id);
  const { phrase: fraseDisponibilidade } = buildAvailabilityPhrase(new Date(), availOverrides);
  const missingVar = missingIdentityVar(rawTpl, consultantName, consultantPhone);
  if (missingVar) return { ok: false, detail: `identity_missing:${missingVar}` };
  const text = renderTemplate(rawTpl, {
    nome: firstName,
    consultor: consultantName,
    assistente: assistantName,
    consultor_phone: consultantPhone,
    frase_disponibilidade: fraseDisponibilidade,
  });
  const jid = `${String(cust.phone_whatsapp).replace(/\D/g, "")}@s.whatsapp.net`;
  const sendCtx = ctx(row.consultant_id || "system", row.customer_id, `cadence:${stage}`, String(row.id || ""));

  try {
    const mtype = cfg.media_type || "text";
    let r;
    if (mtype === "audio" && cfg.media_url) {
      r = await ch.adapter.sendMedia(jid, { kind: "audio", url: cfg.media_url, ptt: true } as any, sendCtx);
    } else if ((mtype === "image" || mtype === "video") && cfg.media_url) {
      r = await ch.adapter.sendMedia(jid, { kind: mtype, url: cfg.media_url, caption: text } as any, sendCtx);
    } else {
      if (!text.trim()) return { ok: false, detail: "empty_message" };
      // Dual-read: botões do painel Multicanal (cadence_stage_config.buttons)
      // quando válidos; fallback hardcoded quando null/inválido.
      const stageButtons = resolveStageButtons(cfg.buttons, stage);
      const adapterWithButtons = ch.adapter as typeof ch.adapter & {
        sendButtons?: (jid: string, text: string, buttons: unknown, ctx: unknown) => Promise<unknown>;
      };
      if (stageButtons.length > 0 && typeof adapterWithButtons.sendButtons === "function") {
        r = await adapterWithButtons.sendButtons(jid, text, stageButtons, { ...sendCtx, supabase } as any);
      } else {
        r = await ch.adapter.sendText(jid, text, { ...sendCtx, supabase } as any);
      }
    }
    if (!(r as any)?.ok) return { ok: false, detail: `send_failed:${(r as any)?.detail ?? "?"}` };
    await registerSend(supabase, ch.instanceName);
    const externalId = String((r as any)?.messageId || "").trim() || null;
    const bodyForLog =
      mtype === "audio" && cfg.media_url
        ? "[áudio]"
        : (text || "").trim() || (cfg.media_url ? `[${mtype}]` : "");
    await supabase.from("conversations").insert({
      customer_id: row.customer_id,
      message_direction: "outbound",
      message_text: bodyForLog || null,
      message_type: mtype === "audio" ? "audio" : mtype === "image" || mtype === "video" ? mtype : "text",
      conversation_step: `cadence:${stage}`,
      external_message_id: externalId,
      delivery_status: "sent",
      origin: "cadence",
    }).then(() => {}, () => {});
    const themeTag = themeId ? `:theme_${themeId}` : "";
    return {
      ok: true,
      detail: `sent_via_${ch.kind}${themeTag}`,
      theme_id: themeId,
      message_body: bodyForLog || undefined,
      with_name: !!firstName,
      media_url: cfg.media_url || undefined,
      media_type: mtype,
    };
  } catch (e) {
    return { ok: false, detail: `exception:${(e as Error).message}` };
  }
}

/** Busca telefone + nome + IA do consultor para merge nas variáveis do template. */
async function loadLeadContext(supabase: any, customerId: string, consultantId: string | null) {
  const { data: cust } = await supabase
    .from("customers")
    .select("id, name, name_source, phone_whatsapp")
    .eq("id", customerId).maybeSingle();
  let consultantName = "";
  let consultantPhone = "";
  let assistantName = "";
  if (consultantId) {
    const { data: c } = await supabase
      .from("consultants")
      .select("name, display_name, assistant_name")
      .eq("id", consultantId).maybeSingle();
    const display = String(c?.display_name || c?.name || "").trim();
    // Preferência: display_name humano; evita slug (tvmensal12) virar "nome".
    const isSlugLike =
      display.length > 0 &&
      !/\s/.test(display) &&
      display === display.toLowerCase() &&
      (/\d/.test(display) || display.length >= 9);
    consultantName = isSlugLike
      ? ""
      : (display.split(" ")[0] || display);
    assistantName = String((c as { assistant_name?: string | null })?.assistant_name || "").trim();
    // Link wa.me = WhatsApp CONECTADO (chip), nunca notification_phone (alerta humano).
    consultantPhone = await resolveConsultantConnectedWaPhone(supabase, consultantId);
  }
  return { cust, consultantName, consultantPhone, assistantName };
}

async function dispatchVoiceCall(
  supabase: any, row: any, stage: Stage, cfg: StageConfig,
): Promise<{ ok: boolean; detail: string }> {
  if (!velipConfigured()) return { ok: false, detail: "velip_not_configured" };
  const { cust } = await loadLeadContext(supabase, row.customer_id, row.consultant_id);
  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };

  const gate = await assertBotOutboundAllowed(supabase, {
    customerId: row.customer_id,
    phone: cust.phone_whatsapp,
    consultantId: row.consultant_id,
  });
  if (!gate.allowed) return { ok: false, detail: `suppressed:${gate.reason}` };

  const dest = toVelipBRDest(cust.phone_whatsapp);
  if (!dest) return { ok: false, detail: "invalid_phone" };

  // Ctid estável por (estágio, sequência da jornada) — sem timestamp; ciclos
  // anuais do Grupo C ganham sequência nova, então não colidem.
  const ctid = toCtid(`cad_${stage}_s${Number(row.stage_sequence ?? 0)}_${row.customer_id.slice(0, 8)}`);

  // Regra Sofia: clip ElevenLabs → Velip. Sem TTS robótico Velip.
  // Sem nome digitado/confiável → só o CORPO (sem intro "Olá, Nome").
  const resolved = await resolveCallDialAudio(supabase, {
    consultantId: row.consultant_id,
    clipId: cfg.voice_audio_clip_id,
    legacyVelipAudioId: cfg.velip_audio_id,
    rawName: cust?.name,
    nameSource: (cust as { name_source?: string | null })?.name_source ?? null,
    personalize: Boolean(cfg.personalize_name),
  });
  if (!resolved.ok || !resolved.velip_audio_id) {
    return { ok: false, detail: `sofia_required_no_audio:${resolved.error || "missing"}` };
  }

  try {
    const r = await playAudioFile({ to: dest, audioId: resolved.velip_audio_id, ctid });
    if (!r.ok) return { ok: false, detail: `velip:${r.error || "call_failed"}` };
    const stitchTag = cfg.personalize_name
      ? (resolved.fallback_body
        ? ":body_only"
        : (resolved.cached ? ":stitched_cached" : ":stitched_new"))
      : "";
    return { ok: true, detail: `call_placed:${r.cd_id ?? "?"}${stitchTag}` };
  } catch (e) {
    return { ok: false, detail: `exception:${(e as Error).message}` };
  }
}

async function dispatchSMS(
  supabase: any, row: any, stage: Stage, cfg: StageConfig, loadAvail: AvailLoader,
): Promise<DispatchResult> {
  if (!velipConfigured()) return { ok: false, detail: "velip_not_configured" };
  const { cust, consultantName, consultantPhone, assistantName } = await loadLeadContext(supabase, row.customer_id, row.consultant_id);
  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };

  const gate = await assertBotOutboundAllowed(supabase, {
    customerId: row.customer_id,
    phone: cust.phone_whatsapp,
    consultantId: row.consultant_id,
  });
  if (!gate.allowed) return { ok: false, detail: `suppressed:${gate.reason}` };

  const dest = toVelipBRDest(cust.phone_whatsapp);
  if (!dest) return { ok: false, detail: "invalid_phone" };

  const firstName = safeFirstNameForAddress(cust.name, (cust as any).name_source);
  let rawTpl = cfg.message_text || "";
  let themeId: string | undefined;
  if (needsSmsTheme(rawTpl, stage)) {
    const last = await loadLastThemeId(supabase, row.customer_id);
    const theme = pickCadenceTheme({ customerId: row.customer_id, stage, lastThemeId: last });
    themeId = theme.id;
    rawTpl = rawTpl.includes("{{tema_sms}}")
      ? rawTpl.replaceAll("{{tema_sms}}", theme.sms)
      : theme.sms;
  }
  const availOverrides = await loadAvail(row.consultant_id);
  const { phrase: fraseDisponibilidade } = buildAvailabilityPhrase(new Date(), availOverrides);
  const missingSmsVar = missingIdentityVar(rawTpl, consultantName, consultantPhone);
  if (missingSmsVar) return { ok: false, detail: `identity_missing:${missingSmsVar}` };
  let text = renderTemplate(rawTpl, {
    nome: firstName,
    consultor: consultantName,
    assistente: assistantName,
    consultor_phone: consultantPhone,
    link_wa: consultantPhone ? `https://wa.me/${consultantPhone}` : "",
    frase_disponibilidade: fraseDisponibilidade,
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
    if (!r.ok) {
      return {
        ok: false,
        detail: `velip:${r.error || "sms_failed"}`,
        message_body: text,
        with_name: !!firstName,
      };
    }
    const themeTag = themeId ? `:theme_${themeId}` : "";
    return {
      ok: true,
      detail: `sms_sent:${r.cdls_id ?? "?"}${themeTag}`,
      theme_id: themeId,
      message_body: text,
      with_name: !!firstName,
    };
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
  // deno-lint-ignore no-explicit-any
  const cronAuth = await assertCronAuth(req, supabase as any);
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
  const loadAvail = createAvailabilityLoader(supabase);
  const coldCap = await loadColdDailyCap(supabase);
  let coldTouchesToday = await countColdTouchesToday(supabase);
  const audienceCfg = await loadCadenceAudienceConfig(supabase);
  const runId = await startAutomationRun(supabase, "cadence_engine", { triggerKind: "cron" });

  // Reabre claims órfãos (lease expirado) — best-effort; RPC pode ainda não existir.
  try {
    await supabase.rpc("reconcile_stuck_cadence_claims");
  } catch { /* migration pendente */ }
  // Efeitos órfãos (reserved/sending velhos) → released/unknown.
  try {
    await supabase.rpc("reconcile_stale_outbound_effects", { p_reserved_minutes: 30, p_sending_minutes: 30 });
  } catch { /* migration pendente */ }

  // Claim atômico (RPC). Fallback: SELECT + CAS em next_action_at (anti-duplicidade).
  let due: any[] | null = null;
  const { data: claimedRows, error: claimErr } = await supabase.rpc("claim_due_cadence", {
    p_limit: 100,
  });
  if (!claimErr && Array.isArray(claimedRows)) {
    due = claimedRows;
  } else {
    if (claimErr) {
      console.warn("[cadence-tick] claim_due_cadence indisponível — fallback CAS", claimErr.message);
    }
    const { data: selected, error } = await supabase
      .from("lead_cadence_state")
      .select("id, customer_id, consultant_id, stage, stage_sequence, attempts_by_channel, paused_until, paused_reason, last_action_at, last_response_at, next_action_at, claim_token")
      .lte("next_action_at", now.toISOString())
      .not("stage", "eq", "WON")
      .order("next_action_at", { ascending: true })
      .limit(100);
    if (error) {
      await finishAutomationRun(supabase, runId, "failed", {}, "select_due_failed");
      return json({ error: error.message }, 500);
    }
    due = [];
    for (const row of selected || []) {
      const leaseUntil = new Date(now.getTime() + 15 * 60_000).toISOString();
      const q = supabase
        .from("lead_cadence_state")
        .update({ next_action_at: leaseUntil })
        .eq("id", row.id);
      const cas = row.next_action_at
        ? await q.eq("next_action_at", row.next_action_at).select("id, claim_token").maybeSingle()
        : await q.select("id, claim_token").maybeSingle();
      if (cas.data?.id) {
        due.push({ ...row, next_action_at: leaseUntil, claim_token: cas.data.claim_token ?? row.claim_token });
      }
    }
  }

  if (!due || due.length === 0) {
    await finishAutomationRun(supabase, runId, "completed", { processed: 0 });
    return json({ processed: 0, cold_cap: coldCap, cold_today: coldTouchesToday });
  }

  const customerIds = due.map((r) => r.customer_id).filter(Boolean);
  const { data: custRows } = await supabase
    .from("customers")
    .select("id, phone_whatsapp, bot_paused, bot_paused_until, assigned_human_id, do_not_contact")
    .in("id", customerIds);
  const custById = new Map((custRows || []).map((c: any) => [c.id, c]));
  const blockedCustomers = new Set(
    (custRows || [])
      .filter((c: any) =>
        !!c.do_not_contact ||
        !!c.bot_paused ||
        !!c.assigned_human_id ||
        (c.bot_paused_until && new Date(c.bot_paused_until) > now))
      .map((c: any) => c.id),
  );

  let dispatched = 0, deferred = 0, skipped = 0, sent = 0, failed = 0, resumed = 0, audienceBlocked = 0;

  /** Update que só aplica se ainda formos donos do claim (quando há token). */
  async function finishRow(id: string, claimToken: string | null | undefined, patch: Record<string, unknown>) {
    const body = claimToken
      ? {
        ...patch,
        claim_token: null,
        claimed_at: null,
        lease_expires_at: null,
      }
      : patch;
    let q = supabase.from("lead_cadence_state").update(body).eq("id", id);
    if (claimToken) q = q.eq("claim_token", claimToken);
    const { data } = await q.select("id").maybeSingle();
    if (data?.id) return;
    // Token ausente/mismatch ou colunas ainda não migradas — não deixa o lead preso.
    await supabase.from("lead_cadence_state").update(patch).eq("id", id);
  }

  for (const row of due) {
    let stage = row.stage as Stage;
    const claimToken = row.claim_token as string | null | undefined;

    // Público piloto (DDD): fora do DDD não envia; adia sem apagar.
    const cust = custById.get(row.customer_id);
    const aud = decideAudienceDdd(cust?.phone_whatsapp, audienceCfg);
    if (aud.reason === "shadow_observe") {
      console.log("[cadence-tick] audience_shadow", { customer_id: row.customer_id, ddd: aud.ddd, mode: aud.mode });
    }
    if (!aud.allowed) {
      await finishRow(row.id, claimToken, {
        next_action_at: new Date(now.getTime() + 6 * 3600_000).toISOString(),
        paused_reason: aud.reason === "invalid_phone" ? "invalid_phone" : `outside_ddd_${aud.ddd}`,
      });
      audienceBlocked++;
      deferred++;
      continue;
    }

    // Retomada pós-inbound: PAUSED vencido.
    // - Grupo C (paused_reason lead_responded:<STAGE>): retoma o mesmo estágio.
    // - Onda B / sem estágio salvo: reaquece em COLD_1 (comportamento antigo).
    if (stage === "PAUSED") {
      if (row.paused_until && new Date(row.paused_until) > now) {
        await finishRow(row.id, claimToken, { next_action_at: row.paused_until });
        deferred++; continue;
      }
      const reason = String(row.paused_reason || "");
      const saved = reason.startsWith("lead_responded:")
        ? reason.slice("lead_responded:".length)
        : "";
      const savedIsC =
        saved === "CLOSE_LOST" ||
        saved.startsWith("RETARGET_") ||
        saved.startsWith("RECALL_");
      const resumeStage = (savedIsC && STAGE_MAP[saved as Stage] ? saved : "COLD_1") as Stage;
      // COLD_1: delay de GREETED (D+1). Grupo C: retoma já no próximo slot útil
      // (não reaplica o delay longo do marco — senão espera mais 14d+ à toa).
      const resumeAtIso =
        resumeStage === "COLD_1"
          ? (computeNextActionAt("GREETED", now)?.toISOString() ?? tomorrowMorningBRT())
          : tomorrowMorningBRT();
      await finishRow(row.id, claimToken, {
        stage: resumeStage,
        next_action_at: resumeAtIso,
        paused_until: null,
        paused_reason: null,
      });
      resumed++;
      continue;
    }

    if (row.paused_until && new Date(row.paused_until) > now) {
      await finishRow(row.id, claimToken, { next_action_at: row.paused_until });
      deferred++; continue;
    }
    if (blockedCustomers.has(row.customer_id)) {
      await finishRow(row.id, claimToken, {
        next_action_at: new Date(now.getTime() + 6 * 3600_000).toISOString(),
      });
      deferred++; continue;
    }
    if (!(await gateProactiveTouch(supabase, row.customer_id, "cadence_engine"))) {
      // Mantém lease (já empurrado); não reabrir no mesmo tick.
      deferred++; continue;
    }

    const def = STAGE_MAP[stage];
    if (!def) { skipped++; continue; }

    // Cap 60 pessoas/dia — adia, nunca descarta.
    if (isColdOutreachStage(stage) && coldTouchesToday >= coldCap) {
      await finishRow(row.id, claimToken, {
        next_action_at: tomorrowMorningBRT(),
      });
      deferred++; continue;
    }

    if (def.requiresBusinessHours && !isBusinessHour(now)) {
      const nextSlot = computeNextActionAt(stage, now);
      await finishRow(row.id, claimToken, { next_action_at: nextSlot?.toISOString() });
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
        await finishRow(row.id, claimToken, {
          stage: def.next,
          next_action_at: nextAt?.toISOString() ?? null,
          paused_reason: null,
        });
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
      status = "queued";
      detail = { ...detail, reason: "meta_or_system_advance" };
      const stageToggle = STAGE_TOGGLE_KEY[stage];
      if (stageToggle && !(await isAutomationEnabled(supabase, stageToggle))) {
        // Fase longa OFF: adia 24h sem avançar (não perde o lead).
        await finishRow(row.id, claimToken, {
          next_action_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
        });
        await logSkipped(supabase, stageToggle, { customer_id: row.customer_id, stage });
        deferred++; continue;
      }
      // CLOSE_LOST / RETARGET_META: sync se facebook_retarget_sync ON.
      // RETARGET_ADS_15D: sync se cadence_retarget_ads_15d ON (já passou no gate).
      if (def.channel === "meta_audience") {
        const bulkOn = await isAutomationEnabled(supabase, "facebook_retarget_sync");
        const canSync =
          stage === "RETARGET_ADS_15D" ||
          ((stage === "CLOSE_LOST" || stage === "RETARGET_META") && bulkOn);
        if (canSync) {
          // Efeito idempotente: 1 sync lógico por (jornada, estágio, sequência).
          const effKey = cadenceEffectKey(String(row.id), stage, Number(row.stage_sequence ?? 0), "meta_audience");
          const eff = await reserveOutboundEffect(supabase, {
            idempotencyKey: effKey,
            engineKey: "cadence_engine",
            channel: "meta_audience",
            customerId: row.customer_id,
            consultantId: row.consultant_id,
            journeyId: row.id,
            stage,
            stageSequence: Number(row.stage_sequence ?? 0),
            provider: "meta",
            runId,
            claimId: claimToken ?? null,
          });
          if (eff.canSend) {
            await markEffectSending(supabase, eff.effectId);
            const meta = await syncCustomerToMetaAudience(supabase, {
              customerId: row.customer_id,
              consultantId: row.consultant_id,
              stage,
              dryRun: false,
            });
            detail = {
              ...detail,
              meta_sync: meta.detail,
              meta_ok: meta.ok,
              audience_id: meta.audience_id ?? null,
              effect_id: eff.effectId,
            };
            if (meta.ok) status = "sent";
            await finishOutboundEffect(
              supabase, eff.effectId,
              meta.ok ? "sent" : "failed_retryable",
              { providerStatus: String(meta.detail || "").slice(0, 200) },
            );
          } else if (eff.status === "sent" || eff.status === "delivered") {
            // Sync já feito numa execução anterior (crash pós-envio): só avança.
            detail = { ...detail, meta_sync: "effect_already_sent", effect_id: eff.effectId };
          } else {
            // reserved/sending/unknown/erro → outro worker ou ambíguo: adia.
            await finishRow(row.id, claimToken, {
              next_action_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
            });
            detail = { ...detail, meta_sync: `effect_${eff.status}` };
            deferred++; continue;
          }
        } else {
          detail = { ...detail, meta_sync: "skipped_toggle_off" };
        }
      }
      cfgForDelay = await loadStageConfig(supabase, row.consultant_id, stage);
    } else if (needsDispatch) {
      const stageToggle = STAGE_TOGGLE_KEY[stage];
      if (stageToggle && !(await isAutomationEnabled(supabase, stageToggle))) {
        await logSkipped(supabase, stageToggle, { customer_id: row.customer_id, stage });
        // Recall/ads OFF: adia (não perde). Onda curta / SMS tema OFF: avança sem enviar.
        if (stage.startsWith("RECALL_") || stage === "RETARGET_ADS_15D") {
          await finishRow(row.id, claimToken, {
            next_action_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
          });
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
            await finishRow(row.id, claimToken, {
              next_action_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
            });
            deferred++; continue;
          }
          detail = { ...detail, reason: "config_disabled_or_missing" };
        } else if (!isInStageWindow(now, cfg)) {
          await finishRow(row.id, claimToken, {
            next_action_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
          });
          deferred++; continue;
        } else if (cfg.max_per_lead && cfg.max_per_lead > 0
                   && (await countChannelSends(supabase, row.customer_id, def.channel)) >= cfg.max_per_lead) {
          await finishRow(row.id, claimToken, {
            stage: "CLOSE_LOST",
            next_action_at: computeNextActionAt("CLOSE_LOST", now)?.toISOString() ?? null,
            paused_reason: "channel_limit_reached",
          });
          await notifyPartnerOfLoss(supabase, row.customer_id, row.consultant_id);
          skipped++; continue;
        } else {
          // 1) Orquestrador atômico: reserva o direito de tocar o cliente.
          //    Fail-closed: erro de banco/reserva → não envia neste tick.
          const touch = await reserveProactiveTouch(supabase, row.customer_id, "cadence_engine", {
            stage, channel: def.channel,
          });
          if (!touch.allowed) {
            await logSkipped(supabase, "retention_orchestrator", {
              customer_id: row.customer_id, source: "cadence_engine",
              blocked_by: touch.blockedBy, reason: touch.reason,
            });
            deferred++; continue; // lease do claim segura a linha até o próximo tick
          }

          // 2) Efeito idempotente: 1 envio lógico por (jornada, estágio, sequência, canal).
          const effKey = cadenceEffectKey(String(row.id), stage, Number(row.stage_sequence ?? 0), def.channel);
          const eff = await reserveOutboundEffect(supabase, {
            idempotencyKey: effKey,
            engineKey: "cadence_engine",
            channel: def.channel as "whatsapp" | "sms" | "voice",
            customerId: row.customer_id,
            consultantId: row.consultant_id,
            journeyId: row.id,
            stage,
            stageSequence: Number(row.stage_sequence ?? 0),
            provider: def.channel === "whatsapp" ? "evolution_whapi" : "velip",
            runId,
            claimId: claimToken ?? null,
          });

          if (!eff.canSend) {
            await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
            if (eff.status === "sent" || eff.status === "delivered") {
              // Envio já ocorreu (ex.: worker morreu entre enviar e avançar):
              // NÃO reenvia — apenas deixa avançar o estágio abaixo.
              detail = { ...detail, dispatch: "effect_already_sent", effect_id: eff.effectId };
              status = "queued";
            } else {
              // reserved/sending → outro worker; unknown → ambíguo (reconciliar);
              // suppressed/failed_final/erro → não reenviar automaticamente.
              const deferMin = (eff.status === "suppressed" || eff.status === "failed_final") ? 360 : 30;
              await finishRow(row.id, claimToken, {
                next_action_at: new Date(now.getTime() + deferMin * 60_000).toISOString(),
              });
              detail = { ...detail, dispatch: `effect_${eff.status}`, effect_id: eff.effectId };
              deferred++; continue;
            }
          } else {
            await markEffectSending(supabase, eff.effectId);
            let res: DispatchResult;
            if (def.channel === "whatsapp") res = await dispatchWhatsApp(supabase, env, row, stage, cfg, loadAvail);
            else if (def.channel === "voice") {
              const voice = await dispatchVoiceCall(supabase, row, stage, cfg);
              res = { ok: voice.ok, detail: voice.detail };
            } else res = await dispatchSMS(supabase, row, stage, cfg, loadAvail);
            status = res.ok ? "sent" : "failed";
            detail = {
              ...detail,
              dispatch: res.detail,
              via: "evo_or_whapi",
              effect_id: eff.effectId,
              ...(res.theme_id ? { theme_id: res.theme_id } : {}),
              ...(res.message_body != null ? { message_body: res.message_body } : {}),
              ...(typeof res.with_name === "boolean" ? { with_name: res.with_name } : {}),
              ...(res.media_url ? { media_url: res.media_url } : {}),
              ...(res.media_type ? { media_type: res.media_type } : {}),
            };
            if (res.ok) {
              sent++;
              if (isColdOutreachStage(stage)) coldTouchesToday++;
              await finishOutboundEffect(supabase, eff.effectId, "sent", {
                providerStatus: String(res.detail || "").slice(0, 200),
              });
              await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "done");
            } else {
              failed++;
              // Falha antes/no provider → retryable com a MESMA chave (attempt++).
              await finishOutboundEffect(supabase, eff.effectId, "failed_retryable", {
                errorCode: String(res.detail || "send_failed").slice(0, 120),
              });
              await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
            }
          }
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
      await finishRow(row.id, claimToken, {
        next_action_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
      });
      continue;
    }

    // Espera do PRÓXIMO estágio (delay_hours do banco ou STAGE_MAP).
    const nextCfg = await loadStageConfig(supabase, row.consultant_id, def.next);
    const nextAt = computeNextActionAt(def.next, now, nextCfg?.delay_hours ?? null);
    const attempts = (row.attempts_by_channel as Record<string, number>) ?? {};
    attempts[def.channel] = (attempts[def.channel] ?? 0) + 1;

    await finishRow(row.id, claimToken, {
      stage: def.next,
      last_action_at: now.toISOString(),
      next_action_at: nextAt?.toISOString() ?? null,
      attempts_by_channel: attempts,
      paused_until: null,
      ...(typeof detail.effect_id === "string" ? { last_effect_id: detail.effect_id } : {}),
    });

    if (def.next === "CLOSE_LOST") {
      await notifyPartnerOfLoss(supabase, row.customer_id, row.consultant_id);
    }

    dispatched++;
  }

  await finishAutomationRun(supabase, runId, failed > 0 ? "partial" : "completed", {
    processed: due.length, dispatched, deferred, skipped, sent, failed, resumed,
    audience_blocked: audienceBlocked,
  });

  return json({
    processed: due.length,
    dispatched,
    deferred,
    skipped,
    sent,
    failed,
    resumed,
    audience_blocked: audienceBlocked,
    cold_cap: coldCap,
    cold_today: coldTouchesToday,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}