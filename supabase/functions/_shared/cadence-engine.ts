/**
 * Motor "Zero Lead Perdido" — máquina de estados por lead.
 *
 * Cada estágio define:
 *   - próximo estágio
 *   - atraso (horas) até a próxima ação
 *   - canal do disparo
 *
 * A execução é feita por `cadence-tick` (cron 5 min).
 */

import { nextBusinessSlot, isBusinessHour } from "./business-window.ts";

export type Stage =
  | "NEW" | "GREETED" | "AI_QUALIFYING"
  | "COLD_1" | "COLD_2" | "CALL_1" | "SMS_1"
  | "COLD_3" | "CALL_2" | "SMS_2"
  | "COLD_4" | "CALL_3"
  | "CLOSE_LOST" | "RETARGET_META" | "PAUSED" | "WON";

export type Channel = "whatsapp" | "voice" | "sms" | "meta_audience" | "system";

export type StageDef = {
  channel: Channel;
  delayHours: number;    // desde o último evento
  next: Stage;
  requiresBusinessHours: boolean;
};

export const STAGE_MAP: Record<Stage, StageDef | null> = {
  NEW:           { channel: "system",    delayHours: 0,   next: "GREETED",       requiresBusinessHours: false },
  GREETED:       { channel: "system",    delayHours: 24,  next: "COLD_1",        requiresBusinessHours: false },
  AI_QUALIFYING: { channel: "system",    delayHours: 24,  next: "COLD_1",        requiresBusinessHours: false },
  COLD_1:        { channel: "whatsapp",  delayHours: 24,  next: "COLD_2",        requiresBusinessHours: true  },
  COLD_2:        { channel: "whatsapp",  delayHours: 48,  next: "CALL_1",        requiresBusinessHours: true  },
  CALL_1:        { channel: "voice",     delayHours: 24,  next: "SMS_1",         requiresBusinessHours: true  },
  SMS_1:         { channel: "sms",       delayHours: 48,  next: "COLD_3",        requiresBusinessHours: true  },
  COLD_3:        { channel: "whatsapp",  delayHours: 72,  next: "CALL_2",        requiresBusinessHours: true  },
  CALL_2:        { channel: "voice",     delayHours: 48,  next: "SMS_2",         requiresBusinessHours: true  },
  SMS_2:         { channel: "sms",       delayHours: 96,  next: "COLD_4",        requiresBusinessHours: true  },
  COLD_4:        { channel: "whatsapp",  delayHours: 120, next: "CALL_3",        requiresBusinessHours: true  },
  CALL_3:        { channel: "voice",     delayHours: 168, next: "CLOSE_LOST",    requiresBusinessHours: true  },
  CLOSE_LOST:    { channel: "meta_audience", delayHours: 24, next: "RETARGET_META", requiresBusinessHours: false },
  RETARGET_META: null, // terminal — mantido em custom audience
  PAUSED:        null,
  WON:           null,
};

export function computeNextActionAt(fromStage: Stage, base: Date = new Date()): Date | null {
  const def = STAGE_MAP[fromStage];
  if (!def) return null;
  const raw = new Date(base.getTime() + def.delayHours * 3600_000);
  return def.requiresBusinessHours ? nextBusinessSlot(raw) : raw;
}

export function shouldDispatch(stage: Stage, now: Date = new Date()): boolean {
  const def = STAGE_MAP[stage];
  if (!def) return false;
  if (def.requiresBusinessHours && !isBusinessHour(now)) return false;
  return true;
}
