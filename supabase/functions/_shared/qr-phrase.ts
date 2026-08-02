// qr-phrase (Deno) — frase PADRÃO e curta para o link/QR de parceiros.
//
// PARIDADE COM O FRONT
// --------------------
// Este módulo é o ESPELHO em Deno de `src/components/admin/parceiros/qrPhrase.ts`
// (front, Vite/TS). A lógica precisa ser idêntica nos dois lados porque:
//   • o FRONT usa para exibir/prever a frase no card do QR (`PartnerQrCode`);
//   • o RUNTIME (`qr-redirect`) usa para montar o `?text=` do `wa.me` quando o
//     lead abre o link curto `.../qr-redirect?l={licenca}&p={partnerId}`.
// Se um lado divergir, o consultor veria uma frase no painel e o lead receberia
// outra. Ao mexer aqui, replique no front (e vice-versa).
//
// MARCADOR DETERMINÍSTICO `#R{short_code}`
// ----------------------------------------
// A keyword no texto é ÚTIL mas FRÁGIL: leads editam a frase, removem trechos,
// digitam só "oi". Sem keyword no texto, o webhook não atribui o lead ao
// parceiro e o cashback vai para o consultor errado. Para tornar a atribuição
// DETERMINÍSTICA, anexamos um marcador curto `#R{short_code}` (numérico, único
// por consultor) ao final da mensagem. O webhook reconhece esse marcador ANTES
// de cair no `matchKeyword` (fallback). Quando o `shortCode` não é informado
// (parceiro legado sem backfill), o marcador é omitido e tudo continua como
// antes — só keyword.

/**
 * Teto ABSOLUTO da frase (só para manter a URL `wa.me` sã). A frase salva pelo
 * consultor NUNCA é descartada por tamanho — no pior caso é cortada aqui.
 */
export const QR_PHRASE_MAX = 600;

/** Teto usado só para montar a frase PADRÃO (quando não há frase salva). */
const QR_DEFAULT_PHRASE_MAX = 90;

/** Remove espaços duplicados e apara as pontas. */
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Igual à normalização do `keyword-matcher.ts`: sem acentos, pontuação vira
 * espaço, minúsculas. Usado para checar se a keyword já está na frase.
 */
function norm(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `true` quando a keyword aparece na frase (substring após normalização). */
export function containsKeyword(phrase: string, keyword: string): boolean {
  const k = norm(keyword);
  if (!k) return true; // sem keyword, nada a exigir
  return norm(phrase).includes(k);
}

/** Sanitiza o short_code para somente dígitos (3+); devolve "" se inválido. */
function tidyShortCode(code?: string | null): string {
  const digits = String(code ?? "").replace(/\D/g, "");
  return /^\d{3,}$/.test(digits) ? digits : "";
}

/** Anexa o marcador `#R{short_code}` ao final, se ainda não estiver na frase. */
function appendShortCodeMarker(phrase: string, shortCode: string): string {
  if (!shortCode) return phrase;
  // Marcador propositalmente curto e único — pouco provável colidir com texto natural.
  const marker = `#R${shortCode}`;
  if (new RegExp(`#?\\s*R\\s*${shortCode}\\b`, "i").test(phrase)) return phrase;
  return tidy(`${phrase} ${marker}`);
}

/**
 * Frase PADRÃO curta para um parceiro, sempre contendo a `keyword`.
 *
 * - Com keyword: `Oi! Quero saber mais sobre o desconto na energia. (indicação: {keyword})`
 * - Sem keyword: frase genérica curta.
 */
export function buildDefaultQrPhrase(keyword?: string | null): string {
  const kw = tidy(keyword ?? "");
  const base = "Oi! Quero saber mais sobre o desconto na energia.";
  if (!kw) return base;
  const withKw = tidy(`${base} (indicação: ${kw})`);
  if (withKw.length <= QR_DEFAULT_PHRASE_MAX) return withKw;
  // Keyword longa: encurta a base, mantém a keyword inteira (atribuição).
  const shortBase = "Oi! Quero o desconto na energia.";
  const short = tidy(`${shortBase} (indicação: ${kw})`);
  if (short.length <= QR_DEFAULT_PHRASE_MAX) return short;
  const minimal = tidy(`Oi! (indicação: ${kw})`);
  if (minimal.length <= QR_DEFAULT_PHRASE_MAX) return minimal;
  // Último recurso: cabe o máximo possível da keyword sem estourar o limite.
  const prefix = "Oi! (indicação: ";
  const budget = Math.max(0, QR_DEFAULT_PHRASE_MAX - prefix.length - 1);
  return tidy(`${prefix}${kw.slice(0, budget)})`);
}

/**
 * Resolve a mensagem final do link/QR a partir do que está salvo no parceiro.
 *
 *   1. Sem `qrPhrase`: usa a frase padrão curta, que já contém a keyword.
 *   2. Com frase própria: ela sempre vence e só é limitada ao teto absoluto.
 *   3. Se faltar a keyword e houver espaço, ela é anexada sem substituir o texto.
 *
 * Em qualquer caso, se `shortCode` for fornecido, anexa `#R{short_code}` ao
 * final — esse é o marcador determinístico que o webhook usa para atribuir o
 * lead ao parceiro mesmo quando a keyword falha. O marcador tem prioridade
 * sobre o limite estético: preferimos uma frase ~10 chars mais longa do que
 * perder atribuição.
 *
 * Nunca devolve string vazia: no pior caso, a frase genérica padrão.
 */
export function resolveQrMessage(
  qrPhrase: string | null | undefined,
  keyword: string | null | undefined,
  shortCode?: string | null,
): string {
  const kw = tidy(keyword ?? "");
  const custom = tidy(qrPhrase ?? "");
  const code = tidyShortCode(shortCode);

  let base: string;
  if (!custom) {
    base = buildDefaultQrPhrase(kw);
  } else {
    // REGRA: frase salva SEMPRE vence. Se passar do teto, corta (não troca).
    base = custom.length > QR_PHRASE_MAX
      ? tidy(custom.slice(0, QR_PHRASE_MAX))
      : custom;
    if (kw && !containsKeyword(base, kw)) {
      const withKw = tidy(`${base} (indicação: ${kw})`);
      if (withKw.length <= QR_PHRASE_MAX) base = withKw;
    }
  }

  return appendShortCodeMarker(base, code);
}


/**
 * Extrai `short_code` numérico de um marcador `#R{digits}` (ou `R{digits}`)
 * embutido no texto de uma mensagem. Tolerante a espaços e maiúsc/minúsc.
 * Devolve `null` quando não encontra. Usado pelo webhook ANTES de cair no
 * `matchKeyword` para atribuir o lead de forma determinística.
 */
export function extractShortCodeMarker(messageText: string): string | null {
  if (!messageText) return null;
  const m = messageText.match(/#?\s*R\s*(\d{3,})/i);
  return m ? m[1] : null;
}
