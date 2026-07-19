// supabase/functions/_shared/keyword-matcher.ts
// Pure module — no I/O, no fetch, no Supabase imports.
// Responsible for text normalization, keyword matching, and link generation.
//
// REGRA DE OURO (atribuição de parceiro):
// Nunca chutar. Só atribui com match EXATO da keyword (tokens contíguos).
// Fuzzy/Levenshtein foi removido — causava falso positivo real:
// "Nilza" ≈ "nilma" (distância 1) → lead de teste ia pra parceira Nilma.

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

/** Tokens normalizados de uma mensagem/keyword. */
function tokensOf(normalized: string): string[] {
  return normalized.split(/\s+/).filter(Boolean);
}

/**
 * True quando `kwTokens` aparece como sequência contígua em `msgTokens`.
 * Ex.: ["indicacao", "nilma"] casa em "oi (indicacao: nilma) #r711377".
 * Não casa substring frouxa ("luiz" dentro de "luiza") nem typo ("nilza"≠"nilma").
 */
export function hasExactTokenSequence(msgTokens: string[], kwTokens: string[]): boolean {
  if (kwTokens.length === 0) return false;
  if (kwTokens.length === 1) return msgTokens.includes(kwTokens[0]);
  for (let i = 0; i <= msgTokens.length - kwTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < kwTokens.length; j++) {
      if (msgTokens[i + j] !== kwTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Checks if the normalized message text contains an EXACT keyword match.
 * Returns the best match (longest keyword) or null.
 *
 * Matching strategy (só o que é seguro para atribuir parceiro):
 *   1. Normaliza texto e keyword
 *   2. Exige sequência contígua de tokens idênticos (word-boundary)
 *   3. Em empate, prefere a keyword mais longa
 *
 * NÃO usa fuzzy/Levenshtein. Atribuição determinística preferida: `#R{short_code}`.
 */
export function matchKeyword(
  messageText: string,
  partners: PartnerKeywords[],
): KeywordMatchResult | null {
  const normalized = normalizeText(messageText);
  if (!normalized) return null;
  const msgTokens = tokensOf(normalized);

  let best: KeywordMatchResult | null = null;
  let bestLen = -1;

  for (const partner of partners) {
    for (const kw of partner.keywords) {
      const normKw = normalizeText(kw);
      if (!normKw) continue;
      const kwTokens = tokensOf(normKw);
      if (!hasExactTokenSequence(msgTokens, kwTokens)) continue;

      if (normKw.length > bestLen) {
        bestLen = normKw.length;
        best = { partnerId: partner.partnerId, keyword: kw, score: 1.0 };
      }
    }
  }

  return best;
}

/**
 * Gera o link de cadastro no portal.
 *
 * Regra: `id` é SEMPRE o ID iGreen do consultor dono/abonador.
 * Se o parceiro também tem ID iGreen ativo, ele vai separado em `cli`.
 * Nunca trocamos o `id` do dono pelo ID do parceiro.
 */
export function buildCadastroLink(
  consultantIgreenId: string,
  partnerCli: string | null,
): string {
  const cliNum = partnerCli ? Number(String(partnerCli).replace(/\D/g, "")) : 0;
  const ownerId = String(consultantIgreenId || "").replace(/\D/g, "");
  const url = new URL(BASE_URL);
  url.searchParams.set("id", ownerId);
  if (Number.isFinite(cliNum) && cliNum > 0 && String(cliNum) !== ownerId) {
    url.searchParams.set("cli", String(cliNum));
  }
  return url.toString();
}

/**
 * Standard Levenshtein distance (dynamic programming).
 * Mantido para utilidade/testes — NÃO usar em atribuição de parceiro.
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
