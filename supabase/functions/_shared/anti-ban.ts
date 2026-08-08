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
    const quota = (data as SendQuotaResult) ?? { allowed: false, reason: "empty_response" };

    // Se o hard-lock já foi limpo e a instância está conectada, sinais antigos
    // de disconnect_fatal não podem continuar bloqueando o envio para sempre.
    if (!quota.allowed && quota.reason === "fatal_disconnect_pending_confirmation") {
      try {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("status, manual_review_required, fatal_lock_until")
          .eq("instance_name", instance)
          .maybeSingle();
        const lockActive = !!inst?.manual_review_required ||
          (!!inst?.fatal_lock_until && new Date(inst.fatal_lock_until) > new Date());
        if (inst?.status === "connected" && !lockActive) {
          await supabase
            .from("instance_risk_signals")
            .delete()
            .eq("instance_name", instance)
            .eq("signal_type", "disconnect_fatal");
          const retry = await supabase.rpc("check_send_quota", { p_instance: instance });
          if (!retry.error && retry.data) return retry.data as SendQuotaResult;
        }
      } catch (e: any) {
        console.warn(`[checkSendQuota] stale fatal cleanup failed for ${instance}:`, e?.message);
      }
    }

    return quota;
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

/** Razões soft do check_send_quota quando o canal não tem linha em `whatsapp_instances`. */
const WHAPI_QUOTA_SOFT_BYPASS = new Set([
  "instance_not_found",
  "empty_response",
  "rpc_error",
]);

/**
 * Canais cujo chip vive fora de `whatsapp_instances`. Quando a linha existir
 * (ex.: cadastrar `wame-piloto`), `check_send_quota` volta a responder e o
 * anti-ban real passa a valer sozinho — o bypass só cobre a ausência.
 */
const QUOTA_SOFT_BYPASS_CHANNELS = new Set(["whapi", "wame"]);

const DEFAULT_QUOTA_WAIT_MS = 25_000;

export type AwaitOutboundQuotaOpts = {
  /** "whapi" | "evolution" | … — Whapi usa fila própria (`awaitWhapiSendSlot`). */
  channelKind?: string;
  /** Teto de espera no edge (não pode travar o tick). Default 25s. */
  maxWaitMs?: number;
};

export type AwaitOutboundQuotaResult = {
  allowed: boolean;
  reason?: string;
  waitedMs: number;
  /**
   * Intervalo mínimo ainda ativo após espera — caller deve reagendar em
   * segundos (não logar `failed` nem adiar 30 min). Caps duros / recovery
   * NÃO usam softDefer.
   */
  softDefer?: boolean;
  nextAllowedAt?: string | null;
  retryInMs?: number;
};

/** Calcula quanto esperar pelo próximo slot (next_allowed_at ou min_interval_ms). */
export function computeMinIntervalWaitMs(quota: SendQuotaResult): number {
  if (quota.next_allowed_at) {
    const t = new Date(quota.next_allowed_at).getTime() - Date.now();
    if (Number.isFinite(t)) return Math.max(0, Math.ceil(t));
  }
  const mi = Number(quota.min_interval_ms);
  if (Number.isFinite(mi) && mi > 0) return Math.ceil(mi);
  return 18_000;
}

/**
 * Quota outbound para motores (cadência etc.):
 * - Cap/recovery/fatal → bloqueia (allowed=false, softDefer=false).
 * - `min_interval_not_elapsed` → ESPERA o slot (até maxWaitMs) e envia;
 *   Whapi bypassa (throttle no send). Nunca tratar intervalo como "failed"
 *   de pessoa — evita 40 logs na mesma lead.
 */
export async function awaitOutboundSendQuota(
  supabase: any,
  instance: string,
  opts: AwaitOutboundQuotaOpts = {},
): Promise<AwaitOutboundQuotaResult> {
  const maxWaitMs = Math.max(0, opts.maxWaitMs ?? DEFAULT_QUOTA_WAIT_MS);
  const kind = String(opts.channelKind || "").toLowerCase();
  let waitedMs = 0;

  let quota = await checkSendQuota(supabase, instance);
  if (quota.allowed) return { allowed: true, waitedMs: 0 };

  if (
    QUOTA_SOFT_BYPASS_CHANNELS.has(kind) &&
    WHAPI_QUOTA_SOFT_BYPASS.has(String(quota.reason || ""))
  ) {
    return { allowed: true, waitedMs: 0 };
  }

  if (quota.reason === "min_interval_not_elapsed") {
    // Whapi: claim_whapi_send_slot já espaça — não falhar / não adiar 30 min.
    if (kind === "whapi") {
      return { allowed: true, waitedMs: 0 };
    }

    const need = computeMinIntervalWaitMs(quota);
    if (need <= maxWaitMs) {
      if (need > 0) {
        await new Promise((r) => setTimeout(r, need));
        waitedMs = need;
      }
      quota = await checkSendQuota(supabase, instance);
      if (quota.allowed) return { allowed: true, waitedMs };
      if (quota.reason === "min_interval_not_elapsed") {
        const retryInMs = Math.max(3_000, Math.min(computeMinIntervalWaitMs(quota), 60_000));
        return {
          allowed: false,
          reason: "min_interval_not_elapsed",
          waitedMs,
          softDefer: true,
          nextAllowedAt: quota.next_allowed_at ?? null,
          retryInMs,
        };
      }
    } else {
      const retryInMs = Math.max(3_000, Math.min(need, 60_000));
      return {
        allowed: false,
        reason: "min_interval_not_elapsed",
        waitedMs: 0,
        softDefer: true,
        nextAllowedAt: quota.next_allowed_at ?? null,
        retryInMs,
      };
    }
  }

  return {
    allowed: false,
    reason: quota.reason || "quota_blocked",
    waitedMs,
  };
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
