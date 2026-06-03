/**
 * Anti-ban guards compartilhados (Plano A — best practices 2026).
 *
 * Toda Edge Function que dispara mensagem via Evolution (bulk, reativação,
 * scheduled, followups) DEVE chamar `checkSendQuota` antes do envio e
 * `registerSend` depois. Isso aplica automaticamente:
 *
 *   • Ramp de aquecimento (D1=20, D14+=600 mensagens/dia).
 *   • Intervalo mínimo entre mensagens (60s → 18s conforme o dia).
 *   • Recovery mode (trava após ban / troca de chip por 14 dias).
 *   • Circuit breaker (reconexões, falhas, fatais nos últimos 6h).
 *
 * Falha fechada: em caso de erro de RPC, bloqueia o envio. É mais seguro
 * pausar um disparo do que queimar o chip de um consultor.
 *
 * Também expõe `simulateTyping` para enviar "digitando..." antes do
 * `sendText`, imitando comportamento humano.
 */

export interface SendQuotaResult {
  allowed: boolean;
  reason?: string;
  warmup_day?: number;
  cap?: number;
  sent?: number;
  remaining?: number;
  min_interval_ms?: number;
  next_allowed_at?: string;
  until?: string;
}

export async function checkSendQuota(
  supabase: any,
  instance: string,
): Promise<SendQuotaResult> {
  try {
    const { data, error } = await supabase.rpc("check_send_quota", { p_instance: instance });
    if (error) {
      console.warn(`[checkSendQuota] RPC error for ${instance}:`, error.message);
      return { allowed: false, reason: "rpc_error" };
    }
    return (data as SendQuotaResult) ?? { allowed: false, reason: "empty_response" };
  } catch (e: any) {
    console.warn(`[checkSendQuota] exception:`, e?.message);
    return { allowed: false, reason: "exception" };
  }
}

export async function registerSend(supabase: any, instance: string): Promise<void> {
  try {
    await supabase.rpc("register_send", { p_instance: instance });
  } catch (e: any) {
    console.warn(`[registerSend] failed:`, e?.message);
  }
}

/** Calcula duração de typing proporcional ao tamanho do texto (40ms/char). */
export function typingDurationMs(text: string): number {
  const len = (text || "").length;
  return Math.max(1200, Math.min(6000, len * 40));
}

/** Envia presence "composing" antes do sendText (humaniza). Best-effort. */
export async function simulateTyping(opts: {
  baseUrl: string;
  apiKey: string;
  instance: string;
  remoteJid: string;
  durationMs: number;
}): Promise<void> {
  const base = opts.baseUrl.replace(/\/+$/, "");
  try {
    await fetch(`${base}/chat/sendPresence/${opts.instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: opts.apiKey },
      body: JSON.stringify({
        number: opts.remoteJid,
        presence: "composing",
        delay: opts.durationMs,
      }),
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, opts.durationMs));
  } catch {
    /* non-critical */
  }
}

/** Jitter aleatório (700-2200ms) entre mensagens sequenciais. */
export function humanJitterMs(): number {
  return 700 + Math.floor(Math.random() * 1500);
}
