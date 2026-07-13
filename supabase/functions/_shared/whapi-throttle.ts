// Whapi anti-ban — fila espaçadora de envios (paridade com regras Evolution).
//
// O Evolution espaça envios via `check_send_quota` (intervalo mínimo por
// instância + cap diário), mas RECUSA quando o limite bate. O canal Whapi
// (superadmin) tinha bypass total — um lote de 50 atendimentos disparava
// tudo em rajada. Este módulo aplica o mesmo espaçamento com semântica
// "nunca bloquear": o envio SEMPRE acontece, apenas espera o próprio slot.
//
// Como funciona:
//   1. `awaitWhapiSendSlot(jid)` chama a RPC `claim_whapi_send_slot`, que
//      reserva atomicamente o próximo slot livre do canal e devolve `wait_ms`.
//   2. O caller dorme `wait_ms` e envia. Concorrência enfileira em slots
//      consecutivos (contato diferente = 18s; mesmo contato = 1.5s).
//   3. Fail-open: se a RPC/env falhar, aplica jitter local curto e envia.
//      Proteger o número nunca pode silenciar um envio legítimo.
//
// Config por env (sem deploy de código para ajustar):
//   WHAPI_THROTTLE_ENABLED            default true  ("false"/"0"/"off" desliga)
//   WHAPI_GLOBAL_MIN_INTERVAL_MS      default 18000 (paridade Evolution dia 11+)
//   WHAPI_SAME_CONTACT_MIN_INTERVAL_MS default 1500
//   WHAPI_MAX_SLOT_WAIT_MS            default 25000 (teto de espera por envio —
//                                     edge function nunca trava; rajada extrema
//                                     degrada com elegância)
//   WHAPI_DAILY_SOFT_LIMIT            default 600 (só gera log de aviso; não recusa)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logStructured } from "./utils.ts";
import { shouldUseFastClock } from "./test-mode.ts";

// Aceita client do esm.sh OU do npm: (whapi-proxy) — tipos nominais diferem,
// runtime é o mesmo. Mesmo padrão `type SB = any` de attendance-channel-env.ts.
// deno-lint-ignore no-explicit-any
type SB = any;

export interface WhapiSlotResult {
  waitedMs: number;
  sentToday: number | null;
  /** "rpc" = fila global via banco; "local" = fallback fail-open; "skipped" = desligado/test-mode. */
  source: "rpc" | "local" | "skipped";
}

export interface AwaitWhapiSlotOpts {
  /** Default "whapi-superadmin" (Whapi não tem instâncias múltiplas hoje). */
  instanceName?: string;
  /** Client com service role. Quando omitido, cria singleton via env. */
  supabase?: SB | null;
  /**
   * "bulk" (default): disparo iniciado por nós → intervalo global de 18s.
   * "reply": resposta a inbound do cliente (conversa 1:1) → só o intervalo
   * curto de mesma conversa. Reservado para o webhook conversacional.
   */
  intent?: "bulk" | "reply";
  /** Rótulo para o log estruturado (ex.: "send_text"). */
  kind?: string;
}

function envRaw(name: string): string | undefined {
  try {
    return Deno.env.get(name) ?? undefined;
  } catch (_) {
    return undefined;
  }
}

function envInt(name: string, fallback: number): number {
  const n = Number(envRaw(name));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function isWhapiThrottleEnabled(): boolean {
  const raw = (envRaw("WHAPI_THROTTLE_ENABLED") ?? "true").toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

let cachedClient: SB | null = null;

function getClient(provided?: SB | null): SB | null {
  if (provided) return provided;
  if (cachedClient) return cachedClient;
  const url = envRaw("SUPABASE_URL");
  const key = envRaw("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  cachedClient = createClient(url, key);
  return cachedClient;
}

// Fallback local (memória do isolate) quando a RPC não está disponível.
// Não coordena entre isolates, mas evita rajada dentro do mesmo processo.
let localLastSendAt = 0;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Últimos 4 dígitos do telefone — evita PII completa no log. */
function jidSuffix(jid: string): string {
  const digits = String(jid || "").split("@")[0].replace(/\D/g, "");
  return digits.slice(-4);
}

/**
 * Reserva o próximo slot de envio do canal Whapi e AGUARDA até ele.
 * Nunca lança e nunca recusa o envio (fail-open + saturação no teto).
 */
export async function awaitWhapiSendSlot(
  jid: string,
  opts: AwaitWhapiSlotOpts = {},
): Promise<WhapiSlotResult> {
  if (!isWhapiThrottleEnabled()) return { waitedMs: 0, sentToday: null, source: "skipped" };
  // Simulador em cadência acelerada (fastClock) não espera fila.
  if (shouldUseFastClock()) return { waitedMs: 0, sentToday: null, source: "skipped" };

  const instanceName = opts.instanceName || "whapi-superadmin";
  const kind = opts.kind || "send";
  const sameContactMs = envInt("WHAPI_SAME_CONTACT_MIN_INTERVAL_MS", 1500);
  const globalMs = opts.intent === "reply"
    ? sameContactMs
    : envInt("WHAPI_GLOBAL_MIN_INTERVAL_MS", 18000);
  const maxWaitMs = envInt("WHAPI_MAX_SLOT_WAIT_MS", 25000);
  const dailySoftLimit = envInt("WHAPI_DAILY_SOFT_LIMIT", 600);

  const client = getClient(opts.supabase);
  // Sem env do Supabase = teste local/unitário (produção sempre injeta as envs).
  if (!client) return { waitedMs: 0, sentToday: null, source: "skipped" };

  try {
    const { data, error } = await client.rpc("claim_whapi_send_slot", {
      p_instance: instanceName,
      p_jid: jid,
      p_same_contact_ms: sameContactMs,
      p_global_ms: globalMs,
      p_max_wait_ms: maxWaitMs,
    });
    if (!error && data) {
      const waitMs = Math.max(0, Number((data as { wait_ms?: number }).wait_ms) || 0);
      const sentToday = Number((data as { sent_today?: number }).sent_today) || null;
      if (sentToday && dailySoftLimit > 0 && sentToday > dailySoftLimit) {
        logStructured("warn", "whapi_throttle_daily_high", {
          instance: instanceName,
          sent_today: sentToday,
          soft_limit: dailySoftLimit,
        });
      }
      if (waitMs > 0) {
        logStructured("info", "whapi_throttle_wait", {
          instance: instanceName,
          kind,
          wait_ms: waitMs,
          same_contact: !!(data as { same_contact?: boolean }).same_contact,
          jid_suffix: jidSuffix(jid),
        });
        await sleep(waitMs);
      }
      return { waitedMs: waitMs, sentToday, source: "rpc" };
    }
    logStructured("warn", "whapi_throttle_rpc_error", {
      instance: instanceName,
      kind,
      error: error?.message || "empty_response",
    });
  } catch (e) {
    logStructured("warn", "whapi_throttle_exception", {
      instance: instanceName,
      kind,
      error: (e as Error)?.message,
    });
  }

  // Fail-open: espaçamento local mínimo (jitter humano 700–2200ms) e segue.
  const now = Date.now();
  const jitter = 700 + Math.floor(Math.random() * 1500);
  const wait = Math.max(0, localLastSendAt + jitter - now);
  localLastSendAt = Math.max(now, localLastSendAt) + jitter;
  if (wait > 0) await sleep(wait);
  return { waitedMs: wait, sentToday: null, source: "local" };
}
