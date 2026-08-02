// qrPhrase — frase PADRÃO e curta para o link/QR de parceiros indicadores.
//
// PROBLEMA QUE RESOLVE
// --------------------
// O link `wa.me` do parceiro carrega a mensagem inteira no `?text=`, codificada
// (`encodeURIComponent`). Frases longas viram URLs gigantes. Resolvemos com uma
// frase PADRÃO curta + um MARCADOR determinístico `#R{short_code}` no final
// para garantir a atribuição mesmo quando a keyword falha (ver explicação no
// espelho Deno: `supabase/functions/_shared/qr-phrase.ts`).
//
// REGRA DE OURO: keyword permanece na frase (compatibilidade com o fallback
// `matchKeyword` do webhook) E, quando há `shortCode`, o marcador `#R{code}`
// é anexado para atribuição determinística.

/**
 * Teto ABSOLUTO da frase (só para manter a URL `wa.me` sã). A frase salva pelo
 * consultor NUNCA é descartada por tamanho — no pior caso é cortada aqui.
 */
export const QR_PHRASE_MAX = 300;

/** Teto usado só para montar a frase PADRÃO (quando não há frase salva). */
const QR_DEFAULT_PHRASE_MAX = 90;

/** Remove espaços duplicados e apara as pontas. */
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Sanitiza o short_code para somente dígitos (3+); devolve "" se inválido. */
function tidyShortCode(code?: string | null): string {
  const digits = String(code ?? "").replace(/\D/g, "");
  return /^\d{3,}$/.test(digits) ? digits : "";
}

/** Anexa o marcador `#R{short_code}` ao final, se ainda não estiver na frase. */
function appendShortCodeMarker(phrase: string, shortCode: string): string {
  if (!shortCode) return phrase;
  const marker = `#R${shortCode}`;
  if (new RegExp(`#?\\s*R\\s*${shortCode}\\b`, "i").test(phrase)) return phrase;
  return tidy(`${phrase} ${marker}`);
}

/**
 * Frase PADRÃO curta para um parceiro, sempre contendo a `keyword`.
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
 * Resolve a mensagem final do link/QR. Ver doc completa no espelho Deno.
 * Quando `shortCode` é informado, anexa `#R{code}` ao final — marcador
 * determinístico que o webhook usa para atribuir o lead.
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
 * Mesma normalização do `keyword-matcher.ts` do runtime.
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
  if (!k) return true;
  return norm(phrase).includes(k);
}

/**
 * Lista pequena de keywords genéricas demais para servir de marcador único.
 * São palavras que aparecem com frequência em texto natural de leads e que,
 * se usadas como keyword, atribuiriam o lead errado. Bloqueamos no form do
 * parceiro. NÃO é uma lista exaustiva — só os casos óbvios.
 */
export const GENERIC_KEYWORD_BLOCKLIST = [
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
  "promocao",
  "promoção",
  "oferta",
  "indicacao",
  "indicação",
  "oi",
  "ola",
  "olá",
  "bom dia",
  "boa tarde",
  "boa noite",
];

/** `true` quando a keyword está na blocklist (genérica/colidente). */
export function isGenericKeyword(keyword: string): boolean {
  const n = norm(keyword);
  if (!n) return false;
  return GENERIC_KEYWORD_BLOCKLIST.some((g) => norm(g) === n);
}
