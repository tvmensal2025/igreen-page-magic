/**
 * Property tests para o seletor de fluxo ativo (Task 2.2 do spec
 * `evolution-multiconsultor-pronto`).
 *
 * // Feature: evolution-multiconsultor-pronto, Property 2: Resolução de fluxo
 * // é determinística, única e nunca lança.
 *
 * **Property 2: Resolução de fluxo é determinística, única e nunca lança**
 * **Validates: Requirements 3.1, 3.2, 3.4**
 *
 * Para qualquer conjunto de fluxos ativos de um consultor (0, 1 ou N, em
 * quaisquer variantes e ordens de `created_at`) e qualquer variante do cliente,
 * o seletor de fluxo ativo:
 *   - retorna NO MÁXIMO um fluxo (ou null);
 *   - NUNCA lança (para 0/1/N fluxos);
 *   - é INVARIANTE À PERMUTAÇÃO da entrada;
 *   - seleciona o fluxo de MENOR `created_at` dentre os que casam com a
 *     variante do cliente;
 *   - COINCIDE com o seletor de referência do whapi-webhook (model-based).
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import {
  selectActiveFlow,
  referenceSelectActiveFlow,
  resolveVariant,
  type BotFlowRow,
} from "./flow-selector";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

// Pequeno conjunto de variantes para forçar colisões/casamentos frequentes.
// Inclui "A" (padrão), "B" e "D" (padrão de negócio pretendido) + ruído.
const VARIANTS = ["A", "B", "D", "C", ""] as const;

// `created_at` como número de epoch num intervalo estreito, para FORÇAR empates
// frequentes e exercitar o desempate determinístico (invariância à permutação).
const arbCreatedAt = fc.integer({ min: 0, max: 5 });

/** Um fluxo com `id` único garantido pelo índice no array gerado. */
function arbFlows() {
  return fc
    .array(
      fc.record({
        is_active: fc.boolean(),
        variant: fc.constantFrom(...VARIANTS),
        created_at: arbCreatedAt,
      }),
      { minLength: 0, maxLength: 12 },
    )
    .map((rows) =>
      rows.map(
        (r, i): BotFlowRow => ({
          id: `flow-${i}`,
          consultant_id: "consultant-1",
          is_active: r.is_active,
          variant: r.variant,
          created_at: r.created_at,
        }),
      ),
    );
}

const arbCustomerVariant = fc.oneof(
  fc.constantFrom(...VARIANTS),
  fc.constant(undefined as unknown as string),
  fc.constant(null as unknown as string),
);

/** Embaralhamento determinístico guiado por uma permutação fast-check. */
function permute<T>(arr: readonly T[], order: number[]): T[] {
  // `order` é uma permutação de índices [0..n). Reordena `arr` por ela.
  return order.map((idx) => arr[idx]);
}

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe("Property 2 — seletor de fluxo determinístico, único e total", () => {
  test.prop([arbFlows(), arbCustomerVariant], { numRuns: 300 })(
    "retorna ≤1 fluxo (ou null) e nunca lança para 0/1/N fluxos",
    (flows, variant) => {
      const result = selectActiveFlow(flows, variant);
      // ≤1: o retorno é um único fluxo ou null (não há "multiple rows").
      expect(result === null || typeof result.id === "string").toBe(true);
      // Se retornou algo, é um dos fluxos de entrada.
      if (result !== null) {
        expect(flows.some((f) => f.id === result.id)).toBe(true);
      }
    },
  );

  test.prop([arbFlows(), arbCustomerVariant], { numRuns: 300 })(
    "só retorna fluxo ativo da variante do cliente (ou null)",
    (flows, variant) => {
      const v = resolveVariant(variant);
      const result = selectActiveFlow(flows, variant);
      if (result !== null) {
        expect(result.is_active).toBe(true);
        expect(result.variant).toBe(v);
      } else {
        // null ⇒ não existe nenhum fluxo ativo casando com a variante.
        expect(flows.some((f) => f.is_active && f.variant === v)).toBe(false);
      }
    },
  );

  test.prop([arbFlows(), arbCustomerVariant], { numRuns: 300 })(
    "seleciona o menor created_at dentre os fluxos da variante do cliente",
    (flows, variant) => {
      const v = resolveVariant(variant);
      const matching = flows.filter((f) => f.is_active && f.variant === v);
      const result = selectActiveFlow(flows, variant);

      if (matching.length === 0) {
        expect(result).toBeNull();
        return;
      }
      const minCreatedAt = matching.reduce(
        (m, f) => (f.created_at < m ? f.created_at : m),
        matching[0].created_at,
      );
      expect(result).not.toBeNull();
      expect(result!.created_at).toBe(minCreatedAt);
    },
  );

  test.prop(
    [
      arbFlows().chain((flows) =>
        fc.record({
          flows: fc.constant(flows),
          // permutação dos índices de `flows`
          order: fc.constant([...flows.keys()]).chain((ks) =>
            fc.shuffledSubarray(ks, { minLength: ks.length, maxLength: ks.length }),
          ),
          variant: arbCustomerVariant,
        }),
      ),
    ],
    { numRuns: 300 },
  )("é invariante à permutação da entrada", ({ flows, order, variant }) => {
    const original = selectActiveFlow(flows, variant);
    const shuffled = selectActiveFlow(permute(flows, order), variant);
    // Mesmo id selecionado independentemente da ordem do array de entrada.
    expect(shuffled?.id ?? null).toBe(original?.id ?? null);
  });

  test.prop([arbFlows(), arbCustomerVariant], { numRuns: 300 })(
    "coincide com o seletor de referência do whapi-webhook (model-based)",
    (flows, variant) => {
      const result = selectActiveFlow(flows, variant);
      const reference = referenceSelectActiveFlow(flows, variant);
      expect(result?.id ?? null).toBe(reference?.id ?? null);
    },
  );
});
