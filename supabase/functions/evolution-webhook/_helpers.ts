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
// reason=0 (unknown) também é tratado como FATAL — pode mascarar ban
// silencioso que o WhatsApp não detalha.
export type DisconnectClass = "fatal" | "transient";

const FATAL_DISCONNECT_REASONS = new Set<number>([
  0,   // unknown/unspecified — pode ser ban silencioso
  401, // loggedOut
  403, // forbidden / banned
  405, // bad credentials
  409, // conflict
  411, // multi-device mismatch
  440, // connectionReplaced
]);

export function classifyDisconnect(statusReason: number | null | undefined): DisconnectClass {
  const code = Number(statusReason);
  if (!Number.isFinite(code)) return "fatal"; // sem código → cautela
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
