/** Quiet hours para nudge FAQ (BRT). Exportado para testes unitários. */

export const NUDGE_QUIET_START_HOUR = 21;
export const NUDGE_QUIET_START_MIN = 30;
export const NUDGE_QUIET_END_HOUR = 8;

/** Retorna true se `at` cai na janela 21:30–08:00 BRT. */
export function isQuietHoursBRT(at: Date = new Date()): boolean {
  const brtHour = (at.getUTCHours() - 3 + 24) % 24;
  const brtMin = at.getUTCMinutes();
  if (brtHour > NUDGE_QUIET_START_HOUR || (brtHour === NUDGE_QUIET_START_HOUR && brtMin >= NUDGE_QUIET_START_MIN)) {
    return true;
  }
  if (brtHour < NUDGE_QUIET_END_HOUR) return true;
  return false;
}
