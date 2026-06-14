// =============================================================================
// Orçamento — API pública (lado destinatário)
// =============================================================================
// A página pública /proposta/:token NÃO acessa o banco direto. Toda leitura e
// resposta passa pelas edge functions (proposal-public-get / proposal-respond),
// que usam service_role e identificam a proposta só pelo public_token.
// =============================================================================

import { supabase } from "@/integrations/supabase/client";
import type { PublicProposalView } from "./types";

/** Busca os dados de exibição de uma proposta pelo token público. */
export async function getPublicProposal(token: string): Promise<PublicProposalView> {
  const { data, error } = await supabase.functions.invoke("proposal-public-get", {
    body: { token },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as PublicProposalView;
}

export type RespondAction = "accept" | "reject" | "counter";

export interface RespondInput {
  token: string;
  action: RespondAction;
  note?: string | null;
  /** Contraproposta: URL do anexo já enviado e valor proposto pelo cliente. */
  attachmentUrl?: string | null;
  counterAmount?: number | null;
}

/** Registra a resposta do destinatário (aceitar / recusar / contrapor). */
export async function respondToProposal(
  input: RespondInput,
): Promise<{ ok: boolean; status: string }> {
  const { data, error } = await supabase.functions.invoke("proposal-respond", {
    body: {
      token: input.token,
      action: input.action,
      note: input.note ?? null,
      attachment_url: input.attachmentUrl ?? null,
      counter_amount: input.counterAmount ?? null,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { ok: boolean; status: string };
}
