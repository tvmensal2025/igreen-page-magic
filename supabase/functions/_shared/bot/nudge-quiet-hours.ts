/**
 * Quiet hours para nudge FAQ (BRT). Exportado para testes unitários.
 *
 * Usa Intl com America/Sao_Paulo (mesma técnica de _shared/quiet-hours.ts)
 * em vez de aritmética UTC-3 fixa — assim os dois helpers nunca divergem
 * caso o Brasil volte a ter horário de verão.
 */

export const NUDGE_QUIET_START_HOUR = 20;
export const NUDGE_QUIET_START_MIN = 0;
export const NUDGE_QUIET_END_HOUR = 8;

/** Retorna true se `at` cai na janela 20:00–08:00 BRT. */
export function isQuietHoursBRT(at: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at); // "HH:MM"
  const [brtHour, brtMin] = fmt.split(":").map(Number);
  const minutes = (brtHour % 24) * 60 + brtMin;
  const start = NUDGE_QUIET_START_HOUR * 60 + NUDGE_QUIET_START_MIN;
  const end = NUDGE_QUIET_END_HOUR * 60;
  return minutes >= start || minutes < end;
}
