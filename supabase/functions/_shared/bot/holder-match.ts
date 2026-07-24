/**
 * Match titular conta × documento (puro).
 * Compartilhado Whapi ↔ Evolution — sem mudança de comportamento.
 */

export function normalizeHolderName(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similaridade Levenshtein normalizada 0..1 (após normalizeHolderName). */
export function nameLevSim(a: string, b: string): number {
  a = normalizeHolderName(a);
  b = normalizeHolderName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const dp: number[] = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
}

/**
 * Verifica se dois nomes (conta de luz × RG) representam a mesma pessoa.
 * Match se similaridade ≥ 0.85 ou se primeiro+último nome coincidem.
 */
export function checkHolderMatch(
  billName: string | null | undefined,
  docName: string | null | undefined,
): { match: boolean; similarity: number; reason: string } {
  const a = normalizeHolderName(String(billName || ""));
  const b = normalizeHolderName(String(docName || ""));
  if (!a || !b) return { match: true, similarity: 1, reason: "missing_one_side" };
  const sim = nameLevSim(a, b);
  const partsA = a.split(/\s+/);
  const partsB = b.split(/\s+/);
  const firstLastMatch = partsA[0] === partsB[0] && partsA[partsA.length - 1] === partsB[partsB.length - 1];
  const match = sim >= 0.85 || firstLastMatch;
  return { match, similarity: sim, reason: `sim=${sim.toFixed(2)} firstLast=${firstLastMatch}` };
}
