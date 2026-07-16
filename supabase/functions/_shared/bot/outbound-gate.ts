/**
 * Gate compartilhado para outbound do bot (Evolution + Whapi).
 *
 * AUD-006 (parcial / órfão de propósito): monólitos bot-flow.ts ainda divergem
 * (~6k linhas cada). Este helper existe para novos envios proativos — NÃO está
 * wired nos monólitos (risco alto de regressão em produção). Não tratar como
 * "fix" completo até um PR dedicado plugar Evolution/Whapi bot-flow.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isBotGloballyEnabled } from "./global-flag.ts";
import { assertCanContact } from "../contact-suppression.ts";

export async function assertBotOutboundAllowed(
  supabase: SupabaseClient,
  input: {
    customerId?: string | null;
    phone?: string | null;
    consultantId?: string | null;
  },
): Promise<{ allowed: boolean; reason: string | null }> {
  const globalOn = await isBotGloballyEnabled(supabase);
  if (!globalOn) {
    return { allowed: false, reason: "bot_globally_disabled" };
  }
  const suppression = await assertCanContact(supabase, {
    customerId: input.customerId,
    phone: input.phone,
    consultantId: input.consultantId,
    channel: "whatsapp",
  });
  if (!suppression.allowed) {
    return { allowed: false, reason: suppression.reason };
  }
  return { allowed: true, reason: null };
}
