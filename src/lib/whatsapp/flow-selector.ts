// Feature: evolution-multiconsultor-pronto, Property 2: Resolução de fluxo é
// determinística, única e nunca lança.
//
// Modelo PURO e testável do seletor de fluxo ativo usado pelos webhooks.
//
// Espelha 1:1 a seleção inline aplicada no `evolution-webhook` (REQ 3, task 2.1)
// e no `whapi-webhook` (seletor de referência), que em SQL é:
//
//   const variant = (customer as any)?.flow_variant || "A";
//   supabase.from("bot_flows").select("id")
//     .eq("consultant_id", ...)
//     .eq("is_active", true)
//     .eq("variant", variant)
//     .order("created_at", { ascending: true })
//     .limit(1);
//   const activeFlow = activeFlows?.[0] || null;
//
// Aqui modelamos exatamente esse comportamento sobre um array em memória
// `flows[]` dado `(flows, variant)`: filtra por `is_active && variant`, ordena
// por `created_at` ascendente e toma o primeiro (ou null).
//
// Determinismo / invariância à permutação:
// A constraint parcial `uniq_bot_flows_active_per_consultant_variant`
// (UNIQUE (consultant_id, variant) WHERE is_active) garante, em produção, no
// máximo 1 fluxo ativo por (consultor, variante) — então `created_at` nunca
// empata para a mesma variante. Ainda assim, o modelo aplica um desempate
// determinístico por `id` para que o resultado seja estável sob qualquer
// permutação da entrada, mesmo na presença de `created_at` repetidos.

export interface BotFlowRow {
  id: string;
  consultant_id?: string | null;
  is_active: boolean;
  variant: string;
  // Supabase retorna `created_at` como string ISO 8601 (ordena
  // cronologicamente em comparação lexicográfica). Aceitamos `number`
  // (epoch) também, pois a comparação usa `<`/`>` para ambos.
  created_at: string | number;
}

/**
 * Resolve a variante efetiva do cliente, espelhando `customer.flow_variant || "A"`.
 * Qualquer valor "falsy" (`undefined`, `null`, `""`) recai na variante padrão "A".
 */
export function resolveVariant(variant: string | null | undefined): string {
  return variant || "A";
}

/**
 * `true` se `a` deve vir ANTES de `b` na ordenação `created_at` ascendente.
 * Empate em `created_at` é resolvido por `id` (ordem lexicográfica) para
 * garantir determinismo e invariância à permutação.
 */
function isEarlier(a: BotFlowRow, b: BotFlowRow): boolean {
  if (a.created_at < b.created_at) return true;
  if (a.created_at > b.created_at) return false;
  return a.id < b.id;
}

/**
 * Seletor sob teste (algoritmo via redução/single-pass).
 *
 * Filtra os fluxos ativos da variante do cliente e devolve o de menor
 * `created_at` (ou `null` quando nenhum casa). Retorna SEMPRE no máximo um
 * fluxo, NUNCA lança para 0/1/N fluxos, e é invariante à permutação da entrada.
 */
export function selectActiveFlow(
  flows: readonly BotFlowRow[] | null | undefined,
  variant: string | null | undefined,
): BotFlowRow | null {
  if (!Array.isArray(flows) || flows.length === 0) return null;
  const v = resolveVariant(variant);

  let best: BotFlowRow | null = null;
  for (const f of flows) {
    if (!f || f.is_active !== true || f.variant !== v) continue;
    if (best === null || isEarlier(f, best)) best = f;
  }
  return best;
}

/**
 * Seletor de REFERÊNCIA model-based, equivalente ao seletor inline do
 * `whapi-webhook`. Implementado por um algoritmo INDEPENDENTE (filter + sort +
 * head) para servir de oráculo no property test contra `selectActiveFlow`.
 */
export function referenceSelectActiveFlow(
  flows: readonly BotFlowRow[] | null | undefined,
  variant: string | null | undefined,
): BotFlowRow | null {
  const v = resolveVariant(variant);
  const matching = (Array.isArray(flows) ? flows : []).filter(
    (f) => !!f && f.is_active === true && f.variant === v,
  );
  if (matching.length === 0) return null;

  const sorted = [...matching].sort((a, b) => {
    if (a.created_at < b.created_at) return -1;
    if (a.created_at > b.created_at) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return sorted[0];
}
