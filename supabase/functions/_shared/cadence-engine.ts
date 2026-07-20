/**
 * Motor "Zero Lead Perdido" — máquina de estados por lead (plano v5).
 *
 * Onda curta (Grupo B): D+1 → D10, 1 canal principal/janela; SMS/call se silêncio.
 * Escada longa (Grupo C): cada marco = WA análise → SMS se silêncio → ligação se silêncio.
 * Remarketing ads: ~15 dias após fim da onda (RETARGET_ADS_15D).
 */

import { nextBusinessSlot, isBusinessHour } from "./business-window.ts";

export type Stage =
  | "NEW" | "GREETED" | "AI_QUALIFYING"
  /** Grupo A — silêncio antes do B: retomada → SMS → call → fecha A → COLD_1 */
  | "A_NUDGE" | "A_SMS" | "A_CALL" | "A_CALL_RETRY"
  | "COLD_1" | "COLD_2" | "CALL_1" | "SMS_1"
  | "COLD_3" | "CALL_2" | "SMS_2" | "SMS_TEMA_2" | "SMS_TEMA_7"
  | "COLD_4" | "CALL_3"
  | "CLOSE_LOST" | "RETARGET_META" | "RETARGET_ADS_15D"
  | "RECALL_60D" | "RECALL_60D_SMS" | "RECALL_60D_CALL"
  | "RECALL_90D" | "RECALL_90D_SMS" | "RECALL_90D_CALL"
  | "RECALL_5M" | "RECALL_5M_SMS" | "RECALL_5M_CALL"
  | "RECALL_8M" | "RECALL_8M_SMS" | "RECALL_8M_CALL"
  | "RECALL_12M" | "RECALL_12M_SMS" | "RECALL_12M_CALL"
  | "RECALL_YEARLY" | "RECALL_YEARLY_SMS" | "RECALL_YEARLY_CALL"
  | "PAUSED" | "WON";

export type Channel = "whatsapp" | "voice" | "sms" | "meta_audience" | "system";

export type StageDef = {
  channel: Channel;
  /** Atraso padrão (horas) até a próxima ação — sobrescrito por cadence_stage_config.delay_hours. */
  delayHours: number;
  next: Stage;
  requiresBusinessHours: boolean;
  /** Se true, o tick pode pular o disparo quando o lead já engajou (inbound). */
  skipIfEngaged?: boolean;
};

/**
 * delayHours = espera APÓS entrar no estágio (antes de disparar este estágio).
 * Ao avançar A→B, next_action_at = now + B.delayHours.
 *
 * Grupo A — silêncio no chat quente (pizza):
 *   aguardando → retomada WA → SMS → ligação → fecha A → Grupo B (COLD_1).
 *
 * Grupo C — cada marco longo:
 *   WA (análise) → SMS (~2h se silêncio) → ligação (~4h se silêncio) → próximo marco.
 */
export const STAGE_MAP: Record<Stage, StageDef | null> = {
  NEW:           { channel: "system",    delayHours: 0,   next: "GREETED",          requiresBusinessHours: false },
  // 2h de silêncio antes da escada A — não pula direto pro B.
  GREETED:       { channel: "system",    delayHours: 2,   next: "A_NUDGE",          requiresBusinessHours: false },
  AI_QUALIFYING: { channel: "system",    delayHours: 2,   next: "A_NUDGE",          requiresBusinessHours: false },

  A_NUDGE:       { channel: "whatsapp",  delayHours: 0,   next: "A_SMS",            requiresBusinessHours: true,  skipIfEngaged: true },
  A_SMS:         { channel: "sms",       delayHours: 2,   next: "A_CALL",           requiresBusinessHours: true,  skipIfEngaged: true },
  A_CALL:        { channel: "voice",     delayHours: 2,   next: "A_CALL_RETRY",     requiresBusinessHours: true,  skipIfEngaged: true },
  A_CALL_RETRY:  { channel: "voice",     delayHours: 0.5, next: "COLD_1",           requiresBusinessHours: true,  skipIfEngaged: true },

  COLD_1:        { channel: "whatsapp",  delayHours: 0,   next: "SMS_1",            requiresBusinessHours: true,  skipIfEngaged: false },
  SMS_1:         { channel: "sms",       delayHours: 2,   next: "CALL_1",           requiresBusinessHours: true,  skipIfEngaged: true },
  CALL_1:        { channel: "voice",     delayHours: 4,   next: "COLD_2",           requiresBusinessHours: true,  skipIfEngaged: true },

  COLD_2:        { channel: "whatsapp",  delayHours: 18,  next: "SMS_TEMA_2",       requiresBusinessHours: true,  skipIfEngaged: true },
  SMS_TEMA_2:    { channel: "sms",       delayHours: 2,   next: "CALL_2",           requiresBusinessHours: true,  skipIfEngaged: true },
  CALL_2:        { channel: "voice",     delayHours: 48,  next: "SMS_2",            requiresBusinessHours: true,  skipIfEngaged: true },
  SMS_2:         { channel: "sms",       delayHours: 48,  next: "COLD_3",           requiresBusinessHours: true,  skipIfEngaged: true },

  COLD_3:        { channel: "whatsapp",  delayHours: 24,  next: "SMS_TEMA_7",       requiresBusinessHours: true,  skipIfEngaged: true },
  SMS_TEMA_7:    { channel: "sms",       delayHours: 2,   next: "CALL_3",           requiresBusinessHours: true,  skipIfEngaged: true },
  CALL_3:        { channel: "voice",     delayHours: 72,  next: "COLD_4",           requiresBusinessHours: true,  skipIfEngaged: true },
  COLD_4:        { channel: "whatsapp",  delayHours: 2,   next: "CLOSE_LOST",       requiresBusinessHours: true,  skipIfEngaged: true },

  CLOSE_LOST:        { channel: "meta_audience", delayHours: 0,    next: "RETARGET_META",     requiresBusinessHours: false },
  RETARGET_META:     { channel: "meta_audience", delayHours: 24,   next: "RETARGET_ADS_15D",  requiresBusinessHours: false },
  RETARGET_ADS_15D:  { channel: "meta_audience", delayHours: 336,  next: "RECALL_60D",       requiresBusinessHours: false },

  // Após Meta/ads: 336h ≈ 14d até o 1º recall WA (não esperar 45d).
  // Timeline aprox. após Dia 10: +1d Meta + ~15d ads + ~14d ≈ 30d até RECALL_60D.
  // WA principal do marco: NÃO skipIfEngaged (senão queima a escada sem tentar contato).
  // SMS/CALL do marco: skip se o lead já engajou.
  RECALL_60D:         { channel: "whatsapp", delayHours: 336,  next: "RECALL_60D_SMS",   requiresBusinessHours: true, skipIfEngaged: false },
  RECALL_60D_SMS:     { channel: "sms",      delayHours: 2,    next: "RECALL_60D_CALL",  requiresBusinessHours: true, skipIfEngaged: true },
  RECALL_60D_CALL:    { channel: "voice",    delayHours: 4,    next: "RECALL_90D",       requiresBusinessHours: true, skipIfEngaged: true },

  // ~90 dias
  RECALL_90D:         { channel: "whatsapp", delayHours: 720,  next: "RECALL_90D_SMS",   requiresBusinessHours: true, skipIfEngaged: false },
  RECALL_90D_SMS:     { channel: "sms",      delayHours: 2,    next: "RECALL_90D_CALL",  requiresBusinessHours: true, skipIfEngaged: true },
  RECALL_90D_CALL:    { channel: "voice",    delayHours: 4,    next: "RECALL_5M",        requiresBusinessHours: true, skipIfEngaged: true },

  // ~5 meses
  RECALL_5M:          { channel: "whatsapp", delayHours: 1440, next: "RECALL_5M_SMS",    requiresBusinessHours: true, skipIfEngaged: false },
  RECALL_5M_SMS:      { channel: "sms",      delayHours: 2,    next: "RECALL_5M_CALL",   requiresBusinessHours: true, skipIfEngaged: true },
  RECALL_5M_CALL:     { channel: "voice",    delayHours: 4,    next: "RECALL_8M",        requiresBusinessHours: true, skipIfEngaged: true },

  // ~8 meses
  RECALL_8M:          { channel: "whatsapp", delayHours: 2160, next: "RECALL_8M_SMS",    requiresBusinessHours: true, skipIfEngaged: false },
  RECALL_8M_SMS:      { channel: "sms",      delayHours: 2,    next: "RECALL_8M_CALL",   requiresBusinessHours: true, skipIfEngaged: true },
  RECALL_8M_CALL:     { channel: "voice",    delayHours: 4,    next: "RECALL_12M",       requiresBusinessHours: true, skipIfEngaged: true },

  // ~12 meses
  RECALL_12M:         { channel: "whatsapp", delayHours: 2880, next: "RECALL_12M_SMS",   requiresBusinessHours: true, skipIfEngaged: false },
  RECALL_12M_SMS:     { channel: "sms",      delayHours: 2,    next: "RECALL_12M_CALL",  requiresBusinessHours: true, skipIfEngaged: true },
  RECALL_12M_CALL:    { channel: "voice",    delayHours: 4,    next: "RECALL_YEARLY",    requiresBusinessHours: true, skipIfEngaged: true },

  // Loop anual
  RECALL_YEARLY:      { channel: "whatsapp", delayHours: 8760, next: "RECALL_YEARLY_SMS",  requiresBusinessHours: true, skipIfEngaged: false },
  RECALL_YEARLY_SMS:  { channel: "sms",      delayHours: 2,    next: "RECALL_YEARLY_CALL", requiresBusinessHours: true, skipIfEngaged: true },
  RECALL_YEARLY_CALL: { channel: "voice",    delayHours: 4,    next: "RECALL_YEARLY",      requiresBusinessHours: true, skipIfEngaged: true },

  PAUSED:        null,
  WON:           null,
};

/** Estágios de outreach frio (contam no cap diário — Grupo B/C). Grupo A não entra. */
export const COLD_OUTREACH_STAGES: ReadonlySet<Stage> = new Set([
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

export function isColdOutreachStage(stage: string): boolean {
  return COLD_OUTREACH_STAGES.has(stage as Stage);
}

export function computeNextActionAt(
  fromStage: Stage,
  base: Date = new Date(),
  delayHoursOverride?: number | null,
): Date | null {
  const def = STAGE_MAP[fromStage];
  if (!def) return null;
  const hours = typeof delayHoursOverride === "number" && delayHoursOverride >= 0
    ? delayHoursOverride
    : def.delayHours;
  const raw = new Date(base.getTime() + hours * 3600_000);
  return def.requiresBusinessHours ? nextBusinessSlot(raw) : raw;
}

export function shouldDispatch(stage: Stage, now: Date = new Date()): boolean {
  const def = STAGE_MAP[stage];
  if (!def) return false;
  if (def.requiresBusinessHours && !isBusinessHour(now)) return false;
  return true;
}

/** Próximo slot 09h BRT (aprox. via nextBusinessSlot após +horas mínimas). */
export function nextBusinessMorning(base: Date = new Date()): Date {
  const plus = new Date(base.getTime() + 12 * 3600_000);
  return nextBusinessSlot(plus);
}
