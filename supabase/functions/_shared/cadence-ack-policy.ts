/**
 * Política de ACK do WhatsApp na cadência: o que fazer quando o efeito já
 * consta como enviado mas o comprovante de entrega ainda não chegou.
 *
 * Por que existe (auditoria 2026-08-05): o Whapi aceita o envio e às vezes
 * devolve o corpo SEM o id da mensagem. Sem id, o webhook de status não tem
 * como casar o ACK, então `delivery_status` fica "queued" para sempre. O motor
 * lia isso como "não entregue", reabria o efeito e mandava a MESMA mensagem de
 * novo a cada tick — a lead Miriam recebeu 5 cópias idênticas do COLD_1 em
 * 1h35 no dia 04/08, e 281 mensagens repetidas saíram em 30 dias.
 *
 * Regra: sem id não existe comprovante possível. Reenviar às cegas incomoda o
 * cliente e queima cota anti-ban, então tratamos como entregue e seguimos a
 * escada. Reenvio só quando o provedor confirmou falha de verdade.
 */

export type AckAction =
  /** ACK confirmado — segue a escada normalmente. */
  | "advance_acked"
  /** Ainda dentro da janela de espera — aguarda o webhook/reconciler. */
  | "wait"
  /** Provedor confirmou falha e ainda há tentativa disponível — reenvia. */
  | "reopen"
  /** Aceito sem id: entrega não verificável — segue a escada sem reenviar. */
  | "advance_unverifiable"
  /** Teto de tentativas atingido — fecha o efeito e segue a escada. */
  | "advance_max_attempts";

export interface AckPolicyInput {
  /** `conversations.delivery_status` do último envio deste estágio. */
  deliveryStatus: string | null;
  /** `conversations.external_message_id` — sem ele o ACK nunca casa. */
  externalMessageId: string | null;
  /** ACK positivo (sent/delivered/read/played) ou efeito já `delivered`. */
  acked: boolean;
  /** Passou de `RECONCILE_PENDING_STALE_MS` desde o envio. */
  stale: boolean;
  attempts: number;
  maxAttempts: number;
}

export function decideAckAction(input: AckPolicyInput): AckAction {
  if (input.acked) return "advance_acked";

  const failed = String(input.deliveryStatus || "").toLowerCase() === "failed";
  const noMoreAttempts = input.attempts >= input.maxAttempts;

  // Falha declarada pelo provedor: reenviar faz sentido (JID pode ter sido
  // corrigido) enquanto houver tentativa.
  if (failed) return noMoreAttempts ? "advance_max_attempts" : "reopen";

  if (!input.stale) return "wait";

  // Aceito, sem falha declarada e sem id: nenhum ACK vai chegar.
  const semId = !String(input.externalMessageId || "").trim();
  if (semId) return "advance_unverifiable";

  return noMoreAttempts ? "advance_max_attempts" : "reopen";
}
