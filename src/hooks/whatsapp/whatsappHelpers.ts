/**
 * Pure helpers for the WhatsApp connection hooks.
 * Extracted from useWhatsApp.ts to keep the orchestrator hook focused.
 */
import { EvolutionAuthError } from "@/services/evolutionApi";

export type OperationalHealth =
  | "healthy"
  | "degraded"
  | "recovering"
  | "needs_qr"
  | "reset_recommended"
  | "resetting";

export type ConnectionCheckState =
  | "open"
  | "close"
  | "connecting"
  | "unknown"
  | "missing";

export interface DiagnosticInfo {
  reason?: string;
  recommendation?: string;
  retryAfterMs?: number;
  message?: string;
}

// ── Constants ──────────────────────────────────────────────
export const REL_LOGIN_MESSAGE = "Sessão expirada. Faça login novamente.";
export const MAX_CONSECUTIVE_TIMEOUTS = 5;
export const MAX_RECOVERY_CYCLES_WITHOUT_SIGNAL = 3;
export const DEGRADED_POLL_INTERVAL = 30000;
export const HEALTHY_POLL_INTERVAL = 60000;

// ── Pure helpers ───────────────────────────────────────────
export function logEntry(msg: string): string {
  const ts = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `[${ts}] ${msg}`;
}

export function sanitize(message: string): string {
  return message
    .replace(/evolution api/gi, "serviço de conexão")
    .replace(/evolution/gi, "serviço")
    .replace(/^\[\d{3}\]\s*/, "")
    .trim();
}

export function getFixedInstanceName(consultantId: string): string {
  const slug = consultantId.replace(/-/g, "").slice(0, 12);
  return `igreen-${slug}`;
}

/**
 * Nome único por tentativa — SÓ para casos legados / migração.
 * Conectar e Reset usam getFixedInstanceName (1 consultor = 1 instância).
 * Fresh names geravam multi-QR e ban (Abel 2026-07-28).
 */
export function getFreshInstanceName(consultantId: string): string {
  const slug = consultantId.replace(/-/g, "").slice(0, 12);
  const suffix = Date.now().toString(36);
  return `igreen-${slug}-${suffix}`;
}

export function isNotFoundError(message: string): boolean {
  return /404|not found|does not exist|instance.*not|inst[âa]ncia.*n[ãa]o/i.test(
    message,
  );
}

export function isAuthError(err: unknown): err is EvolutionAuthError {
  return err instanceof EvolutionAuthError;
}

export function isRecoverableConnectionError(message: string): boolean {
  return /timeout|connection closed|temporariamente|inst[áa]vel|erro de conex[ãa]o/i.test(
    message,
  );
}

export function isAlreadyConnectedError(message: string): boolean {
  return /already.*(connected|open)|connection.*already|j[áa].*conectad|inst[âa]ncia.*(aberta|conectada)/i.test(
    message,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    promise
      .then((v) => {
        clearTimeout(id);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(id);
        reject(e);
      });
  });
}

// ── Diagnostic response parsing ────────────────────────────
export function extractDiagnostic(
  result: Record<string, unknown>,
): DiagnosticInfo | null {
  if (result?.diagnostic && typeof result.diagnostic === "object") {
    return result.diagnostic as DiagnosticInfo;
  }
  return null;
}

export function isTimeoutResponse(result: Record<string, unknown>): boolean {
  return result?.timeout === true;
}

export function isMissingState(result: Record<string, unknown>): boolean {
  return (
    result?.state === "missing" ||
    (typeof result?.diagnostic === "object" &&
      result.diagnostic !== null &&
      (result.diagnostic as DiagnosticInfo).reason === "instance_not_found")
  );
}
