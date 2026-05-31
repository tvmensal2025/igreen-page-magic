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

// ── Reconnect cooldown per-instance ──────────────────────────────────
const reconnectCooldowns = new Map<string, number>();
const RECONNECT_COOLDOWN_MS = 120_000;

export function canReconnect(instance: string): boolean {
  const now = Date.now();
  const last = reconnectCooldowns.get(instance) || 0;
  if (now - last < RECONNECT_COOLDOWN_MS) return false;
  reconnectCooldowns.set(instance, now);
  return true;
}

// ── Disconnect reason classification (Baileys / WhatsApp) ────────────
// O `statusReason` que chega no CONNECTION_UPDATE.close vem do
// DisconnectReason do Baileys (mapeado de códigos HTTP do WhatsApp Web).
// Reconectar automaticamente uma sessão derrubada por logout/ban/conflito
// é o que ACELERA e consolida o banimento do número: cada tentativa de
// repareamento é interpretada como comportamento abusivo pelo WhatsApp.
//
// Por isso só reconectamos em motivos transitórios (queda de rede, restart
// do servidor, timeout). Em motivos fatais a instância é marcada como
// `needs_reconnect` e exige um NOVO QR Code escaneado manualmente.
//
// Referência dos códigos Baileys DisconnectReason:
//   401 loggedOut          → aparelho desvinculou a sessão (fatal)
//   403 forbidden/banned   → número bloqueado pelo WhatsApp (fatal)
//   405 / 409 / 411 etc.   → conflito de credenciais (fatal)
//   440 connectionReplaced → sessão aberta em outro lugar (fatal)
//   428 connectionClosed   → queda transitória (reconectar)
//   408 timedOut           → timeout transitório (reconectar)
//   500 badSession / 515 restartRequired → reinício de stream (reconectar)
export type DisconnectClass = "fatal" | "transient";

// Motivos que NÃO devem disparar reconexão automática.
const FATAL_DISCONNECT_REASONS = new Set<number>([
  401, // loggedOut — sessão encerrada pelo aparelho
  403, // forbidden — número banido/bloqueado pelo WhatsApp
  405, // bad credentials / not authorized
  409, // conflict — outra sessão assumiu
  411, // multi-device mismatch
  440, // connectionReplaced — conectado em outro lugar
]);

export function classifyDisconnect(statusReason: number | null | undefined): DisconnectClass {
  const code = Number(statusReason) || 0;
  return FATAL_DISCONNECT_REASONS.has(code) ? "fatal" : "transient";
}

export const OCR_CONFIDENCE_THRESHOLD = 70;
