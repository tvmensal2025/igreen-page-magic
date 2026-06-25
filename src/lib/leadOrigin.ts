/**
 * leadOrigin.ts (client)
 *
 * Espelho client-side do `_shared/origin-guard.ts` das edge functions.
 * Garante que toda query do frontend que busca "leads elegíveis para
 * automação" use a mesma definição de origem que o backend.
 *
 * Regra: carteira iGreen (igreen_sync, igreen_extension) NUNCA recebe
 * automação proativa. Só leads (whatsapp_lead, manual) e registros antigos
 * sem origem (null) são elegíveis.
 */

export const LEAD_ORIGINS = ["whatsapp_lead", "manual"] as const;
export const WALLET_ORIGINS = ["igreen_sync", "igreen_extension"] as const;

/** Filtro PostgREST pronto para `.or(...)` no client supabase-js. */
export const LEAD_ORIGIN_FILTER =
  `customer_origin.in.(${LEAD_ORIGINS.join(",")}),customer_origin.is.null`;

export function isLeadEligible(origin: string | null | undefined): boolean {
  if (!origin) return true;
  return (LEAD_ORIGINS as readonly string[]).includes(origin);
}
