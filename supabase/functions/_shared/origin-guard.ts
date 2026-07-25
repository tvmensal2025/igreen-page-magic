/**
 * origin-guard.ts
 *
 * Regra de ouro do sistema iGreen:
 *
 *   "Cliente da carteira iGreen NUNCA recebe mensagem automática de lead.
 *    Só leads (vindos de anúncio/WhatsApp) e cadastros manuais recebem
 *    follow-up, reaquecimento, nudge e resgate da IA.
 *    Cliente da carteira só entra em pós-venda quando o consultor (ou admin)
 *    clica em 'Aprovado' — daí o ciclo 30/60/90/120 dias começa de forma
 *    explícita, não automática."
 *
 * Este módulo centraliza o filtro de `customer_origin` para que todos os
 * crons proativos (process-followups, bot-followup-checker, reactivation-cron,
 * bot-stuck-recovery, faq-reengagement-nudge, bot-loop-watchdog) usem
 * exatamente a mesma definição.
 *
 * Cadência A/B/C: use também `cliente-cadence-guard.ts` (`isClienteProibidoCadenciaABC`)
 * — cobre carteira + status aprovado/registered + pos_venda + andamento ativo.
 */

/** Origens consideradas "lead" — elegíveis para automação proativa. */
export const LEAD_ORIGINS = ["whatsapp_lead", "manual"] as const;

/** Origens que NUNCA podem ser tocadas por automação proativa. */
export const WALLET_ORIGINS = ["igreen_sync", "igreen_extension"] as const;

/**
 * Filtro PostgREST pronto para `.or(...)`.
 * Pega leads + cadastros manuais + registros antigos com origem nula.
 *
 *   query.or(LEAD_ORIGIN_FILTER)
 */
export const LEAD_ORIGIN_FILTER =
  `customer_origin.in.(${LEAD_ORIGINS.join(",")}),customer_origin.is.null`;

/** Confere se um `customer_origin` pode receber automação proativa. */
export function isLeadEligible(origin: string | null | undefined): boolean {
  if (!origin) return true; // registros antigos sem origem = tratados como lead
  return (LEAD_ORIGINS as readonly string[]).includes(origin);
}

/** Confere se é cliente da carteira (jamais recebe automação proativa). */
export function isWalletCustomer(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return (WALLET_ORIGINS as readonly string[]).includes(origin);
}
