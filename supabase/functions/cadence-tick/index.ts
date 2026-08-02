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
  stageGroup,
  type Stage,
} from "../_shared/cadence-engine.ts";
import { isBusinessHour } from "../_shared/business-window.ts";
import { resolveChannelForCustomerWithFailover, isUnavailable, ctx } from "../_shared/channel-sender.ts";
import { awaitOutboundSendQuota, registerSend } from "../_shared/anti-ban.ts";
import { safeFirstNameForAddress, scrubEmptyNameGreeting } from "../_shared/customer-display-name.ts";
import {
  playAudioFile, makeSMS,
  toVelipBRDest, toVelipSmsDest, isPermanentSmsFailure, isReprovedVelipCode, stripVelipNinthDigit, toCtid, velipConfigured,
} from "../_shared/voice-dialer/velip.ts";
import { debitSmsSent } from "../_shared/voice-sms-billing.ts";
import { resolveCallDialAudio } from "../_shared/voice-dialer/call-stitch.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { gateProactiveTouch } from "../_shared/retention-orchestrator.ts";
import { isPlausibleBrWhatsAppPhone, normalizePhone } from "../_shared/utils.ts";
import {
  cadenceEffectKey,
  finishAutomationRun,
  finishOutboundEffect,
  finishProactiveTouch,
  markEffectSending,
  OUTBOUND_EFFECT_MAX_RETRYABLE_ATTEMPTS,
  reserveOutboundEffect,
  reserveProactiveTouch,
  startAutomationRun,
} from "../_shared/journey-effects.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";
import {
  isAckOk,
  isPendingStale,
} from "../_shared/outbound-delivery-reconcile.ts";
import {
  normalizeWaPhoneDigits,
  resolveConsultantConnectedWaPhone,
} from "../_shared/consultant-wa-phone.ts";
import { resolveConsultantPresentationLabel, oAConsultor, resolveAssistantDisplayName, resolveConsultantRoleGender } from "../_shared/consultant-public-label.ts";
import {
  loadCadenceThemes,
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
import {
  isConsultantAutoAllowed,
  preloadConsultantAutomationPrefs,
  stageGroupToPack,
} from "../_shared/consultant-automation-prefs.ts";
import {
  clienteCadenceBlockReason,
  isClienteProibidoCadenciaABC,
} from "../_shared/cliente-cadence-guard.ts";
import { isCrmCadastroEmAnalise } from "../_shared/crm-vs-lead-analysis.ts";

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

const DEFAULT_CAP_B = 150;
const DEFAULT_CAP_C = 50;
const DEFAULT_CAP_GLOBAL_OUTREACH = 200;

interface OutreachCaps { capB: number; capC: number; capGlobal: number; }

/** Caps por grupo (A=∞, B=reengajamento cap fixo configurável, C=RECALL_*, Global=B+C anti-ban). */
async function loadOutreachCaps(supabase: any): Promise<OutreachCaps> {
  try {
    const { data } = await supabase
      .from("daily_reheat_settings")
      .select("cap_b, cap_c, cap_global_outreach, daily_whapi_cap")
      .limit(1)
      .maybeSingle();
    const capB = Math.floor(Number(data?.cap_b));
    const capC = Math.floor(Number(data?.cap_c));
    const capG = Math.floor(Number(data?.cap_global_outreach));
    return {
      capB: Number.isFinite(capB) && capB > 0 ? capB : DEFAULT_CAP_B,
      capC: Number.isFinite(capC) && capC > 0 ? capC : DEFAULT_CAP_C,
      capGlobal: Number.isFinite(capG) && capG > 0 ? capG : DEFAULT_CAP_GLOBAL_OUTREACH,
    };
  } catch { /* fallback */ }
  return { capB: DEFAULT_CAP_B, capC: DEFAULT_CAP_C, capGlobal: DEFAULT_CAP_GLOBAL_OUTREACH };
}

const B_STAGES = [
  "COLD_1","COLD_2","COLD_3","COLD_4",
  "CALL_1","CALL_2","CALL_3",
  "SMS_1","SMS_2","SMS_TEMA_2","SMS_TEMA_7",
];
const C_STAGES = [
  "RECALL_60D","RECALL_60D_SMS","RECALL_60D_CALL",
  "RECALL_90D","RECALL_90D_SMS","RECALL_90D_CALL",
  "RECALL_5M","RECALL_5M_SMS","RECALL_5M_CALL",
  "RECALL_8M","RECALL_8M_SMS","RECALL_8M_CALL",
  "RECALL_12M","RECALL_12M_SMS","RECALL_12M_CALL",
  "RECALL_YEARLY","RECALL_YEARLY_SMS","RECALL_YEARLY_CALL",
];

/** Pessoas distintas tocadas hoje (BRT) por grupo B e C. Grupo A não é contado. */
async function countOutreachTouchesToday(
  supabase: any,
): Promise<{ b: number; c: number; ok: boolean }> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const day = fmt.format(new Date());
  const startIso = new Date(`${day}T00:00:00-03:00`).toISOString();
  // Limite alto explícito: o default do PostgREST (1000) truncaria a contagem
  // em dias cheios e o cap anti-ban passaria a contar menos do que foi enviado.
  const { data, error } = await supabase
    .from("cadence_action_log")
    .select("customer_id, stage")
    .eq("status", "sent")
    .gte("created_at", startIso)
    .in("stage", [...B_STAGES, ...C_STAGES])
    .limit(20000);
  if (error) {
    // Fail-closed: sem contagem confiável NÃO liberamos outreach (risco de ban).
    console.warn("[cadence-tick] count_outreach_failed (fail-closed):", error.message);
    return { b: 0, c: 0, ok: false };
  }
  const b = new Set<string>();
  const c = new Set<string>();
  for (const r of (data || []) as { customer_id: string; stage: string }[]) {
    if (stageGroup(r.stage) === "C") c.add(r.customer_id);
    else b.add(r.customer_id);
  }
  return { b: b.size, c: c.size, ok: true };
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

  // Política global: Multicanal oficial — textos/janelas/delays vêm SEMPRE da
  // config global (consultant_id IS NULL).
  // EXCEÇÃO de identidade: o áudio da ligação não pode ser o do super admin
  // ("Eu sou a Sofia, assistente virtual do Rafael") tocando para o lead de
  // outro consultor. Se o consultor tem clip de identidade próprio
  // (consultant-identity-bootstrap), ele sobrescreve só o áudio.
  const globalCfg = await pick(null);
  if (!globalCfg || !consultantId) return globalCfg;

  const ownCfg = await pick(consultantId);
  if (ownCfg?.voice_audio_clip_id) {
    return {
      ...globalCfg,
      voice_audio_clip_id: ownCfg.voice_audio_clip_id,
      velip_audio_id: ownCfg.velip_audio_id ?? null,
    };
  }
  return globalCfg;
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
  // Legado sem cargo gestor: "…,  da iGreen" → "… da iGreen"
  out = out.replace(/,\s+da iGreen/gi, " da iGreen");
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Identidade (PLANO §10 + parity reheat):
 * - {{consultor}} sempre tem label seguro via resolvePublicConsultantLabel
 *   (slug → "seu consultor"; nunca vazamos login).
 * - {{consultor_phone}} / {{link_wa}}: fail-closed se não há chip/phone real
 *   (nunca inventar wa.me nem usar notification_phone).
 */
function missingIdentityVar(tpl: string, consultantName: string, consultantPhone: string): string | null {
  if (/\{\{\s*consultor\s*\}\}/i.test(tpl) && !consultantName.trim()) return "consultor";
  if (/\{\{\s*(consultor_phone|link_wa)\s*\}\}/i.test(tpl) && !consultantPhone.trim()) return "consultor_phone";
  return null;
}

/** Remove placeholders de telefone do template WA quando não há chip — envia o corpo. */
function scrubMissingConsultantPhone(tpl: string): string {
  return String(tpl || "")
    .replace(/https?:\/\/wa\.me\/\{\{\s*consultor_phone\s*\}\}/gi, "")
    .replace(/\{\{\s*consultor_phone\s*\}\}/gi, "")
    .replace(/\{\{\s*link_wa\s*\}\}/gi, "")
    .replace(/(?:https?:\/\/)?wa\.me\/(?![\d+])/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
  /** true = não re-tentar (ex.: número inválido p/ SMS); avança estágio. */
  permanent?: boolean;
  /**
   * Intervalo anti-ban: reagendar em segundos (não `failed` + 30 min).
   * Conta como adiado por slot, não como pessoa falha.
   */
  softDefer?: boolean;
  retryInMs?: number;
  theme_id?: string;
  /** Texto exatamente enviado (já com {{nome}} resolvido ou vazio). */
  message_body?: string;
  /** true = usou prenome confiável; false = só o corpo. */
  with_name?: boolean;
  media_url?: string;
  media_type?: string;
  messageId?: string | null;
  /** WA: aceite HTTP — espera ACK (webhook/reconciler) antes de avançar escada. */
  awaiting_ack?: boolean;
};

/** Último outbound de cadência deste stage — para hold/ACK. */
async function loadCadenceWaAck(
  supabase: any,
  customerId: string,
  stage: string,
): Promise<{ delivery_status: string | null; created_at: string | null; external_message_id: string | null }> {
  const { data } = await supabase
    .from("conversations")
    .select("delivery_status, created_at, external_message_id")
    .eq("customer_id", customerId)
    .eq("message_direction", "outbound")
    .eq("origin", "cadence")
    .eq("conversation_step", `cadence:${stage}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    delivery_status: (data as any)?.delivery_status ?? null,
    created_at: (data as any)?.created_at ?? null,
    external_message_id: (data as any)?.external_message_id ?? null,
  };
}

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
    .select("id, name, name_source, phone_whatsapp, whatsapp_chat_id, consultant_id")
    .eq("id", row.customer_id)
    .maybeSingle();

  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };

  const gate = await assertBotOutboundAllowed(supabase, {
    customerId: row.customer_id,
    phone: cust.phone_whatsapp,
    consultantId: row.consultant_id,
  });
  if (!gate.allowed) return { ok: false, detail: `suppressed:${gate.reason}` };

  // Número lixo / país errado (ex.: +91 com 55 na frente) — não martela Whapi 40×.
  const waDigits = normalizePhone(
    String((cust as { whatsapp_chat_id?: string | null }).whatsapp_chat_id || cust.phone_whatsapp),
  );
  if (!isPlausibleBrWhatsAppPhone(waDigits)) {
    return { ok: false, detail: "invalid_phone", permanent: true };
  }

  const ch = await resolveChannelForCustomerWithFailover(supabase, row.customer_id, {
    evolutionUrl: env.evolutionUrl,
    evolutionKey: env.evolutionKey,
    whapiToken: env.whapiToken,
  });
  if (isUnavailable(ch)) return { ok: false, detail: `channel_${ch.reason}` };

  // Intervalo mínimo: ESPERA o slot (Whapi usa fila própria). Nunca
  // `failed`+30min — isso gerava dezenas de logs na mesma pessoa.
  const quota = await awaitOutboundSendQuota(supabase, ch.instanceName, {
    channelKind: ch.kind,
  });
  if (!quota.allowed) {
    return {
      ok: false,
      detail: `quota_${quota.reason || "blocked"}`,
      softDefer: !!quota.softDefer,
      retryInMs: quota.retryInMs,
    };
  }

  // Carrega consultor p/ substituir {{consultor}} e {{consultor_phone}} — sem
  // isso, o link `wa.me/{{consultor_phone}}` saía literal ou como `wa.me/`.
  // channelKind=ch.kind: wa.me deve ser o chip do canal que realmente envia.
  const { consultantName, consultantPhone, assistantName, consultantGender } = await loadLeadContext(
    supabase, row.customer_id, row.consultant_id, { channelKind: ch.kind },
  );
  const firstName = safeFirstNameForAddress(cust.name, (cust as any).name_source);
  let rawTpl = cfg.message_text || "";
  let themeId: string | undefined;
  if (needsWhatsAppTheme(rawTpl, stage)) {
    const last = await loadLastThemeId(supabase, row.customer_id);
    const themes = await loadCadenceThemes(supabase, row.consultant_id);
    const theme = pickCadenceTheme({
      customerId: row.customer_id,
      stage,
      lastThemeId: last,
      themes,
    });
    themeId = theme.id;
    rawTpl = rawTpl.includes("{{tema_whatsapp}}")
      ? rawTpl.replaceAll("{{tema_whatsapp}}", theme.wa)
      : theme.wa;
  }
  const availOverrides = await loadAvail(row.consultant_id);
  const { phrase: fraseDisponibilidade } = buildAvailabilityPhrase(new Date(), availOverrides);
  let tplForSend = rawTpl;
  const missingVar = missingIdentityVar(tplForSend, consultantName, consultantPhone);
  if (missingVar === "consultor_phone") {
    // Sem chip: manda o corpo sem wa.me (não adianta failed×30min).
    tplForSend = scrubMissingConsultantPhone(tplForSend);
  } else if (missingVar) {
    // Sem nome do consultor: não martelar failed_retryable (custo/quota).
    return { ok: false, detail: `identity_missing:${missingVar}`, permanent: true };
  }
  const text = renderTemplate(tplForSend, {
    nome: firstName,
    consultor: consultantName,
    assistente: assistantName,
    consultor_phone: consultantPhone,
    frase_disponibilidade: fraseDisponibilidade,
    do_da_consultor: consultantGender === "consultora" ? "da" : "do",
    o_a_consultor: oAConsultor(consultantGender),
    // Legado: nunca rotular consultor como gestor
    gestor_a: "",
  });
  const jidDigits = String(
    (cust as { whatsapp_chat_id?: string | null }).whatsapp_chat_id || cust.phone_whatsapp,
  ).replace(/\D/g, "");
  const jid = `${jidDigits}@s.whatsapp.net`;
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
    // Whapi/Evolution: PENDING no body do send = aceite normal (não é ACK final).
    // delivery_status fica queued; reconciler/webhook promovem sent/delivered/failed.
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
      delivery_status: "queued",
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
      messageId: externalId,
      awaiting_ack: true,
    };
  } catch (e) {
    return { ok: false, detail: `exception:${(e as Error).message}` };
  }
}

/** Busca telefone + nome + IA + gênero do consultor do lead (nunca inventar gestor/Rafael). */
async function loadLeadContext(
  supabase: any,
  customerId: string,
  consultantId: string | null,
  opts?: { channelKind?: string | null },
) {
  const { data: cust } = await supabase
    .from("customers")
    .select("id, name, name_source, phone_whatsapp, origin_channel")
    .eq("id", customerId).maybeSingle();
  let consultantName = "";
  let consultantPhone = "";
  let assistantName = "";
  let consultantGender: "consultor" | "consultora" = "consultor";
  if (consultantId) {
    const { data: c } = await supabase
      .from("consultants")
      .select("name, display_name, assistant_name, gender")
      .eq("id", consultantId).maybeSingle();
    assistantName = resolveAssistantDisplayName(
      (c as { assistant_name?: string | null })?.assistant_name,
    );
    consultantGender = resolveConsultantRoleGender(
      (c as { gender?: string | null })?.gender,
      (c as { name?: string | null })?.name || (c as { display_name?: string | null })?.display_name,
    );
    // Label de apresentação (nome ou "consultor"/"consultora") + {{o_a_consultor}} no template.
    // Slug sem display → substantivo — "é o consultor" / "é a consultora".
    consultantName = resolveConsultantPresentationLabel(
      (c as { name?: string | null })?.name,
      (c as { display_name?: string | null })?.display_name,
      consultantGender,
    );
    // Link wa.me = chip do canal real (Whapi vs Evolution saudável).
    const channelKind = opts?.channelKind ||
      (cust as { origin_channel?: string | null } | null)?.origin_channel ||
      null;
    consultantPhone = await resolveConsultantConnectedWaPhone(supabase, consultantId, {
      channelKind,
    });
  }
  return { cust, consultantName, consultantPhone, assistantName, consultantGender };
}

/**
 * Cross-channel suppression: se o telefone já foi reprovado pela operadora
 * (IK/EK/CK/BK) em voz ou entregou UNDELIV ≥2x em SMS nas últimas 72h,
 * considera "canal morto" e sugere pular. Retorna { block, reason, dnc_reason }.
 *
 * Isso complementa o guard de voz existente para também proteger o SMS
 * (e vice-versa: SMS morto também bloqueia voz). O objetivo é não queimar
 * saldo em números WhatsApp-only.
 */
async function checkPhoneDeadForChannel(
  supabase: any,
  opts: { consultantId: string; phoneCandidates: string[]; channel: "voice" | "sms" },
): Promise<{ block: boolean; reason?: string; dnc_reason?: string }> {
  const { consultantId, phoneCandidates, channel } = opts;
  if (!consultantId || phoneCandidates.length === 0) return { block: false };

  // 1) Lista Não Perturbe (fonte auto do webhook Velip / guard prévio / SMS UNDELIV
  //    + cadastro MANUAL na aba Voz → "Não Perturbe").
  //    IMPORTANTE: o cadastro manual grava só os dígitos do que o consultor digitou
  //    ("34997081920", sem o 55), enquanto aqui os candidatos vêm em formato Velip
  //    ("5534997081920"). Match exato (.in) deixava passar todo DNC digitado sem DDI.
  //    Por isso comparamos também pelo sufixo de 10 dígitos (DDD + número), igual ao
  //    helper canônico `assertCanContact`.
  const dncTails = [...new Set(
    phoneCandidates
      .map((p) => String(p || "").replace(/\D/g, ""))
      .filter((p) => p.length >= 10)
      .map((p) => p.slice(-10)),
  )];
  let dncQuery = supabase
    .from("voice_dnc_list")
    .select("phone, reason, source")
    .eq("consultant_id", consultantId);
  dncQuery = dncTails.length
    ? dncQuery.or(
      [
        `phone.in.(${phoneCandidates.join(",")})`,
        ...dncTails.map((t) => `phone.ilike.%${t}`),
      ].join(","),
    )
    : dncQuery.in("phone", phoneCandidates);
  const { data: dnc } = await dncQuery.limit(5);
  const candidateDigits = phoneCandidates.map((p) => String(p || "").replace(/\D/g, ""));
  const dncRow = ((dnc as { phone: string; reason: string | null; source: string | null }[] | null) ?? [])
    .find((r) => {
      const d = String(r.phone || "").replace(/\D/g, "");
      if (!d) return false;
      // Só aceita sufixo quando os dois lados têm ao menos 10 dígitos (DDD + número),
      // para não bloquear número errado por coincidência de final curto.
      return candidateDigits.some((c) =>
        c === d || (c.length >= 10 && d.length >= 10 && (c.endsWith(d) || d.endsWith(c)))
      );

    }) ?? null;
  if (dncRow) {
    return { block: true, reason: `dnc:${dncRow.source || "unknown"}`, dnc_reason: dncRow.reason || undefined };
  }


  // 2) Voz reprovada — bloqueia próximas ligações E SMS.
  const { data: calls } = await supabase
    .from("voice_call_logs")
    .select("velip_status")
    .eq("consultant_id", consultantId)
    .in("to_phone", phoneCandidates)
    .in("velip_status", ["IK", "EK", "CK", "BK", "ik", "ek", "ck", "bk"])
    .limit(1);
  if ((calls as unknown[] | null)?.length) {
    return { block: true, reason: "voice_reproved", dnc_reason: "auto_voice_reproved" };
  }

  // 3) SMS: ≥2 UNDELIV nas últimas 72h — número morto para SMS e provavelmente para voz.
  const cutoff = new Date(Date.now() - 72 * 3600_000).toISOString();
  const { data: sms } = await supabase
    .from("voice_sms_log")
    .select("id, delivery_status, status, error, created_at")
    .eq("consultant_id", consultantId)
    .in("phone", phoneCandidates)
    .gte("created_at", cutoff)
    .limit(10);
  const undelivCount = ((sms as { delivery_status: string | null; status: string | null; error: string | null }[] | null) || [])
    .filter((r) => {
      const s = String(r.delivery_status || "").toUpperCase();
      return /^(UNDELIV|REJECTD|EXPIRED|DELETED|UNKNOWN)$/.test(s) || String(r.error || "").toUpperCase() === "UNDELIV";
    }).length;
  if (undelivCount >= 2) {
    return { block: true, reason: `sms_undeliv:${undelivCount}`, dnc_reason: "auto_sms_undeliv" };
  }

  return { block: false };
}

/** Falha WA que não adianta re-tentar (origem/instância errada ou número inválido). */
function isPermanentWaFailure(detail: string | null | undefined): boolean {
  const s = String(detail || "").toLowerCase();
  if (!s) return false;
  return (
    s.includes("invalid_phone") ||
    s.includes("instance does not exist") ||
    s.includes("channel_instance_not_found") ||
    s.includes("channel_instance_offline") ||
    s.includes("channel_instance_locked") ||
    s.includes("channel_manual_review") ||
    s.includes("channel_no_origin")
  );
}


async function dispatchVoiceCall(
  supabase: any, row: any, stage: Stage, cfg: StageConfig,
): Promise<DispatchResult> {
  if (!velipConfigured()) return { ok: false, detail: "velip_not_configured" };
  const { cust } = await loadLeadContext(supabase, row.customer_id, row.consultant_id);
  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };

  const gate = await assertBotOutboundAllowed(supabase, {
    customerId: row.customer_id,
    phone: cust.phone_whatsapp,
    consultantId: row.consultant_id,
  });
  if (!gate.allowed) return { ok: false, detail: `suppressed:${gate.reason}` };

  // toVelipBRDest já completa o 9º dígito em celular antigo (sem mexer no phone_whatsapp).
  const dest = toVelipBRDest(cust.phone_whatsapp);
  if (!dest) return { ok: false, detail: "invalid_phone", permanent: true };

  // Se a operadora já reprovou este destino (IK/EK/CK/BK), não disca de novo
  // (ex.: A_CALL → IK e A_CALL_RETRY tentaria o mesmo número morto).
  // Match 13 e 12 dígitos (logs antigos sem o 9). Além disso, SMS UNDELIV
  // repetido também caracteriza número morto — bloqueia voz por reciprocidade.
  const destAlt = stripVelipNinthDigit(dest);
  const phoneCandidates = [...new Set([dest, destAlt].filter(Boolean))] as string[];
  const cross = await checkPhoneDeadForChannel(supabase, {
    consultantId: row.consultant_id,
    phoneCandidates,
    channel: "voice",
  });
  if (cross.block) {
    // Belt-and-suspenders: garante o número em voice_dnc_list.
    try {
      await supabase.from("voice_dnc_list").upsert({
        consultant_id: row.consultant_id,
        phone: dest,
        reason: cross.dnc_reason || "auto_cross_channel",
        source: "cadence_guard",
      }, { onConflict: "consultant_id,phone" });
    } catch (_e) { /* ignore */ }
    return {
      ok: false,
      detail: `phone_dead:${cross.reason}`,
      permanent: true,
    };
  }


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
    if (!r.ok) {
      const detail = `velip:${r.error || "call_failed"}`;
      return { ok: false, detail, permanent: isPermanentSmsFailure(detail) };
    }
    // Grava log na hora do disparo — o webhook/cron atualiza velip_status (OK/NA/IK…).
    // Sem isso a pizza fica em "aguardando operadora" sem nunca casar o retorno.
    if (r.cd_id) {
      const { error: callLogErr } = await supabase.from("voice_call_logs").insert({
        consultant_id: row.consultant_id,
        to_phone: dest,
        status: "dialing",
        velip_call_id: r.cd_id,
        raw: {
          source: "cadence",
          stage,
          customer_id: row.customer_id,
          ctid,
        },
      });
      if (callLogErr) {
        console.warn("[cadence-tick] voice_call_logs insert failed", callLogErr.message);
      }
    }
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
  const { cust, consultantName, consultantPhone, assistantName, consultantGender } = await loadLeadContext(supabase, row.customer_id, row.consultant_id);
  if (!cust?.phone_whatsapp) return { ok: false, detail: "no_phone" };

  const gate = await assertBotOutboundAllowed(supabase, {
    customerId: row.customer_id,
    phone: cust.phone_whatsapp,
    consultantId: row.consultant_id,
  });
  if (!gate.allowed) return { ok: false, detail: `suppressed:${gate.reason}` };

  const dest = toVelipSmsDest(cust.phone_whatsapp);
  if (!dest) return { ok: false, detail: "invalid_phone", permanent: true };
  // Fixo (12 dígitos, local 2–5): SMS Velip rejeita — não tentar / não loop.
  if (dest.length === 12) {
    return { ok: false, detail: "sms_skip_landline", permanent: true };
  }

  // Cross-channel: se voz reprovou (IK/EK/CK/BK) ou este SMS já falhou 2×+
  // com UNDELIV/REJECTD, é número morto → não gasta saldo.
  const destAlt = stripVelipNinthDigit(dest);
  const smsPhoneCandidates = [...new Set([dest, destAlt, cust.phone_whatsapp].filter(Boolean))] as string[];
  const crossSms = await checkPhoneDeadForChannel(supabase, {
    consultantId: row.consultant_id,
    phoneCandidates: smsPhoneCandidates,
    channel: "sms",
  });
  if (crossSms.block) {
    try {
      await supabase.from("voice_dnc_list").upsert({
        consultant_id: row.consultant_id,
        phone: dest,
        reason: crossSms.dnc_reason || "auto_cross_channel",
        source: "cadence_guard",
      }, { onConflict: "consultant_id,phone" });
    } catch (_e) { /* ignore */ }
    return { ok: false, detail: `phone_dead:${crossSms.reason}`, permanent: true };
  }


  const firstName = safeFirstNameForAddress(cust.name, (cust as any).name_source);
  let rawTpl = cfg.message_text || "";
  let themeId: string | undefined;
  if (needsSmsTheme(rawTpl, stage)) {
    const last = await loadLastThemeId(supabase, row.customer_id);
    const themes = await loadCadenceThemes(supabase, row.consultant_id);
    const theme = pickCadenceTheme({
      customerId: row.customer_id,
      stage,
      lastThemeId: last,
      themes,
    });
    themeId = theme.id;
    rawTpl = rawTpl.includes("{{tema_sms}}")
      ? rawTpl.replaceAll("{{tema_sms}}", theme.sms)
      : theme.sms;
  }
  const availOverrides = await loadAvail(row.consultant_id);
  const { phrase: fraseDisponibilidade } = buildAvailabilityPhrase(new Date(), availOverrides);
  const missingSmsVar = missingIdentityVar(rawTpl, consultantName, consultantPhone);
  if (missingSmsVar) {
    return { ok: false, detail: `identity_missing:${missingSmsVar}`, permanent: true };
  }
  let text = renderTemplate(rawTpl, {
    nome: firstName,
    consultor: consultantName,
    assistente: assistantName,
    consultor_phone: consultantPhone,
    link_wa: consultantPhone ? `https://wa.me/${consultantPhone}` : "",
    frase_disponibilidade: fraseDisponibilidade,
    do_da_consultor: consultantGender === "consultora" ? "da" : "do",
    o_a_consultor: oAConsultor(consultantGender),
    gestor_a: "",
  });
  text = ensureSmsWaLink(text, consultantPhone);
  if (!text.trim()) return { ok: false, detail: "empty_message" };
  if (!consultantPhone) return { ok: false, detail: "consultant_phone_missing" };

  try {
    // MakeSMSOpts espera `message` — com `text` o SMS sairia "undefined".
    const r = await makeSMS({ to: dest, message: text });
    // Schema real: sem colunas `raw` / `sent_at` — insert antigo falhava em silêncio.
    const { data: smsLogRow, error: smsLogErr } = await supabase.from("voice_sms_log").insert({
      consultant_id: row.consultant_id,
      phone: dest,
      message: text,
      velip_sms_id: r.cdls_id != null ? String(r.cdls_id) : null,
      velip_ctid: (r.raw as { ctid?: string } | undefined)?.ctid ?? null,
      status: r.ok ? "sent" : "failed",
      error: r.ok ? null : (r.error ?? "velip_error"),
    }).select("id").maybeSingle();
    if (smsLogErr) {
      console.warn("[cadence-tick] voice_sms_log insert failed", smsLogErr.message);
    }
    if (!r.ok) {
      const detail = `velip:${r.error || "sms_failed"}`;
      return {
        ok: false,
        detail,
        permanent: isPermanentSmsFailure(detail),
        message_body: text,
        with_name: !!firstName,
      };
    }
    const smsRef = r.cdls_id != null
      ? String(r.cdls_id)
      : (smsLogRow as { id?: string } | null)?.id ?? `cadence_sms_${row.customer_id}_${Date.now()}`;
    void debitSmsSent(supabase, {
      consultantId: row.consultant_id,
      providerRef: smsRef,
      metadata: { source: "cadence_tick", stage: row.stage },
    });
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

  const bootTs = Date.now();
  console.info("[cadence-tick] boot", { method: req.method, url: req.url });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  // deno-lint-ignore no-explicit-any
  const cronAuth = await assertCronAuth(req, supabase as any);
  if (!cronAuth.ok) {
    console.warn("[cadence-tick] cron_auth_failed", { reason: cronAuth.reason });
    return cronAuthUnauthorized(cronAuth.reason, corsHeaders);
  }

    if (!(await isAutomationEnabled(supabase, "cadence_engine"))) {
      console.warn("[cadence-tick] skipped_automation_disabled", { key: "cadence_engine" });
      await logSkipped(supabase, "cadence_engine");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "cadence_engine" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }


  const { data: whapiOwnerRow } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "superadmin_consultant_id")
    .maybeSingle();

  const env = {
    evolutionUrl: Deno.env.get("EVOLUTION_API_URL") ?? undefined,
    evolutionKey: Deno.env.get("EVOLUTION_API_KEY") ?? undefined,
    whapiToken: Deno.env.get("WHAPI_TOKEN") ?? "",
    // Whapi é do superadmin; consultores só saem por Evolution.
    superadminConsultantId: String((whapiOwnerRow as any)?.value ?? "").replace(/^"|"$/g, "") || null,
  };

  // Kill-switch global
  const { data: settings } = await supabase
    .from("app_settings")
    .select("cadence_engine_enabled")
    .eq("id", "global")
    .maybeSingle();

  if (!settings?.cadence_engine_enabled) {
    console.warn("[cadence-tick] skipped_cadence_disabled");
    return json({ skipped: "cadence_disabled" });
  }
  console.info("[cadence-tick] guards_ok", { ms: Date.now() - bootTs });
  try {

  const now = new Date();
  const loadAvail = createAvailabilityLoader(supabase);
  const caps = await loadOutreachCaps(supabase);
  const touchedToday = await countOutreachTouchesToday(supabase);
  const capCountReliable = touchedToday.ok;
  let touchedB = touchedToday.b;
  let touchedC = touchedToday.c;
  const alertedThresholds = new Set<string>(); // ex: "B:60", "C:100", "G:85"
  async function maybeAlertCap(kind: "B" | "C" | "G", used: number, limit: number) {
    if (limit <= 0) return;
    const pct = Math.floor((used / limit) * 100);
    for (const t of [60, 85, 100]) {
      if (pct >= t && !alertedThresholds.has(`${kind}:${t}`)) {
        alertedThresholds.add(`${kind}:${t}`);
        try {
          await logSkipped(supabase, `outreach_cap_${kind.toLowerCase()}_${t}pct`, {
            group: kind,
            used,
            limit,
            pct,
            source: "cadence-tick",
          });
        } catch { /* best-effort */ }
      }
    }
  }
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
  const legacyLeaseById = new Map<string, string>();
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
        legacyLeaseById.set(String(row.id), leaseUntil);
        due.push({ ...row, next_action_at: leaseUntil, claim_token: cas.data.claim_token ?? row.claim_token });
      }
    }
  }

  if (!due || due.length === 0) {
    await finishAutomationRun(supabase, runId, "completed", { processed: 0 });
    return json({ processed: 0, caps, touched_today: { b: touchedB, c: touchedC } });
  }

  const customerIds = due.map((r) => r.customer_id).filter(Boolean);
  const { data: custRows } = await supabase
    .from("customers")
    .select(
      "id, phone_whatsapp, bot_paused, bot_paused_until, assigned_human_id, do_not_contact, customer_origin, status, is_converted, pos_venda_stage, pos_venda_recadastro_at, andamento_igreen, conversation_step, portal_submitted_at",
    )
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

  const prefsByConsultant = await preloadConsultantAutomationPrefs(
    supabase,
    due.map((r) => String(r.consultant_id || "")).filter(Boolean),
  );

  let dispatched = 0, deferred = 0, skipped = 0, sent = 0, failed = 0, resumed = 0, audienceBlocked = 0;
  let consultantPrefOff = 0, clienteBlocked = 0;

  /** Update que só aplica se ainda formos donos do claim. */
  async function finishRow(
    id: string,
    claimToken: string | null | undefined,
    patch: Record<string, unknown>,
  ): Promise<boolean> {
    if (!claimToken) {
      // Compatibilidade conservadora para o fallback legado: exige tanto
      // claim_token nulo quanto o lease exato reservado no CAS inicial.
      const legacyLeaseAt = legacyLeaseById.get(id);
      if (!legacyLeaseAt) {
        console.warn("[cadence-tick] legacy_finish_missing_lease", {
          cadence_state_id: id,
        });
        return false;
      }
      const { data, error } = await supabase
        .from("lead_cadence_state")
        .update(patch)
        .eq("id", id)
        .is("claim_token", null)
        .eq("next_action_at", legacyLeaseAt)
        .select("id")
        .maybeSingle();
      if (error) {
        console.warn("[cadence-tick] legacy_finish_failed", {
          cadence_state_id: id,
          error: error.message,
        });
        return false;
      }
      if (!data?.id) {
        console.warn("[cadence-tick] legacy_finish_skipped_stale", {
          cadence_state_id: id,
        });
        return false;
      }
      legacyLeaseById.delete(id);
      return true;
    }

    const body = {
      ...patch,
      claim_token: null,
      claimed_at: null,
      lease_expires_at: null,
    };
    const { data, error } = await supabase
      .from("lead_cadence_state")
      .update(body)
      .eq("id", id)
      .eq("claim_token", claimToken)
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn("[cadence-tick] claim_finish_failed", {
        cadence_state_id: id,
        error: error.message,
      });
      return false;
    }
    if (!data?.id) {
      // Inbound/worker mais novo invalidou o token: estado atual sempre vence.
      console.warn("[cadence-tick] claim_loststale_worker", {
        cadence_state_id: id,
      });
      return false;
    }
    return true;
  }

  for (const row of due) {
    let stage = row.stage as Stage;
    const claimToken = row.claim_token as string | null | undefined;

    const cust = custById.get(row.customer_id);

    // Trava: CLIENTE (carteira / aprovado / pós-venda) NUNCA recebe A/B/C como lead.
    // Só pós-venda + agendamento humano. Encerra jornada em WON.
    if (cust && isClienteProibidoCadenciaABC(cust)) {
      const reason = clienteCadenceBlockReason(cust);
      try {
        // mark_journey_won já zera claim/next_action_at e suprime efeitos reserved.
        await supabase.rpc("mark_journey_won", {
          p_customer_id: row.customer_id,
          p_source: reason,
        });
      } catch (e) {
        console.warn("[cadence-tick] mark_journey_won cliente falhou", {
          customer_id: row.customer_id,
          error: (e as Error)?.message,
        });
        // Fallback sem RPC: encerra claim localmente.
        await finishRow(row.id, claimToken, {
          stage: "WON",
          next_action_at: null,
          paused_until: null,
          paused_reason: `won:${reason}`,
        });
      }
      await logSkipped(supabase, "cadence_engine", {
        reason: "cliente_proibido_abc",
        block_reason: reason,
        customer_id: row.customer_id,
        consultant_id: row.consultant_id,
        stage,
      });
      clienteBlocked++;
      skipped++;
      continue;
    }

    // Já cadastrou / CRM em análise (OTP, facial, assinatura): sem A/B/C.
    // Pós-venda e watchdogs de portal seguem em caminhos separados.
    if (cust && isCrmCadastroEmAnalise(cust)) {
      await finishRow(row.id, claimToken, {
        next_action_at: null,
        paused_until: null,
        paused_reason: "crm_cadastro_em_analise",
      });
      await logSkipped(supabase, "cadence_engine", {
        reason: "crm_cadastro_em_analise",
        customer_id: row.customer_id,
        consultant_id: row.consultant_id,
        stage,
        conversation_step: cust.conversation_step ?? null,
        portal_submitted_at: cust.portal_submitted_at ?? null,
      });
      clienteBlocked++;
      skipped++;
      continue;
    }

    // Público piloto (DDD): fora do DDD não envia; adia sem apagar.
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
      const resumePack = stageGroupToPack(stageGroup(resumeStage));
      const resumePrefs = prefsByConsultant.get(String(row.consultant_id || ""));
      if (!isConsultantAutoAllowed(resumePrefs, resumePack)) {
        await logSkipped(supabase, "cadence_engine", {
          reason: "consultant_pref_off",
          pack: resumePack,
          consultant_id: row.consultant_id,
          customer_id: row.customer_id,
          stage: resumeStage,
        });
        await finishRow(row.id, claimToken, { next_action_at: tomorrowMorningBRT() });
        consultantPrefOff++;
        deferred++;
        continue;
      }
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

    // Cadeado 2: opt-in do consultor (A/B/C). Sem row = OFF.
    {
      const grp = stageGroup(stage);
      const pack = stageGroupToPack(grp);
      const prefs = prefsByConsultant.get(String(row.consultant_id || ""));
      if (!isConsultantAutoAllowed(prefs, pack)) {
        await logSkipped(supabase, "cadence_engine", {
          reason: "consultant_pref_off",
          pack,
          consultant_id: row.consultant_id,
          customer_id: row.customer_id,
          stage,
        });
        await finishRow(row.id, claimToken, { next_action_at: tomorrowMorningBRT() });
        consultantPrefOff++;
        deferred++;
        continue;
      }
    }

    // Cap 60 pessoas/dia — adia, nunca descarta.
    // Cap por grupo (A=∞, B=capB, C=capC, Global outreach=B+C ≤ capGlobal). Adia, nunca descarta.
    {
      const grp = stageGroup(stage);
      if (grp !== "A") {
        if (!capCountReliable) {
          // Contagem do dia falhou: adiar 30min (não jogar para amanhã por erro transitório).
          await finishRow(row.id, claimToken, {
            next_action_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
          });
          deferred++; continue;
        }
        const usedGlobal = touchedB + touchedC;
        const overGlobal = usedGlobal >= caps.capGlobal;
        const overGroup = grp === "B" ? touchedB >= caps.capB : touchedC >= caps.capC;
        if (overGroup || overGlobal) {
          await maybeAlertCap(grp, grp === "B" ? touchedB : touchedC, grp === "B" ? caps.capB : caps.capC);
          await maybeAlertCap("G", usedGlobal, caps.capGlobal);
          await finishRow(row.id, claimToken, { next_action_at: tomorrowMorningBRT() });
          deferred++; continue;
        }
      }
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
          const finished = await finishRow(row.id, claimToken, {
            stage: "CLOSE_LOST",
            next_action_at: computeNextActionAt("CLOSE_LOST", now)?.toISOString() ?? null,
            paused_reason: "channel_limit_reached",
          });
          if (finished) {
            await notifyPartnerOfLoss(supabase, row.customer_id, row.consultant_id);
          }
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
              // Envio já ocorreu. WhatsApp: só avança se ACK ok; senão espera ou reabre retry (com teto).
              if (def.channel === "whatsapp") {
                const ack = await loadCadenceWaAck(supabase, row.customer_id, stage);
                if (isAckOk(ack.delivery_status) || eff.status === "delivered") {
                  detail = { ...detail, dispatch: "effect_already_sent_acked", effect_id: eff.effectId };
                  status = "sent";
                } else if (
                  ack.delivery_status === "failed" ||
                  (ack.created_at && isPendingStale(ack.created_at))
                ) {
                  // Fail-closed: se não ler attempt_count, assume teto (não reabre).
                  let attempts = OUTBOUND_EFFECT_MAX_RETRYABLE_ATTEMPTS;
                  try {
                    const { data: effRow } = await supabase
                      .from("outbound_effects")
                      .select("attempt_count")
                      .eq("id", eff.effectId)
                      .maybeSingle();
                    attempts = Number((effRow as { attempt_count?: number } | null)?.attempt_count || 0);
                  } catch {
                    /* mantém teto → ack_max_attempts_advance */
                  }

                  if (attempts >= OUTBOUND_EFFECT_MAX_RETRYABLE_ATTEMPTS) {
                    // Teto: não reabre. Fecha efeito e avança escada (WA → SMS/voz).
                    try {
                      await supabase
                        .from("outbound_effects")
                        .update({
                          status: "failed_final",
                          error_code: "max_attempts_ack",
                        })
                        .eq("id", eff.effectId)
                        .eq("status", "sent");
                    } catch { /* best-effort */ }
                    detail = {
                      ...detail,
                      dispatch: "ack_max_attempts_advance",
                      effect_id: eff.effectId,
                      delivery_status: ack.delivery_status,
                      attempt_count: attempts,
                      advance_skip: true,
                    };
                    status = "failed";
                  } else {
                    // Reabre efeito para reenvio (JID pode ter sido corrigido).
                    try {
                      await supabase
                        .from("outbound_effects")
                        .update({
                          status: "failed_retryable",
                          error_code: ack.delivery_status === "failed" ? "ack_failed" : "ack_pending_stale",
                        })
                        .eq("id", eff.effectId)
                        .eq("status", "sent");
                    } catch { /* best-effort */ }
                    await finishRow(row.id, claimToken, {
                      next_action_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
                    });
                    detail = {
                      ...detail,
                      dispatch: "ack_failed_reopen",
                      effect_id: eff.effectId,
                      delivery_status: ack.delivery_status,
                      attempt_count: attempts,
                    };
                    deferred++;
                    continue;
                  }
                } else {
                  // Ainda queued/pending recente — espera reconciler/webhook.
                  await finishRow(row.id, claimToken, {
                    next_action_at: new Date(now.getTime() + 3 * 60_000).toISOString(),
                  });
                  detail = {
                    ...detail,
                    dispatch: "awaiting_ack",
                    effect_id: eff.effectId,
                    delivery_status: ack.delivery_status,
                  };
                  deferred++;
                  continue;
                }
              } else {
                detail = { ...detail, dispatch: "effect_already_sent", effect_id: eff.effectId };
                status = "queued";
              }
            } else if (
              (eff.status === "failed_final" || eff.status === "suppressed") &&
              (def.channel === "sms" || def.channel === "voice" || def.channel === "whatsapp")
            ) {
              // Destino inválido OU teto de tentativas: não fica em loop — avança escada.
              detail = {
                ...detail,
                dispatch: `effect_${eff.status}_advance`,
                effect_id: eff.effectId,
                advance_skip: true,
              };
              status = "failed";
            } else {
              // reserved/sending → outro worker; unknown → ambíguo (reconciliar);
              // suppressed/failed_final (outros canais) → não reenviar automaticamente.
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
              res = await dispatchVoiceCall(supabase, row, stage, cfg);
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
              {
                const grp = stageGroup(stage);
                if (grp === "B") touchedB++;
                else if (grp === "C") touchedC++;
                if (grp !== "A") {
                  await maybeAlertCap(grp, grp === "B" ? touchedB : touchedC, grp === "B" ? caps.capB : caps.capC);
                  await maybeAlertCap("G", touchedB + touchedC, caps.capGlobal);
                }
              }
              await finishOutboundEffect(supabase, eff.effectId, "sent", {
                providerStatus: String(res.detail || "").slice(0, 200),
                providerMessageId: res.messageId || null,
              });
              await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "done");
              // WhatsApp: hold escada até ACK (webhook/reconciler) ou stale.
              if (def.channel === "whatsapp" && res.awaiting_ack) {
                status = "queued";
                detail = { ...detail, awaiting_ack: true, message_id: res.messageId || null };
                await finishRow(row.id, claimToken, {
                  next_action_at: new Date(now.getTime() + 3 * 60_000).toISOString(),
                });
                await supabase.from("cadence_action_log").insert({
                  customer_id: row.customer_id,
                  consultant_id: row.consultant_id,
                  stage, channel: def.channel, status, detail,
                }).then(() => {}, () => {});
                deferred++;
                continue;
              }
            } else if (res.softDefer) {
              // Intervalo anti-ban: liberar efeito e reagendar em segundos.
              // NÃO contar como failed da pessoa (evita N logs × 1 lead).
              status = "queued";
              detail = {
                ...detail,
                soft_defer: true,
                retry_in_ms: res.retryInMs ?? 20_000,
              };
              await finishOutboundEffect(supabase, eff.effectId, "released", {
                errorCode: String(res.detail || "min_interval").slice(0, 120),
              });
              await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
              const retryMs = Math.max(3_000, Math.min(Number(res.retryInMs) || 20_000, 60_000));
              await finishRow(row.id, claimToken, {
                next_action_at: new Date(now.getTime() + retryMs).toISOString(),
              });
              await supabase.from("cadence_action_log").insert({
                customer_id: row.customer_id,
                consultant_id: row.consultant_id,
                stage, channel: def.channel, status, detail,
              }).then(() => {}, () => {});
              deferred++;
              continue;
            } else {
              failed++;
              const permanent =
                !!res.permanent ||
                ((def.channel === "sms" || def.channel === "voice") &&
                  isPermanentSmsFailure(res.detail)) ||
                (def.channel === "whatsapp" && isPermanentWaFailure(res.detail));
              // Permanente (ex.: Mobile is not valid#240 / number invalid#203) → failed_final e avança.
              // Retryable → mesma chave (attempt++) e re-tenta em 30 min.
              await finishOutboundEffect(
                supabase,
                eff.effectId,
                permanent ? "failed_final" : "failed_retryable",
                { errorCode: String(res.detail || "send_failed").slice(0, 120) },
              );
              await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
              if (permanent) {
                detail = { ...detail, permanent_fail: true, advance_skip: true };
                // status fica "failed" no log, mas caímos no avanço abaixo.
              }
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

    if (status === "failed" && !detail.advance_skip) {
      // Intervalo mínimo residual: reagendar em segundos, não 30 min.
      const dispatch = String(detail.dispatch || "");
      const isMinInterval = dispatch.includes("min_interval");
      const deferMs = isMinInterval ? 20_000 : 30 * 60_000;
      await finishRow(row.id, claimToken, {
        next_action_at: new Date(now.getTime() + deferMs).toISOString(),
      });
      continue;
    }

    // Espera do PRÓXIMO estágio (delay_hours do banco ou STAGE_MAP).
    const nextCfg = await loadStageConfig(supabase, row.consultant_id, def.next);
    const nextAt = computeNextActionAt(def.next, now, nextCfg?.delay_hours ?? null);
    const attempts = (row.attempts_by_channel as Record<string, number>) ?? {};
    attempts[def.channel] = (attempts[def.channel] ?? 0) + 1;

    const finished = await finishRow(row.id, claimToken, {
      stage: def.next,
      last_action_at: now.toISOString(),
      next_action_at: nextAt?.toISOString() ?? null,
      attempts_by_channel: attempts,
      paused_until: null,
      ...(typeof detail.effect_id === "string" ? { last_effect_id: detail.effect_id } : {}),
    });

    if (finished && def.next === "CLOSE_LOST") {
      await notifyPartnerOfLoss(supabase, row.customer_id, row.consultant_id);
    }

    dispatched++;
  }

  await finishAutomationRun(supabase, runId, failed > 0 ? "partial" : "completed", {
    processed: due.length, dispatched, deferred, skipped, sent, failed, resumed,
    audience_blocked: audienceBlocked,
    consultant_pref_off: consultantPrefOff,
    cliente_blocked: clienteBlocked,
  });

  const summary = {
    processed: due.length,
    dispatched,
    deferred,
    skipped,
    sent,
    failed,
    resumed,
    audience_blocked: audienceBlocked,
    consultant_pref_off: consultantPrefOff,
    cliente_blocked: clienteBlocked,
    caps,
    touched_today: { b: touchedB, c: touchedC, global: touchedB + touchedC },
    ms: Date.now() - bootTs,
  };
  console.info("[cadence-tick] done", summary);
  return json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[cadence-tick] fatal", { error: msg, stack, ms: Date.now() - bootTs });
    return json({ error: "cadence_tick_fatal", message: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}