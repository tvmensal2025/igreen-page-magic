/**
 * Helpers de pausa de campanha Meta.
 *
 * Regra de ouro: pausa MANUAL do consultor NUNCA é revertida por cron,
 * healthcheck, recarga de carteira ou realinhamento de lifetime.
 * Só o clique explícito do consultor (toggle activate / estender) reativa.
 */

export const MANUAL_PAUSE_PREFIX = "MANUAL_PAUSE:";
export const MANUAL_PAUSE_REASON = "MANUAL_PAUSE: Pausada pelo consultor — só reativa com clique";

export function isManualPause(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = String(reason);
  return r.startsWith(MANUAL_PAUSE_PREFIX) || /pausad[ao] pelo consultor/i.test(r);
}

/** Pausa automática por saldo/teto — pode reativar após recarga. */
export function isAutoBalancePause(reason: string | null | undefined): boolean {
  if (!reason || isManualPause(reason)) return false;
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

/** Motivos recuperáveis que o healthcheck PODE tentar reativar (nunca MANUAL). */
export function isRecoverableAutoPause(reason: string | null | undefined): boolean {
  if (!reason || isManualPause(reason)) return false;
  const r = String(reason).toLowerCase();
  return (
    r.includes("rate limit") ||
    r.includes("transient") ||
    r.includes("session_invalidated") ||
    r.includes("temporarily") ||
    r.includes("try again")
  );
}
