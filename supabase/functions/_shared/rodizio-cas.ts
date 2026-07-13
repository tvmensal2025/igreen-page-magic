/**
 * rodizio-cas.ts
 *
 * Compare-And-Swap para atribuir `referral_partner_id` em `customers` de
 * forma segura contra corridas.
 *
 * Contexto do problema (blindagem do rodízio — plano
 * "blindagem-do-rodizio-de-parceiros"):
 *   O webhook de entrada pode processar 2 mensagens do MESMO lead quase
 *   simultaneamente (o customer_lock não cobre o primeiro contato). Sem CAS,
 *   ambas as execuções chamavam `rodizio_next` e faziam UPDATE simples,
 *   consumindo 2 turnos da fila e notificando 2 parceiros diferentes.
 *
 * Com CAS: o UPDATE inclui `.is("referral_partner_id", null)`. Se o valor já
 * foi setado por outra execução concorrente, o UPDATE retorna 0 linhas e o
 * chamador **não** notifica nem consome turno.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CasResult {
  /** true = ESTA execução ganhou a corrida e efetivou a atribuição. */
  applied: boolean;
  /** true = OUTRA execução já tinha atribuído (raça detectada). */
  alreadyAssigned: boolean;
}

/**
 * Tenta atribuir `referral_partner_id = partnerId` a `customer_id` APENAS se
 * o campo estiver nulo. Se já estiver preenchido (raça), retorna
 * `alreadyAssigned: true` sem alterar nada.
 */
export async function casAssignPartner(
  supabase: SupabaseClient,
  customerId: string,
  partnerId: string,
): Promise<CasResult> {
  try {
    const { data, error } = await supabase
      .from("customers")
      .update({
        referral_partner_id: partnerId,
        referral_detected_at: new Date().toISOString(),
      })
      .eq("id", customerId)
      .is("referral_partner_id", null)
      .select("id")
      .maybeSingle();

    if (error) {
      console.warn("[rodizio-cas] update falhou:", error.message);
      return { applied: false, alreadyAssigned: false };
    }
    if (!data) {
      // 0 linhas afetadas = já tinha referral_partner_id
      return { applied: false, alreadyAssigned: true };
    }
    return { applied: true, alreadyAssigned: false };
  } catch (e) {
    console.warn("[rodizio-cas] exceção:", (e as Error).message);
    return { applied: false, alreadyAssigned: false };
  }
}

/**
 * Marca customer como precisando de revisão manual. Sempre grava o motivo
 * mais recente — se o mesmo lead entrou por múltiplos motivos (ex.: pool
 * vazia e depois erro de RPC), o admin vê a razão atual, não a antiga.
 */
export async function markManualReview(
  supabase: SupabaseClient,
  customerId: string,
  reason: string,
): Promise<void> {
  try {
    await supabase
      .from("customers")
      .update({
        needs_manual_review: true,
        manual_review_reason: reason,
        manual_review_at: new Date().toISOString(),
      })
      .eq("id", customerId);
  } catch (e) {
    console.warn("[markManualReview] falhou:", (e as Error).message);
  }
}

/**
 * Registra em `campaign_match_log` o resultado do rodízio para monitoramento.
 * `outcome` = assigned | already_assigned | pool_empty | rpc_error |
 * no_campaign_manual_review | cas_error
 */
export async function logRodizioOutcome(
  supabase: SupabaseClient,
  params: {
    customerId: string;
    campaignId: string | null;
    method: string;
    outcome:
      | "assigned"
      | "already_assigned"
      | "pool_empty"
      | "rpc_error"
      | "no_campaign_manual_review"
      | "cas_error";
    messageSample?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from("campaign_match_log").insert({
      customer_id: params.customerId,
      campaign_id: params.campaignId,
      method: params.method,
      rodizio_outcome: params.outcome,
      message_sample: params.messageSample ? String(params.messageSample).slice(0, 200) : null,
    });
  } catch (e) {
    console.warn("[logRodizioOutcome] insert falhou:", (e as Error).message);
  }
}
