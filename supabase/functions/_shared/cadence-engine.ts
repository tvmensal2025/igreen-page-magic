/**
 * Motor "Zero Lead Perdido" — máquina de estados por lead (plano v5).
 *
 * Onda curta (Grupo B): D+1 → D10, 1 canal principal/janela; SMS/call se silêncio.
 * Escada longa: RECALL_* até WON/DNC (1 toque/fase).
 * Remarketing ads: ~15 dias após fim da onda (RETARGET_ADS_15D).
 */

import { nextBusinessSlot, isBusinessHour } from "./business-window.ts";

export type Stage =
  | "NEW" | "GREETED" | "AI_QUALIFYING"
  | "COLD_1" | "COLD_2" | "CALL_1" | "SMS_1"
  | "COLD_3" | "CALL_2" | "SMS_2"
  | "COLD_4" | "CALL_3"
  | "CLOSE_LOST" | "RETARGET_META" | "RETARGET_ADS_15D"
  | "RECALL_60D" | "RECALL_90D" | "RECALL_5M" | "RECALL_8M" | "RECALL_12M" | "RECALL_YEARLY"
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
 * Calendário profissional (anti-spam):
 * GREETED → COLD_1 (~1 dia útil)
 * COLD_1 → SMS_1 (~2h se silêncio) → CALL_1 (~até tarde) → COLD_2 (Dia 2)
 * → CALL_2 (Dia 4) → SMS_2 (Dia 6) → COLD_3 (Dia 7) → CALL_3 → COLD_4 → CLOSE_LOST
 * → Meta → ads 15d → recalls 60d…yearly
 */
/**
 * delayHours = espera APÓS entrar no estágio (antes de disparar este estágio).
 * Ao avançar A→B, next_action_at = now + B.delayHours.
 */
export const STAGE_MAP: Record<Stage, StageDef | null> = {
  NEW:           { channel: "system",    delayHours: 0,   next: "GREETED",          requiresBusinessHours: false },
  // Garante ~1 dia útil até o tick avançar GREETED→COLD_1.
  GREETED:       { channel: "system",    delayHours: 24,  next: "COLD_1",           requiresBusinessHours: false },
  AI_QUALIFYING: { channel: "system",    delayHours: 24,  next: "COLD_1",           requiresBusinessHours: false },

  // D+1: WA logo ao entrar; SMS ~2h; call ~4h depois; depois Dia 2.
  COLD_1:        { channel: "whatsapp",  delayHours: 0,   next: "SMS_1",            requiresBusinessHours: true,  skipIfEngaged: false },
  SMS_1:         { channel: "sms",       delayHours: 2,   next: "CALL_1",           requiresBusinessHours: true,  skipIfEngaged: true },
  CALL_1:        { channel: "voice",     delayHours: 4,   next: "COLD_2",           requiresBusinessHours: true,  skipIfEngaged: true },

  COLD_2:        { channel: "whatsapp",  delayHours: 18,  next: "CALL_2",           requiresBusinessHours: true },
  CALL_2:        { channel: "voice",     delayHours: 48,  next: "SMS_2",            requiresBusinessHours: true },
  SMS_2:         { channel: "sms",       delayHours: 48,  next: "COLD_3",           requiresBusinessHours: true },

  COLD_3:        { channel: "whatsapp",  delayHours: 24,  next: "CALL_3",           requiresBusinessHours: true },
  CALL_3:        { channel: "voice",     delayHours: 72,  next: "COLD_4",           requiresBusinessHours: true },
  COLD_4:        { channel: "whatsapp",  delayHours: 2,   next: "CLOSE_LOST",       requiresBusinessHours: true,  skipIfEngaged: true },

  CLOSE_LOST:        { channel: "meta_audience", delayHours: 0,    next: "RETARGET_META",     requiresBusinessHours: false },
  RETARGET_META:     { channel: "meta_audience", delayHours: 24,   next: "RETARGET_ADS_15D",  requiresBusinessHours: false },
  // ~14d após Meta ≈ dia 15 da onda encerrada
  RETARGET_ADS_15D:  { channel: "meta_audience", delayHours: 336,  next: "RECALL_60D",       requiresBusinessHours: false },
  // ~45d depois ≈ dia 60
  RECALL_60D:    { channel: "sms",       delayHours: 1080, next: "RECALL_90D",      requiresBusinessHours: true },
  RECALL_90D:    { channel: "whatsapp",  delayHours: 720,  next: "RECALL_5M",       requiresBusinessHours: true },
  RECALL_5M:     { channel: "voice",     delayHours: 1440, next: "RECALL_8M",       requiresBusinessHours: true },
  RECALL_8M:     { channel: "sms",       delayHours: 2160, next: "RECALL_12M",      requiresBusinessHours: true },
  RECALL_12M:    { channel: "whatsapp",  delayHours: 2880, next: "RECALL_YEARLY",   requiresBusinessHours: true },
  RECALL_YEARLY: { channel: "sms",       delayHours: 8760, next: "RECALL_YEARLY",   requiresBusinessHours: true },

  PAUSED:        null,
  WON:           null,
};

/** Estágios de outreach frio (contam no cap 60/dia). */
export const COLD_OUTREACH_STAGES: ReadonlySet<Stage> = new Set([
  "COLD_1", "COLD_2", "COLD_3", "COLD_4",
  "CALL_1", "CALL_2", "CALL_3",
  "SMS_1", "SMS_2",
  "RECALL_60D", "RECALL_90D", "RECALL_5M", "RECALL_8M", "RECALL_12M", "RECALL_YEARLY",
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
