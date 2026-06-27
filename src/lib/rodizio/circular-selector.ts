/**
 * Seletor circular puro do rodízio de leads de anúncio.
 *
 * Espelha, em TypeScript puro, a lógica da função SQL `rodizio_next`
 * (ver `.kiro/specs/rodizio-leads-anuncio/design.md` → "Função SQL rodizio_next
 * adaptada"). A `rodizio_next` avança o `counter` da pool de forma atômica
 * (`UPDATE ... RETURNING`) e deriva a posição do membro da vez a partir do novo
 * valor do contador:
 *
 *   v_idx := (v_counter - 1) % v_len;
 *
 * Aqui isolamos essa regra numa função pura `(counter, len) -> position`, de
 * baixo custo, para validar as propriedades de correção do rodízio (ordem
 * circular e distribuição justa) com centenas de iterações de testes baseados
 * em propriedade, sem depender do Postgres.
 */

/**
 * Calcula a posição (0-based) do membro da vez a partir do valor do contador da
 * pool JÁ incrementado (1-based, como o `counter` retornado pelo
 * `UPDATE ... RETURNING` da `rodizio_next`) e do número de membros `len`.
 *
 * Para a k-ésima chamada (counter = k, começando em 1), a posição é
 * `(k - 1) % len`, produzindo a ordem circular `0, 1, ..., len-1, 0, 1, ...`.
 *
 * @param counter Valor do contador da pool após o incremento (>= 1).
 * @param len Número de membros (participantes) da pool (>= 1).
 * @returns Posição 0-based do membro da vez (0 <= position < len).
 */
export function circularPosition(counter: number, len: number): number {
  if (!Number.isInteger(counter) || !Number.isInteger(len)) {
    throw new RangeError("counter e len devem ser inteiros");
  }
  if (len < 1) {
    throw new RangeError("len deve ser >= 1");
  }
  if (counter < 1) {
    throw new RangeError("counter deve ser >= 1");
  }
  return (counter - 1) % len;
}

/**
 * Simula `n` chamadas consecutivas do rodízio para uma pool com `len` membros,
 * partindo do contador em `startCounter` (estado inicial da pool; 0 = pool nova
 * recém-criada, cujo primeiro lead leva o contador a 1).
 *
 * Retorna o acumulador de `lead_count` por posição — exatamente o que a
 * `rodizio_next` incrementa em `rodizio_pool_members.lead_count` a cada lead.
 *
 * @param n Quantidade de chamadas/leads consecutivos (>= 0).
 * @param len Número de membros da pool (>= 1).
 * @param startCounter Valor inicial do contador da pool antes da 1ª chamada.
 * @returns Vetor de tamanho `len` com a contagem de leads recebidos por posição.
 */
export function accumulateLeadCounts(
  n: number,
  len: number,
  startCounter = 0,
): number[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError("n deve ser inteiro >= 0");
  }
  if (!Number.isInteger(len) || len < 1) {
    throw new RangeError("len deve ser inteiro >= 1");
  }
  if (!Number.isInteger(startCounter) || startCounter < 0) {
    throw new RangeError("startCounter deve ser inteiro >= 0");
  }

  const leadCounts = new Array<number>(len).fill(0);
  let counter = startCounter;
  for (let i = 0; i < n; i++) {
    counter += 1; // UPDATE ... set counter = counter + 1 RETURNING
    const position = circularPosition(counter, len);
    leadCounts[position] += 1;
  }
  return leadCounts;
}
