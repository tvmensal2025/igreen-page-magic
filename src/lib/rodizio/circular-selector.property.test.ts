/**
 * Property tests do seletor circular puro do rodízio de leads de anúncio
 * (Tarefas 3.1 e 3.2 do spec `rodizio-leads-anuncio`).
 *
 * // Feature: rodizio-leads-anuncio, Property 1
 *
 * **Property 1: Ordem circular**
 * Para toda pool com P participantes (P >= 2) e qualquer sequência de N chamadas
 * consecutivas de `rodizio_next`, a sequência de posições retornadas é
 * `0, 1, ..., P-1, 0, 1, ...` (o índice da k-ésima chamada, começando em 0, é
 * `k mod P`), retornando ao primeiro participante após o último.
 *
 * **Validates: Requirements 9.2**
 *
 * // Feature: rodizio-leads-anuncio, Property 2
 *
 * **Property 2: Distribuição justa (desvio máximo 1)**
 * Para toda pool com P participantes e qualquer N de chamadas consecutivas, ao
 * final a diferença entre o participante que mais recebeu leads e o que menos
 * recebeu é no máximo 1; e a soma dos `lead_count` dos membros é igual a N.
 *
 * **Validates: Requirements 9.3, 10.1**
 */

import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { accumulateLeadCounts, circularPosition } from "./circular-selector";

// ---------------------------------------------------------------------------
// Property 1 — ordem circular
// ---------------------------------------------------------------------------

// P participantes do rodízio: exige >= 2 (Requisito 5). Cobrimos 2..20.
const arbLenP1 = fc.integer({ min: 2, max: 20 });
// N chamadas consecutivas: de 0 até várias voltas completas.
const arbNP1 = fc.integer({ min: 0, max: 200 });
// Contador inicial da pool: 0 (pool nova) ou já avançado — a ordem circular
// independe do ponto de partida, desde que medida a partir desse ponto.
const arbStartCounterP1 = fc.integer({ min: 0, max: 1000 });

/**
 * Espelha N chamadas consecutivas de `rodizio_next` a partir de `startCounter`,
 * devolvendo a sequência de posições (0-based) do membro da vez.
 */
function circularSequence(n: number, len: number, startCounter: number): number[] {
  const positions: number[] = [];
  let counter = startCounter;
  for (let i = 0; i < n; i++) {
    counter += 1; // UPDATE ... set counter = counter + 1 RETURNING
    positions.push(circularPosition(counter, len));
  }
  return positions;
}

describe("Property 1 — ordem circular do seletor de rodízio", () => {
  test.prop([arbNP1, arbLenP1, arbStartCounterP1], { numRuns: 200 })(
    "a k-ésima posição (0-based, a partir do contador inicial) é (startCounter + k + 1 - 1) mod P",
    (n, len, startCounter) => {
      const positions = circularSequence(n, len, startCounter);

      // O número de posições retornadas é igual ao número de chamadas.
      expect(positions.length).toBe(n);

      // Cada posição segue a ordem circular a partir do contador.
      for (let k = 0; k < positions.length; k++) {
        const expected = (startCounter + k) % len;
        expect(positions[k]).toBe(expected);
      }
    },
  );

  test.prop([arbLenP1], { numRuns: 200 })(
    "uma volta completa percorre 0,1,...,P-1 e retorna ao 0 (pool nova)",
    (len) => {
      // Pool nova (startCounter=0): P+1 chamadas devem percorrer toda a fila e
      // voltar ao primeiro participante (0) na (P+1)-ésima chamada.
      const positions = circularSequence(len + 1, len, 0);

      for (let i = 0; i < len; i++) {
        expect(positions[i]).toBe(i);
      }
      // Após o último participante, a fila volta ao primeiro (0).
      expect(positions[len]).toBe(0);
    },
  );

  test.prop([arbNP1, arbLenP1, arbStartCounterP1], { numRuns: 200 })(
    "posições consecutivas avançam de 1 em 1 de forma circular (sem pular)",
    (n, len, startCounter) => {
      const positions = circularSequence(n, len, startCounter);
      for (let k = 1; k < positions.length; k++) {
        // O próximo da fila é sempre (anterior + 1) mod P.
        expect(positions[k]).toBe((positions[k - 1] + 1) % len);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Property 2 — distribuição justa
// ---------------------------------------------------------------------------

// P participantes: o rodízio exige >= 2 (Requisito 5), mas a propriedade de
// distribuição justa vale para qualquer P >= 1. Cobrimos 1..20.
const arbLen = fc.integer({ min: 1, max: 20 });

// N chamadas consecutivas (leads): de 0 a algumas centenas, para varrer voltas
// completas e parciais da fila.
const arbN = fc.integer({ min: 0, max: 500 });

// Contador inicial da pool: 0 (pool nova) ou um valor já avançado, para garantir
// que a justiça independe do ponto de partida do contador.
const arbStartCounter = fc.integer({ min: 0, max: 1000 });

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe("Property 2 — distribuição justa do rodízio (desvio máximo 1)", () => {
  test.prop([arbN, arbLen, arbStartCounter], { numRuns: 300 })(
    "diferença entre quem mais e menos recebeu é <= 1, e soma = N",
    (n, len, startCounter) => {
      const leadCounts = accumulateLeadCounts(n, len, startCounter);

      // A soma das contagens é exatamente N (nenhum lead se perde ou duplica).
      const total = leadCounts.reduce((acc, c) => acc + c, 0);
      expect(total).toBe(n);

      // Desvio máximo 1: max - min <= 1 entre os membros.
      const max = Math.max(...leadCounts);
      const min = Math.min(...leadCounts);
      expect(max - min).toBeLessThanOrEqual(1);
    },
  );

  test.prop([arbN, arbLen, arbStartCounter], { numRuns: 100 })(
    "cada participante recebe floor(N/P) ou ceil(N/P) leads",
    (n, len, startCounter) => {
      const leadCounts = accumulateLeadCounts(n, len, startCounter);
      const base = Math.floor(n / len);
      // Quando o ponto de partida do contador (startCounter) não é múltiplo de
      // len, o "resto" da divisão se distribui a partir de uma posição deslocada,
      // mas cada membro continua recebendo base ou base+1 leads.
      for (const c of leadCounts) {
        expect(c === base || c === base + 1).toBe(true);
      }
    },
  );
});
