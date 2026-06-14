// Guarda de origem — módulo puro, sem efeitos colaterais (não lê env, não cria
// client). Isolado do index.ts para ser testável com `deno test` sem precisar
// de --allow-env. Regra de negócio central da separação lead × carteira.

/**
 * Clientes sincronizados do portal iGreen (customer_origin = 'igreen_sync') são
 * carteira validada (aprovado, reprovado, devolutiva). NÃO entram em temperatura
 * (lead_insights) nem no funil de leads (crm_deals). Só leads do WhatsApp
 * (whatsapp_lead / manual / null) são classificáveis.
 */
export function isLeadClassifiable(customerOrigin: string | null | undefined): boolean {
  return customerOrigin !== "igreen_sync";
}
