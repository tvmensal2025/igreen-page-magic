/**
 * Commit de outbound — "envio confirmado antes de gravar/avançar".
 *
 * Auditoria 2026-08 (Grupo A / Whapi): `sender.sendText` pode devolver
 * `false` sem lançar exceção — guard de pausa humana (`wrapSenderWithLivePauseGuard`),
 * destino WhatsApp inválido (`whapi_dest_unresolved`) ou erro HTTP do Whapi.
 * O webhook gravava a linha em `conversations` e persistia o novo
 * `conversation_step` mesmo assim, produzindo:
 *   - histórico com mensagem que o lead nunca recebeu;
 *   - lead avançado para uma etapa cuja pergunta nunca foi entregue (trava mudo).
 *
 * Estes helpers são puros para poderem ser testados sem tocar em rede/DB.
 */

/** Campos que representam "o bot falou / o lead avançou" neste turno. */
export const PROGRESS_FIELDS_ON_FAILED_SEND = [
  "conversation_step",
  "last_bot_reply_at",
  "last_bot_interaction_at",
  "followup_count",
] as const;

/**
 * `true` só quando o canal confirmou (ou pelo menos não negou) o envio.
 *
 * Conservador de propósito: senders legados devolvem tipos variados
 * (boolean, objeto do Whapi, `undefined`). Só tratamos como falha o que é
 * negação explícita — `false`, `{ ok:false }`, `{ sent:false }`,
 * `{ success:false }`, `{ error: ... }` — para não bloquear caminhos que
 * hoje funcionam.
 */
export function isSendConfirmed(result: unknown): boolean {
  if (result === false) return false;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.ok === false || r.sent === false || r.success === false) return false;
    if (r.error) return false;
  }
  return true;
}

/**
 * Remove do patch de `customers` tudo que só pode valer se a mensagem saiu.
 * Dados extraídos do lead (nome, e-mail, valor da conta…) são preservados —
 * eles continuam verdadeiros mesmo com o envio falhando.
 */
export function stripProgressUpdatesOnFailedSend<T extends Record<string, unknown>>(
  updates: T,
): T {
  const out: Record<string, unknown> = { ...updates };
  for (const field of PROGRESS_FIELDS_ON_FAILED_SEND) {
    delete out[field];
  }
  return out as T;
}

export type CommitOutboundTurnInput<U extends Record<string, unknown>> = {
  /** Patch de `customers` calculado pelo turno. */
  updates: U;
  /** Texto a enviar. Vazio/`null` = handler já enviou inline ou turno mudo. */
  reply: string | null;
  /** Reply idêntico já enviado há pouco: não reenviar, mas persistir estado. */
  isDuplicate?: boolean;
  send: (text: string) => Promise<unknown>;
  persistUpdates: (updates: U) => Promise<void>;
  recordHistory: (text: string) => Promise<void>;
  onSendFailure?: (error: unknown) => void;
};

export type CommitOutboundTurnResult = {
  sendAttempted: boolean;
  sendConfirmed: boolean;
  historyRecorded: boolean;
  progressStripped: boolean;
};

/**
 * Ordem canônica do turno: **enviar → persistir estado → gravar histórico**.
 *
 * Se o envio foi tentado e negado, o patch perde os campos de progresso e o
 * histórico não recebe a mensagem. Turnos sem texto (handler enviou inline)
 * e turnos duplicados seguem persistindo normalmente — comportamento igual
 * ao anterior.
 */
export async function commitOutboundTurn<U extends Record<string, unknown>>(
  input: CommitOutboundTurnInput<U>,
): Promise<CommitOutboundTurnResult> {
  const text = typeof input.reply === "string" ? input.reply : "";
  const shouldSend = text.trim().length > 0 && !input.isDuplicate;

  let sendAttempted = false;
  let sendConfirmed = true;
  if (shouldSend) {
    sendAttempted = true;
    try {
      sendConfirmed = isSendConfirmed(await input.send(text));
      if (!sendConfirmed) input.onSendFailure?.(null);
    } catch (error) {
      sendConfirmed = false;
      input.onSendFailure?.(error);
    }
  }

  const failed = sendAttempted && !sendConfirmed;
  const updates = failed ? stripProgressUpdatesOnFailedSend(input.updates) : input.updates;
  if (Object.keys(updates).length > 0) await input.persistUpdates(updates);

  let historyRecorded = false;
  if (sendAttempted && sendConfirmed) {
    await input.recordHistory(text);
    historyRecorded = true;
  }

  return { sendAttempted, sendConfirmed, historyRecorded, progressStripped: failed };
}
