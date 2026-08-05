// supabase/functions/_shared/keyword-matcher.ts
// Pure module — no I/O, no fetch, no Supabase imports.
// Responsible for text normalization, keyword matching, and link generation.
//
// REGRA DE OURO (atribuição de parceiro):
// Nunca chutar. Só atribui com match EXATO da keyword (tokens contíguos).
// Fuzzy/Levenshtein foi removido — causava falso positivo real:
// "Nilza" ≈ "nilma" (distância 1) → lead de teste ia pra parceira Nilma.
//
// KEYWORD GENÉRICA NUNCA ATRIBUI (regressão real, parceiro José 2026-08-05)
// ------------------------------------------------------------------------
// O José cadastrou a keyword **"Zap"**. "Zap" é como o brasileiro chama
// WhatsApp: qualquer lead que escreva "me chama no zap" / "vi no zap" casaria
// com ele. Ou seja, a keyword não identifica ninguém — ela sorteia.
// A blocklist existia SÓ no front (`src/components/admin/parceiros/qrPhrase.ts`),
// então (a) "zap" não estava na lista e (b) nada era validado no runtime:
// keyword vinda de import/SQL/registro antigo passava direto.
// Agora a checagem vive AQUI, no ponto onde a atribuição realmente acontece —
// é a única trava que não depende de a UI ter validado antes.

export interface KeywordMatchResult {
  partnerId: string;
  keyword: string;
  score: number;
}

export interface PartnerKeywords {
  partnerId: string;
  keywords: string[];
}

/** Linha crua de `referral_partners` usada para derivar a keyword efetiva. */
export interface PartnerKeywordSource {
  partnerId: string;
  keywords?: string[] | null;
  nome?: string | null;
  qrPhrase?: string | null;
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
 * Palavras genéricas demais para servir de IDENTIFICADOR de parceiro.
 *
 * Critério: se um lead que NUNCA ouviu falar do parceiro pode digitar isso
 * naturalmente, não serve como keyword. Não é lista exaustiva — é o piso.
 *
 * A comparação é da keyword INTEIRA (não substring): "posto" é bloqueado, mas
 * "posto shell br 101" continua válido. Então dá para usar termo genérico
 * desde que qualificado.
 *
 * ESPELHO: `src/components/admin/parceiros/qrPhrase.ts` →
 * `GENERIC_KEYWORD_BLOCKLIST`. Travado por `keyword-blocklist-parity.test.ts`.
 */
export const GENERIC_KEYWORD_BLOCKLIST = [
  // ── WhatsApp / canal — o caso do José ──
  "zap",
  "zap zap",
  "zapzap",
  "whatsapp",
  "whats",
  "wpp",
  "watsapp",
  // ── produto / oferta ──
  "energia",
  "energy",
  "desconto",
  "luz",
  "solar",
  "igreen",
  "i green",
  "i-green",
  "conta",
  "boleto",
  "fatura",
  "promocao",
  "promoção",
  "oferta",
  "economia",
  "economizar",
  "kwh",
  "valor",
  "preco",
  "preço",
  // ── meta-palavras do próprio material ──
  "indicacao",
  "indicação",
  "banner",
  "cartaz",
  "panfleto",
  "qr",
  "qrcode",
  "qr code",
  "link",
  "numero",
  "número",
  "contato",
  "cadastro",
  "cliente",
  // ── lugar sem qualificação ──
  "loja",
  "mercado",
  "posto",
  "padaria",
  // ── saudação / resposta solta ──
  "oi",
  "ola",
  "olá",
  "bom dia",
  "boa tarde",
  "boa noite",
  "sim",
  "nao",
  "não",
  "quero",
  "ajuda",
  "informacao",
  "informação",
  "informacoes",
  "informações",
];

const GENERIC_SET = new Set(GENERIC_KEYWORD_BLOCKLIST.map((g) => normalizeText(g)));

/** Tamanho mínimo útil — 1–2 caracteres casam em qualquer texto. */
export const KEYWORD_MIN_LENGTH = 3;

/**
 * `true` quando a keyword não pode identificar um parceiro:
 * está na blocklist, é curta demais, ou está vazia.
 */
export function isGenericKeyword(keyword: string): boolean {
  const n = normalizeText(keyword);
  if (!n) return true;
  if (n.replace(/\s/g, "").length < KEYWORD_MIN_LENGTH) return true;
  return GENERIC_SET.has(n);
}

/**
 * Keywords inutilizáveis de uma lista de parceiros — para log/alerta e para a
 * UI avisar o consultor que o parceiro precisa trocar a palavra.
 */
export function findGenericKeywords(
  partners: PartnerKeywords[],
): Array<{ partnerId: string; keyword: string }> {
  const out: Array<{ partnerId: string; keyword: string }> = [];
  for (const p of partners || []) {
    for (const kw of p?.keywords || []) {
      if (isGenericKeyword(kw)) out.push({ partnerId: p.partnerId, keyword: kw });
    }
  }
  return out;
}

/** Frase curta demais não identifica ninguém — não serve de âncora. */
const PHRASE_MIN_TOKENS = 4;

/**
 * `true` quando a keyword é um pedaço do nome do parceiro — prenome solto
 * ("Erica" em "Erica Pereira"), sobrenome solto, nome sem o meio.
 * Comparação por token normalizado, então acento e caixa não contam.
 */
export function isPartOfPartnerName(keyword: string, nome: string | null | undefined): boolean {
  const kwTokens = tokensOf(normalizeText(keyword));
  const nomeTokens = tokensOf(normalizeText(nome || ""));
  if (kwTokens.length === 0 || nomeTokens.length < 2) return false;
  if (kwTokens.length >= nomeTokens.length) return false;
  return kwTokens.every((t) => nomeTokens.includes(t));
}

/**
 * `true` quando a chave depende de um nome que o parceiro não tem como
 * qualificar: um único token, sem sobrenome no cadastro ("Daniel", "Bruna").
 * A UI usa isso para pedir sobrenome ou local — o runtime não inventa nada.
 */
export function isWeakNameKeyword(keyword: string, nome: string | null | undefined): boolean {
  const kwTokens = tokensOf(normalizeText(keyword));
  if (kwTokens.length !== 1) return false;
  const nomeTokens = tokensOf(normalizeText(nome || ""));
  return nomeTokens.length <= 1 && nomeTokens.includes(kwTokens[0]);
}

/**
 * Keywords efetivas de um parceiro — o que o runtime usa para atribuir.
 *
 * NOME PODE SER A CHAVE, MAS TEM QUE SER O NOME INTEIRO
 * ----------------------------------------------------
 * O cadastro real salvava prenome solto: "rafael" (parceiro Rafael Ferreira
 * Dias — que é também o nome do CONSULTOR), "Erica", "abel", "Daniel". Um lead
 * escrevendo "o Rafael falou comigo" caía no parceiro errado. Prenome não
 * identifica: identifica o nome completo.
 *
 * Então, quando a keyword é um pedaço do nome do parceiro e o nome inteiro
 * aparece na frase do QR, a chave vira o NOME INTEIRO. Isso não é palpite — é
 * a mesma string que o lead vai enviar ao escanear.
 *
 * A frase do QR entra como chave extra (sequência longa e exata): quem mandou
 * a frase do parceiro é lead daquele parceiro, sem depender de palavra solta.
 * É o que cobre keyword genérica já gravada no banco ("Zap" do José) sem
 * chutar qualificador — a versão anterior deduzia a palavra vizinha na frase
 * ("Zap" → "loja zap"), e vizinho na frase é adivinhação.
 */
export function deriveEffectiveKeywords(partner: PartnerKeywordSource): PartnerKeywords {
  const raw = (partner.keywords || []).filter((k) => String(k || "").trim());
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (kw: string) => {
    const n = normalizeText(kw);
    if (!n || seen.has(n) || isGenericKeyword(kw)) return;
    seen.add(n);
    out.push(kw);
  };

  const nome = String(partner.nome || "");
  const phrase = String(partner.qrPhrase || "");
  const phraseTokens = tokensOf(normalizeText(phrase));
  const nomeTokens = tokensOf(normalizeText(nome));

  // Sem frase o material usa a frase padrão, que é montada com o nome inteiro.
  const nomeUsavel = nomeTokens.length >= 2 &&
    (phraseTokens.length === 0 || hasExactTokenSequence(phraseTokens, nomeTokens));

  for (const kw of raw) {
    if (nomeUsavel && isPartOfPartnerName(kw, nome)) push(nome);
    else push(kw);
  }

  if (out.length === 0 && nomeUsavel) push(nome);

  if (phraseTokens.length >= PHRASE_MIN_TOKENS) push(phrase);

  return { partnerId: partner.partnerId, keywords: out };
}

/** Aplica `deriveEffectiveKeywords` a uma lista, descartando quem ficou sem nada. */
export function deriveEffectiveKeywordList(
  partners: PartnerKeywordSource[],
): PartnerKeywords[] {
  return (partners || [])
    .map(deriveEffectiveKeywords)
    .filter((p) => p.keywords.length > 0);
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
 *   1. Descarta keyword genérica / curta demais (`isGenericKeyword`)
 *   2. Normaliza texto e keyword
 *   3. Exige sequência contígua de tokens idênticos (word-boundary)
 *   4. Prefere a keyword mais longa (a mais específica)
 *   5. Empate de tamanho entre parceiros DIFERENTES → não atribui a ninguém
 *
 * O passo 5 existe porque empate é sorteio: dois parceiros com a mesma palavra
 * (ou a mesma frase) dariam o lead para quem viesse primeiro na consulta.
 *
 * NÃO usa fuzzy/Levenshtein. Atribuição determinística preferida: `#R{short_code}`.
 *
 * O passo 1 é a trava que não depende da UI: keyword genérica já gravada no
 * banco (import, SQL, cadastro antigo — caso "Zap" do José) NUNCA atribui.
 * Use `allowGeneric: true` só em ferramenta de diagnóstico, nunca em produção.
 */
export function matchKeyword(
  messageText: string,
  partners: PartnerKeywords[],
  opts?: { allowGeneric?: boolean },
): KeywordMatchResult | null {
  const normalized = normalizeText(messageText);
  if (!normalized) return null;
  const msgTokens = tokensOf(normalized);
  const allowGeneric = opts?.allowGeneric === true;

  let best: KeywordMatchResult | null = null;
  let bestLen = -1;
  let tied = false;

  for (const partner of partners) {
    for (const kw of partner.keywords) {
      const normKw = normalizeText(kw);
      if (!normKw) continue;
      if (!allowGeneric && isGenericKeyword(kw)) continue;
      const kwTokens = tokensOf(normKw);
      if (!hasExactTokenSequence(msgTokens, kwTokens)) continue;

      if (normKw.length > bestLen) {
        bestLen = normKw.length;
        tied = false;
        best = { partnerId: partner.partnerId, keyword: kw, score: 1.0 };
      } else if (normKw.length === bestLen && best && best.partnerId !== partner.partnerId) {
        tied = true;
      }
    }
  }

  return tied ? null : best;
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
