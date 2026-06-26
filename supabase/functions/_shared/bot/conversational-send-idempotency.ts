// Wrapper de envio com idempotência para o caminho CONVERSACIONAL
// (Cérebro / Fluxo B IA). Resolve o bug reincidente: leads que mandam a
// MESMA mensagem várias vezes em poucos segundos (ex.: "Golpe Golpe Golpe")
// recebiam a MESMA resposta repetida 3-4×, porque o `enviarTexto` usado
// pelo Cérebro chamava `sender.sendText(jid, text)` cru — sem passar o
// contexto de idempotência, então o `outbound_message_log` (que dedupa por
// `(customerId, step, content, minute_bucket)`) ficava bypassado.
//
// Esse wrapper monta a chave determinística e passa ao sender. Resultado:
// dois envios IDÊNTICOS para o mesmo customer no mesmo step e dentro do
// mesmo minuto = a 2ª chamada vê o slot ocupado e NÃO envia. O fluxo do
// Cérebro continua "respondendo" normalmente (a função devolve `true`),
// mas o WhatsApp do lead recebe apenas a 1ª.
//
// Fail-open por design: se o cálculo da chave ou o INSERT falharem, a
// mensagem ainda é enviada (melhor duplicar 1× do que silenciar o lead).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeIdempotencyKey } from "../idempotency.ts";

export interface ConversationalSendCtx {
  supabase: SupabaseClient;
  customerId: string;
  consultantId: string;
  /** `conversation_step` antes do turno (mesma régua do bot-flow legado). */
  step: string;
}

export type SenderSendText = (
  jid: string,
  text: string,
  opts?: { idempotency?: any },
) => Promise<boolean>;

/**
 * Devolve uma função `enviarTexto(text)` que aplica idempotência ao usar o
 * sender real do canal. Use no `runConversacionalTurn` dos webhooks
 * (whapi e evolution) — substitui o `(texto) => sender.sendText(jid, texto)`
 * cru pelo equivalente protegido contra duplicatas em rajada.
 */
export function makeIdempotentEnviarTexto(
  sendText: SenderSendText,
  jid: string,
  ctx: ConversationalSendCtx,
): (text: string) => Promise<boolean> {
  return async (text: string) => {
    try {
      const content = (text ?? "").slice(0, 500);
      const idempotencyKey = await computeIdempotencyKey({
        customerId: ctx.customerId,
        step: ctx.step || "",
        content,
      });
      return await sendText(jid, text, {
        idempotency: {
          supabase: ctx.supabase,
          idempotencyKey,
          customerId: ctx.customerId,
          consultantId: ctx.consultantId,
          payloadHash: content,
        },
      });
    } catch (e) {
      console.warn(
        "[conversational-send] idempotência falhou, enviando direto:",
        (e as Error)?.message,
      );
      return await sendText(jid, text);
    }
  };
}
