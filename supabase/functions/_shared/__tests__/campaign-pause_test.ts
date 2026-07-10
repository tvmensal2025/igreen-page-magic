import {
  isManualPause,
  isAutoBalancePause,
  isRecoverableAutoPause,
  MANUAL_PAUSE_REASON,
} from "../campaign-pause.ts";

Deno.test("isManualPause detecta prefixo e texto", () => {
  if (!isManualPause(MANUAL_PAUSE_REASON)) throw new Error("MANUAL_PAUSE_REASON");
  if (!isManualPause("MANUAL_PAUSE: foo")) throw new Error("prefix");
  if (!isManualPause("Pausada pelo consultor")) throw new Error("texto");
  if (isManualPause("Auto-pausada: saldo zerado")) throw new Error("não deve ser manual");
  if (isManualPause(null)) throw new Error("null");
});

Deno.test("isAutoBalancePause só saldo/teto", () => {
  if (!isAutoBalancePause("Auto-pausada: saldo da carteira zerou — recarregue para reativar")) {
    throw new Error("saldo");
  }
  if (!isAutoBalancePause("Auto-pausada: gastou R$ 10 do teto reservado")) {
    throw new Error("teto");
  }
  if (isAutoBalancePause(MANUAL_PAUSE_REASON)) throw new Error("manual não é balance");
  if (isAutoBalancePause(null)) throw new Error("null");
});

Deno.test("isRecoverableAutoPause nunca inclui manual", () => {
  if (!isRecoverableAutoPause("rate limit exceeded")) throw new Error("rate");
  if (isRecoverableAutoPause(MANUAL_PAUSE_REASON)) throw new Error("manual");
  if (isRecoverableAutoPause("Auto-pausada: saldo zerado")) throw new Error("saldo não é recoverable no healthcheck");
  if (isRecoverableAutoPause(null)) throw new Error("null");
});
