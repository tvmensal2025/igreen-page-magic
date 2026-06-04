// Shared helpers extracted from evolution-webhook/index.ts
// Pure logic: rate limit, reconnect cooldown, MinIO upload wrapper.
// No behavior change — same constants, same map semantics.

import { uploadMediaUnified } from "../_shared/media-storage.ts";

// ── MinIO upload with auto Supabase fallback ─────────────────────────
export async function uploadMediaToMinio(opts: {
  fileBase64: string;
  mimeType: string;
  consultantFolder: string;
  consultantName?: string;
  customerName: string;
  customerBirth?: string | null;
  kind: "conta" | "doc_frente" | "doc_verso";
}): Promise<string | null> {
  try {
    const result = await uploadMediaUnified(opts);
    return result.url;
  } catch (err: any) {
    console.error(`📦❌ Upload TOTALMENTE falhou [${opts.kind}]:`, err?.message || err);
    return null;
  }
}

// ── Per-phone rate limiter (anti-flood) ──────────────────────────────
const rateLimitMap = new Map<string, number[]>();
export const RATE_LIMIT_WINDOW_MS = 5_000;
export const RATE_LIMIT_MAX = 4;

export function isRateLimited(phone: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(phone) || [];
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitMap.set(phone, recent);
  if (rateLimitMap.size > 100) {
    for (const [key, ts] of rateLimitMap) {
      if (ts.every(t => now - t > 60_000)) rateLimitMap.delete(key);
    }
  }
  return recent.length > RATE_LIMIT_MAX;
}

// ── Reconnect cooldown per-instance (DB-backed, 10 min) ──────────────
// IMPORTANTE: Edge Functions são serverless — `Map` em memória é apagado
// a cada cold start. Antes o cooldown era ignorado e o sistema reconectava
// em loop, o que é a causa #1 de banimento. Agora persistimos via RPC.
const RECONNECT_COOLDOWN_MS = 600_000; // 10 minutos

export async function canReconnect(
  supabase: any,
  instance: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("try_acquire_reconnect_slot", {
      p_instance: instance,
      p_cooldown_ms: RECONNECT_COOLDOWN_MS,
    });
    if (error) {
      console.warn(`[canReconnect] RPC error for ${instance}:`, error.message);
      // Fail-CLOSED: em caso de erro, NÃO reconecta (mais seguro p/ o chip).
      return false;
    }
    return data === true;
  } catch (e: any) {
    console.warn(`[canReconnect] exception for ${instance}:`, e?.message);
    return false;
  }
}

// ── Disconnect reason classification (Baileys / WhatsApp) ────────────
// Reconectar uma sessão derrubada por logout/ban/conflito ACELERA o
// banimento. Só reconectamos em motivos transitórios genuínos.
//
// IMPORTANTE: `statusReason` ausente (undefined/null) é tratado como
// TRANSIENTE — Evolution às vezes omite o campo em quedas de rede /
// restart de servidor. Tratar como fatal causa 14 dias de lock falso.
// Apenas o valor explícito `0` (unknown) continua FATAL, pois indica
// "fechou e o servidor não soube dizer porquê" — costuma ser ban silencioso.
export type DisconnectClass = "fatal" | "transient";

const FATAL_DISCONNECT_REASONS = new Set<number>([
  0,   // unknown/unspecified EXPLÍCITO — possível ban silencioso
  401, // loggedOut
  403, // forbidden / banned
  405, // bad credentials
  409, // conflict
  411, // multi-device mismatch
  440, // connectionReplaced
]);

export function classifyDisconnect(statusReason: number | null | undefined): DisconnectClass {
  // Campo ausente do payload → trata como transiente para não disparar
  // 14d de lock por causa de um glitch de rede que omitiu o motivo.
  if (statusReason === undefined || statusReason === null) return "transient";
  const code = Number(statusReason);
  if (!Number.isFinite(code)) return "transient";
  return FATAL_DISCONNECT_REASONS.has(code) ? "fatal" : "transient";
}

// ── Helper: registra sinal de risco (circuit breaker) ────────────────
export async function recordRiskSignal(
  supabase: any,
  instance: string,
  signalType: "reconnect" | "send_failure" | "disconnect_fatal" | "disconnect_transient",
  severity: "low" | "medium" | "high" | "critical" = "low",
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.rpc("record_risk_signal", {
      p_instance: instance,
      p_signal_type: signalType,
      p_severity: severity,
      p_metadata: metadata ?? null,
      p_ttl_hours: 6,
    });
  } catch (e: any) {
    console.warn(`[recordRiskSignal] failed:`, e?.message);
  }
}

// ── Helper: ativa modo recuperação (14 dias após desconexão fatal) ────
export async function activateRecoveryMode(
  supabase: any,
  instance: string,
  hours = 336,
): Promise<void> {
  try {
    await supabase.rpc("activate_recovery_mode", { p_instance: instance, p_hours: hours });
  } catch (e: any) {
    console.warn(`[activateRecoveryMode] failed:`, e?.message);
  }
}

export const OCR_CONFIDENCE_THRESHOLD = 70;
