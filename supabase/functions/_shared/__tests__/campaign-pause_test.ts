import {
  isManualPause,
  isManualStop,
  isConsultantLocked,
  isAutoBalancePause,
  isRecoverableAutoPause,
  MANUAL_PAUSE_REASON,
  MANUAL_STOP_REASON,
} from "../campaign-pause.ts";

Deno.test("isManualPause detecta prefixo e texto", () => {
  if (!isManualPause(MANUAL_PAUSE_REASON)) throw new Error("MANUAL_PAUSE_REASON");
  if (!isManualPause("MANUAL_PAUSE: foo")) throw new Error("prefix");
  if (!isManualPause("Pausada pelo consultor")) throw new Error("texto");
  if (isManualPause("Auto-pausada: saldo zerado")) throw new Error("não deve ser manual");
  if (isManualPause(null)) throw new Error("null");
  if (isManualPause(MANUAL_STOP_REASON)) throw new Error("stop não é pause");
});

Deno.test("isManualStop detecta prefixo e texto", () => {
  if (!isManualStop(MANUAL_STOP_REASON)) throw new Error("MANUAL_STOP_REASON");
  if (!isManualStop("MANUAL_STOP: foo")) throw new Error("prefix");
  if (!isManualStop("Encerrada pelo consultor")) throw new Error("texto");
  if (isManualStop(MANUAL_PAUSE_REASON)) throw new Error("pause não é stop");
  if (isManualStop(null)) throw new Error("null");
});

Deno.test("isConsultantLocked cobre pause e stop", () => {
  if (!isConsultantLocked(MANUAL_PAUSE_REASON)) throw new Error("pause");
  if (!isConsultantLocked(MANUAL_STOP_REASON)) throw new Error("stop");
  if (isConsultantLocked("Auto-pausada: saldo zerado")) throw new Error("auto");
});

Deno.test("isAutoBalancePause só saldo/teto", () => {
  if (!isAutoBalancePause("Auto-pausada: saldo da carteira zerou — recarregue para reativar")) {
    throw new Error("saldo");
  }
  if (!isAutoBalancePause("Auto-pausada: gastou R$ 10 do teto reservado")) {
    throw new Error("teto");
  }
  if (isAutoBalancePause(MANUAL_PAUSE_REASON)) throw new Error("manual não é balance");
  if (isAutoBalancePause(MANUAL_STOP_REASON)) throw new Error("stop não é balance");
  if (isAutoBalancePause(null)) throw new Error("null");
});

Deno.test("isRecoverableAutoPause nunca inclui manual/stop", () => {
  if (!isRecoverableAutoPause("rate limit exceeded")) throw new Error("rate");
  if (isRecoverableAutoPause(MANUAL_PAUSE_REASON)) throw new Error("manual");
  if (isRecoverableAutoPause(MANUAL_STOP_REASON)) throw new Error("stop");
  if (isRecoverableAutoPause("Auto-pausada: saldo zerado")) throw new Error("saldo não é recoverable no healthcheck");
  if (isRecoverableAutoPause(null)) throw new Error("null");
});
