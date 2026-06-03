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
// Whapi raramente exige reconnect (é cloud), mas mantemos a mesma API
// para o caso de fallback. Persistimos via RPC para não martelar.
const RECONNECT_COOLDOWN_MS = 600_000;

export async function canReconnect(supabase: any, instance: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("try_acquire_reconnect_slot", {
      p_instance: instance,
      p_cooldown_ms: RECONNECT_COOLDOWN_MS,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export const OCR_CONFIDENCE_THRESHOLD = 70;
