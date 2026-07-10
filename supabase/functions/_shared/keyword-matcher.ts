// supabase/functions/_shared/keyword-matcher.ts
// Pure module — no I/O, no fetch, no Supabase imports.
// Responsible for text normalization, fuzzy keyword matching, and link generation.

export interface KeywordMatchResult {
  partnerId: string;
  keyword: string;
  score: number;
}

export interface PartnerKeywords {
  partnerId: string;
  keywords: string[];
}

const BASE_URL = "https://digital.igreenenergy.com.br/";

/**
 * Normalizes text by removing accents, punctuation, and converting to lowercase.
 * Pure function, no side effects.
 *
 * Steps:
 *   1. NFD decompose
 *   2. Strip diacritics (U+0300–U+036F)
 *   3. Lowercase
 *   4. Punctuation → space
 *   5. Collapse whitespace
 *   6. Trim
 */
export function normalizeText(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if the normalized message text contains a keyword match.
 * Returns the first match found or null.
 *
 * Matching strategy:
 *   1. Exact substring match (after normalization)
 *   2. Levenshtein distance ≤ 1 for keywords with 5+ characters (word-level split)
 */
export function matchKeyword(
  messageText: string,
  partners: PartnerKeywords[],
): KeywordMatchResult | null {
  const normalized = normalizeText(messageText);
  if (!normalized) return null;

  for (const partner of partners) {
    for (const kw of partner.keywords) {
      const normKw = normalizeText(kw);
      if (!normKw) continue;

      // Exact substring match (post-normalization)
      if (normalized.includes(normKw)) {
        return { partnerId: partner.partnerId, keyword: kw, score: 1.0 };
      }

      // Fuzzy: split message into words, check Levenshtein ≤ 1 for keywords with 5+ chars
      if (normKw.length >= 5) {
        const words = normalized.split(/\s+/);
        for (const word of words) {
          if (levenshtein(word, normKw) <= 1) {
            return { partnerId: partner.partnerId, keyword: kw, score: 0.9 };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Gera o link de cadastro no portal.
 *
 * Regra (2026-07-09): se o parceiro tem `cli` ativo (>0), o cadastro é
 * PARA esse consultor — o `id` do link vira o próprio cli. Caso contrário,
 * usa o id do dono da instância (sem &cli=).
 */
export function buildCadastroLink(
  consultantIgreenId: string,
  partnerCli: string | null,
): string {
  const cliNum = partnerCli ? Number(String(partnerCli).replace(/\D/g, "")) : 0;
  const id = Number.isFinite(cliNum) && cliNum > 0
    ? String(cliNum)
    : String(consultantIgreenId || "");
  return `${BASE_URL}?id=${id}`;
}

/**
 * Standard Levenshtein distance (dynamic programming).
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
