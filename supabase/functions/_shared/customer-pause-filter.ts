// Filtro canônico para "este customer pode receber outbound automático?"
// (Phase H Task 36 do whatsapp-flow-architecture-v3).
//
// Os 7 crons do projeto têm lógicas variantes para a mesma pergunta. Este
// módulo centraliza:
//   - Forma legada: customers.bot_paused = false AND assigned_human_id IS NULL
//   - Forma v3: customer_flow_state.status NOT IN ('paused_*','converted','lost')
//                AND status != opt_out
//
// Helper retorna ambas para o cron poder rodar em paralelo durante a janela
// de migração e logar discordâncias. Quando engine v3 estiver `'on'` global
// + 30 dias, os crons trocam para a forma v3 pura (Phase J Task 44).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface CustomerPauseStatus {
  /** Estado canônico v3 (NULL se não há linha em customer_flow_state). */
  v3Status: string | null;
  /** Estado legado (bot_paused booleano). */
  legacyPaused: boolean;
  /** Decisão final: pode disparar outbound automático? */
  canSend: boolean;
  /** Os dois caminhos discordam? Útil para logar divergências. */
  disagreement: boolean;
}

/**
 * Lê os dois caminhos para `customerId` e devolve estrutura canônica.
 * Nunca lança — em erro retorna `canSend=false` (defensivo).
 */
export async function checkCustomerCanSend(
  supabase: SupabaseClient,
  customerId: string,
): Promise<CustomerPauseStatus> {
  try {
    const { data, error } = await supabase
      .from("customers")
      .select(`
        bot_paused,
        bot_paused_until,
        assigned_human_id,
        do_not_contact,
        customer_flow_state ( status, pause_reason )
      `)
      .eq("id", customerId)
      .maybeSingle();

    if (error || !data) {
      return { v3Status: null, legacyPaused: true, canSend: false, disagreement: false };
    }

    const c = data as any;
    // Hard gate LGPD: nunca outbound automático se do_not_contact.
    if (c.do_not_contact) {
      return { v3Status: "lost", legacyPaused: true, canSend: false, disagreement: false };
    }

    const cfs = Array.isArray(c.customer_flow_state) ? c.customer_flow_state[0] : c.customer_flow_state;
    const v3Status: string | null = cfs?.status ?? null;
    const v3PauseReason: string | null = cfs?.pause_reason ?? null;
    const v3Forbidden = v3Status
      ? ["paused_manual", "paused_system", "converted", "lost"].includes(v3Status)
      : false;
    const v3OptOut = v3PauseReason === "opt_out";

    const legacyPaused = !!c.bot_paused
      || !!c.assigned_human_id
      || (c.bot_paused_until && new Date(c.bot_paused_until).getTime() > Date.now());

    const v3CanSend = !v3Forbidden && !v3OptOut;
    const legacyCanSend = !legacyPaused;
    // Decisão final: AMBOS precisam permitir. Mais conservador durante migração.
    const canSend = v3CanSend && legacyCanSend;
    const disagreement = v3CanSend !== legacyCanSend;

    return { v3Status, legacyPaused, canSend, disagreement };
  } catch (_e) {
    return { v3Status: null, legacyPaused: true, canSend: false, disagreement: false };
  }
}

/**
 * Cláusula WHERE canônica para usar em SELECTs em massa de customers.
 * Retorna string SQL para `query.or()` ou `query.filter()`.
 *
 * Forma legada (idêntica à dos crons existentes — substituir gradualmente):
 *   "bot_paused.eq.false,assigned_human_id.is.null"
 *
 * Crons que migrarem para customer_flow_state usam o EXISTS:
 *   NOT EXISTS (SELECT 1 FROM customer_flow_state cfs WHERE cfs.customer_id=c.id AND cfs.status IN ('paused_manual','paused_system','converted','lost') OR cfs.pause_reason = 'opt_out')
 *
 * Esta função apenas exporta o template — cada cron decide se aplica
 * (use feature flag por consultor para faseamento).
 */
export const LEGACY_CAN_SEND_FILTER = "bot_paused=false AND assigned_human_id IS NULL";

export const V3_CAN_SEND_FILTER = `
  NOT EXISTS (
    SELECT 1 FROM public.customer_flow_state cfs
     WHERE cfs.customer_id = customers.id
       AND (
         cfs.status IN ('paused_manual','paused_system','converted','lost')
         OR cfs.pause_reason = 'opt_out'
       )
  )
`.trim();
