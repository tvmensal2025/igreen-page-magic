/**
 * Evolution API state-check primitives for useWhatsApp.
 * Pure factory: returns checkState/confirmConnectedState/tryGetQr/multiSignalCheck.
 */
import type { MutableRefObject } from "react";
import { connectInstance, getConnectionState } from "@/services/evolutionApi";
import {
  type ConnectionCheckState,
  type OperationalHealth,
  withTimeout,
  sleep,
  sanitize,
  isAuthError,
  isNotFoundError,
  isAlreadyConnectedError,
  extractDiagnostic,
  isTimeoutResponse,
  isMissingState,
} from "./whatsappHelpers";
import type { HealthControls } from "./whatsappHealth";

export interface StateChecksDeps {
  health: HealthControls;
  setHealth: (h: OperationalHealth) => void;
  timeoutCountRef: MutableRefObject<number>;
  addLog: (msg: string) => void;
}

export interface StateChecks {
  checkState: (name: string) => Promise<ConnectionCheckState>;
  confirmConnectedState: (name: string, attempts?: number, delayMs?: number) => Promise<boolean>;
  tryGetQr: (name: string) => Promise<{ qr: string | null; alreadyConnected: boolean }>;
  multiSignalCheck: (name: string) => Promise<ConnectionCheckState>;
}

export function createStateChecks(deps: StateChecksDeps): StateChecks {
  const { health, setHealth, timeoutCountRef, addLog } = deps;

  const checkState = async (name: string): Promise<ConnectionCheckState> => {
    try {
      const result = await withTimeout(getConnectionState(name), 15000) as Record<string, unknown>;
      if (!result) return "unknown";
      if (isMissingState(result)) return "missing";

      if (isTimeoutResponse(result)) {
        health.incrementTimeoutCounter();
        const diagnostic = extractDiagnostic(result);
        if (diagnostic?.reason === "instance_not_found") return "missing";
        return "unknown";
      }

      health.resetTimeoutCounter();
      const state: string = (result as { state?: string })?.state ||
        ((result as { instance?: { state?: string } })?.instance?.state) || "close";
      if (state === "open") return "open";
      if (state === "connecting") return "connecting";
      if (state === "close") return "close";
      return "unknown";
    } catch (err) {
      if (isAuthError(err)) throw err;
      const msg = err instanceof Error ? err.message : "";
      if (isNotFoundError(msg)) return "missing";
      if (msg === "timeout") health.incrementTimeoutCounter();
      return "unknown";
    }
  };

  const confirmConnectedState = async (name: string, attempts = 3, delayMs = 1500): Promise<boolean> => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const state = await checkState(name);
      if (state === "open") return true;
      if (state === "missing") return false;
      if (attempt < attempts - 1) await sleep(delayMs);
    }
    return false;
  };

  const tryGetQr = async (name: string): Promise<{ qr: string | null; alreadyConnected: boolean }> => {
    try {
      setHealth("recovering");
      const resp = await withTimeout(connectInstance(name), 15000);
      health.resetTimeoutCounter();
      return { qr: resp?.base64 || null, alreadyConnected: false };
    } catch (err) {
      if (isAuthError(err)) throw err;
      const msg = sanitize(err instanceof Error ? err.message : "");
      if (isAlreadyConnectedError(msg)) {
        health.resetTimeoutCounter();
        return { qr: null, alreadyConnected: true };
      }
      const confirmedOpen = await confirmConnectedState(name, 2, 1000);
      return { qr: null, alreadyConnected: confirmedOpen };
    }
  };

  // multiSignalCheck NÃO chama mais connectInstance — pedir QR só para
  // "confirmar estado" é uma das principais causas de comportamento
  // bot-like que leva a banimento. Confiamos somente no getConnectionState.
  const multiSignalCheck = async (name: string): Promise<ConnectionCheckState> => {
    const state1 = await checkState(name);
    return state1;
  };

  return { checkState, confirmConnectedState, tryGetQr, multiSignalCheck };
}