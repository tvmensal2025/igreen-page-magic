/**
 * Sender-Guard (Etapa 3 anti-ban):
 *
 * Embrulha um sender retornado por `createEvolutionSender` (ou compatível) e
 * aplica `checkSendQuota` + `registerSend` em CADA envio originado pelo bot
 * (sendText / sendMedia / sendButtons / sendAudio).
 *
 * Comportamento:
 *  - Se `check_send_quota` retornar `allowed=false` → o envio é PULADO e o
 *    método devolve `false`. Isso garante que qualquer handler que checa o
 *    retorno (`if (await sender.sendText(...))`) NÃO avance `conversation_step`.
 *  - Se o envio for executado e retornar `true` → registra com `register_send`
 *    para alimentar warmup/intervalo/recovery.
 *  - Falha fechada: erro de RPC bloqueia. É melhor o lead esperar 1min do
 *    que queimar o chip.
 *
 * Não toca em `downloadMedia` nem `sendPresence` (cosméticos / inbound).
 */

import { checkSendQuota, registerSend } from "./anti-ban.ts";

export interface GuardedSenderOpts {
  /** Cliente Supabase com acesso ao RPC `check_send_quota` / `register_send`. */
  supabase: any;
  /** Nome da instância (whatsapp_instances.instance_name). */
  instanceName: string;
  /** Log prefix opcional para debug. */
  label?: string;
}

type AnyFn = (...args: any[]) => any;

/**
 * Janela de "burst" por wrapper (per-invocation): após o primeiro envio
 * autorizado, permite que envios subsequentes do MESMO turno bypassem
 * `min_interval_not_elapsed` por até BURST_TTL_MS. Outras razões de bloqueio
 * (cap diário, recovery, fatal, warmup) continuam sendo respeitadas.
 *
 * Motivação: um passo do Flow Builder pode enviar áudio+vídeo+texto-com-botões
 * em sequência. O `min_interval` (8s no day 1) bloqueava a 2ª e 3ª mensagens
 * do MESMO turno, deixando o lead com mídia parcial e sem o texto/botões.
 */
const BURST_TTL_MS = 20_000;

function wrapSendFn(
  fn: AnyFn | undefined,
  opts: GuardedSenderOpts,
  kind: string,
  burstState: { until: number },
): AnyFn | undefined {
  if (typeof fn !== "function") return fn;
  return async (...args: any[]) => {
    const quota = await checkSendQuota(opts.supabase, opts.instanceName);
    if (!quota.allowed) {
      const isMinInterval = quota.reason === "min_interval_not_elapsed";
      const inBurst = Date.now() < burstState.until;
      if (isMinInterval && inBurst) {
        console.log(
          `⚡ [sender-guard] burst-bypass kind=${kind} instance=${opts.instanceName} ` +
          `(janela expira em ${Math.max(0, burstState.until - Date.now())}ms)`,
        );
        // segue para enviar — não retorna false
      } else {
        console.warn(
          `🚫 [sender-guard] bloqueado kind=${kind} instance=${opts.instanceName} reason=${quota.reason ?? "?"}` +
          (quota.next_allowed_at ? ` next=${quota.next_allowed_at}` : "") +
          (quota.until ? ` until=${quota.until}` : ""),
        );
        return false;
      }
    }
    let result: any = false;
    try {
      result = await fn(...args);
    } finally {
      const ok = result === true || (result && typeof result === "object" && result.ok === true);
      if (ok) {
        await registerSend(opts.supabase, opts.instanceName);
        burstState.until = Date.now() + BURST_TTL_MS;
      }
    }
    return result;
  };
}

/**
 * Embrulha um sender (objeto `{ sendText, sendMedia, sendButtons, ... }`)
 * para que toda chamada passe por `check_send_quota` + `register_send`.
 *
 * Métodos não-envio (`downloadMedia`, `sendPresence`, `sendTextDetailed`)
 * são preservados sem wrapping para não duplicar contagem (sendTextDetailed
 * é chamado internamente por sendText).
 */
export function wrapSenderWithGuard<T extends Record<string, any>>(
  sender: T,
  opts: GuardedSenderOpts,
): T {
  // Estado de burst compartilhado entre todos os métodos de envio do mesmo
  // wrapper. Como o wrapper é criado uma vez por invocação do webhook,
  // a janela cobre apenas o turno corrente.
  const burstState = { until: 0 };
  const wrapped: any = { ...sender };
  wrapped.sendText = wrapSendFn(sender.sendText, opts, "text", burstState);
  wrapped.sendMedia = wrapSendFn(sender.sendMedia, opts, "media", burstState);
  wrapped.sendButtons = wrapSendFn(sender.sendButtons, opts, "buttons", burstState);
  wrapped.sendAudio = wrapSendFn(sender.sendAudio, opts, "audio", burstState);
  // sendTextDetailed é chamado internamente por sendText → não embrulha
  // (caso contrário, contaríamos 2x).
  return wrapped as T;
}
