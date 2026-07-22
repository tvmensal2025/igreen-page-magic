/**
 * Helpers de pausa/encerramento de campanha Meta.
 *
 * Regra de ouro: pausa MANUAL, STOP e AUTO_PERF_PAUSE (waste guard) NUNCA são
 * revertidos por cron/healthcheck. Só Play / Estender reativa.
 */

export const MANUAL_PAUSE_PREFIX = "MANUAL_PAUSE:";
export const MANUAL_PAUSE_REASON = "MANUAL_PAUSE: Pausada pelo consultor — só reativa com clique";

export const MANUAL_STOP_PREFIX = "MANUAL_STOP:";
export const MANUAL_STOP_REASON = "MANUAL_STOP: Encerrada pelo consultor — só reativa com Estender";

export function isManualPause(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = String(reason);
  return r.startsWith(MANUAL_PAUSE_PREFIX) || /pausad[ao] pelo consultor/i.test(r);
}

export function isManualStop(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = String(reason);
  return r.startsWith(MANUAL_STOP_PREFIX) || /encerrad[ao] pelo consultor/i.test(r);
}

/** Pausa automática por desempenho (waste guard) — só Play reativa. */
export function isAutoPerfPause(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return String(reason).startsWith("AUTO_PERF_PAUSE:");
}

/** Consultor travou OU waste guard — cron/healthcheck não mexem. */
export function isConsultantLocked(reason: string | null | undefined): boolean {
  return isManualPause(reason) || isManualStop(reason) || isAutoPerfPause(reason);
}

/** Pausa automática por saldo/teto — pode reativar após recarga. */
export function isAutoBalancePause(reason: string | null | undefined): boolean {
  if (!reason || isConsultantLocked(reason)) return false;
  const r = String(reason).toLowerCase();
  return (
    r.includes("auto-pausada") ||
    r.includes("saldo") ||
    r.includes("carteira") ||
    r.includes("teto reservado") ||
    r.includes("débito") ||
    r.includes("debito")
  );
}

/** Motivos recuperáveis que o healthcheck PODE tentar reativar (nunca MANUAL/STOP/PERF). */
export function isRecoverableAutoPause(reason: string | null | undefined): boolean {
  if (!reason || isConsultantLocked(reason)) return false;
  const r = String(reason).toLowerCase();
  return (
    r.includes("rate limit") ||
    r.includes("transient") ||
    r.includes("session_invalidated") ||
    r.includes("temporarily") ||
    r.includes("try again")
  );
}
