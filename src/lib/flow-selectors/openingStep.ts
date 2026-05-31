// Feature: evolution-multiconsultor-pronto
//
// Modelo puro e testável da resolução de fluxo ativo (REQ 3) e da detecção
// da etapa de abertura (Critério de Aceitação 3.3).
//
// Espelha 1:1 a lógica determinística usada no `evolution-webhook` e no
// `whapi-webhook` (ver `supabase/functions/_shared/resolve-flow.ts`):
//   - resolução de fluxo: filtra por `is_active = true` e `variant`,
//     ordena por `created_at` ascendente e toma a primeira linha (≤ 1).
//   - etapa de abertura: dentre os steps ativos do fluxo resolvido, a
//     abertura é o primeiro step ativo ordenado por `position` ascendente.
//
// As funções são puras (sem I/O), determinísticas, nunca lançam e retornam
// no máximo um resultado — exatamente as garantias exigidas por REQ 3.

/** Linha mínima de `bot_flows` relevante para a seleção. */
export interface FlowRow {
  id: string;
  variant?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
}

/** Linha mínima de `bot_flow_steps` relevante para a abertura. */
export interface FlowStepRow {
  id: string;
  position: number;
  is_active?: boolean | null;
  step_key?: string | null;
  step_type?: string | null;
}

/**
 * Resolve, de forma determinística, no máximo UM fluxo ativo do conjunto,
 * filtrando pela variante do cliente.
 *
 * Regras (espelho do Whapi / `resolveFlowId`):
 *   - considera apenas fluxos com `is_active === true`;
 *   - considera apenas fluxos cuja `variant` casa com a variante do cliente
 *     (default `"A"` quando ausente, igual ao código do webhook);
 *   - dentre os que casam, escolhe o de menor `created_at` (ascendente);
 *   - retorna `null` se nenhum casar.
 *
 * Nunca lança e é invariante à ordem da entrada.
 */
export function selectActiveFlow<T extends FlowRow>(
  flows: readonly T[] | null | undefined,
  variant: string | null | undefined,
): T | null {
  if (!Array.isArray(flows) || flows.length === 0) return null;

  const wanted = String(variant || "A");
  const matching = flows.filter(
    (f) => !!f && f.is_active === true && String(f.variant ?? "A") === wanted,
  );
  if (matching.length === 0) return null;

  // Ordenação determinística por `created_at` ascendente. Comparação estável
  // por string (timestamps ISO comparam lexicograficamente na ordem temporal).
  const sorted = [...matching].sort((a, b) => {
    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    if (ca < cb) return -1;
    if (ca > cb) return 1;
    return 0;
  });

  return sorted[0] ?? null;
}

/**
 * Detecta a etapa de abertura de um fluxo resolvido (Critério 3.3).
 *
 * A abertura é o PRIMEIRO step ativo (`is_active === true`) ordenado por
 * `position` ascendente. Steps inativos são ignorados. Retorna `null` se
 * não houver nenhum step ativo.
 *
 * Nunca lança e é invariante à ordem da entrada.
 */
export function detectOpeningStep<T extends FlowStepRow>(
  steps: readonly T[] | null | undefined,
): T | null {
  if (!Array.isArray(steps) || steps.length === 0) return null;

  const active = steps.filter((s) => !!s && s.is_active === true);
  if (active.length === 0) return null;

  const sorted = [...active].sort(
    (a, b) => Number(a.position) - Number(b.position),
  );

  return sorted[0] ?? null;
}
