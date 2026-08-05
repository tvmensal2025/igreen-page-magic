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
export const QR_PHRASE_MAX = 600;

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
 *
 * ⚠️ Nenhuma variante pode casar com as frases-âncora de Click-to-WhatsApp do
 * Meta (`matchesMetaCtwaPhrase`, em `_shared/meta-ctwa-fallback.ts`). Enquanto
 * a frase padrão continha "quero saber mais", o webhook classificava o lead do
 * QR do parceiro como lead Meta e pulava a atribuição — o parceiro nunca
 * recebia o lead. Evitar: "quero saber mais", "pagar menos na conta de luz",
 * "conta de luz mais barata", "gostaria de saber mais".
 */
export function buildDefaultQrPhrase(keyword?: string | null): string {
  const kw = tidy(keyword ?? "");
  const base = "Oi! Quero garantir meu desconto na energia.";
  if (!kw) return base;
  const withKw = tidy(`Oi! Vim pelo ${kw} e quero garantir meu desconto na energia.`);
  if (withKw.length <= QR_DEFAULT_PHRASE_MAX) return withKw;
  // Keyword longa: encurta a base, mantém a keyword inteira (atribuição).
  const short = tidy(`Oi! Vim pelo ${kw}, quero meu desconto na energia.`);
  if (short.length <= QR_DEFAULT_PHRASE_MAX) return short;
  const minimal = tidy(`Oi! Vim pelo ${kw}.`);
  if (minimal.length <= QR_DEFAULT_PHRASE_MAX) return minimal;
  // Último recurso: cabe o máximo possível da keyword sem estourar o limite.
  const prefix = "Oi! Vim pelo ";
  const budget = Math.max(0, QR_DEFAULT_PHRASE_MAX - prefix.length - 1);
  return tidy(`${prefix}${kw.slice(0, budget)}`);
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
      const withKw = tidy(`${base} ${kw}`);
      if (withKw.length <= QR_PHRASE_MAX) base = withKw;
    }
  }

  // Atribuição por KEYWORD apenas (2026-08-03): o marcador `#R` não é mais
  // anexado ao texto. `shortCode` fica no contrato só por compatibilidade.
  void code;
  return base;
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
 * Palavras genéricas demais para servir de IDENTIFICADOR de parceiro.
 *
 * Critério: se um lead que NUNCA ouviu falar do parceiro pode digitar isso
 * naturalmente, não serve como keyword.
 *
 * Comparação é da keyword INTEIRA (não substring): "posto" é bloqueado, mas
 * "posto shell br 101" continua válido.
 *
 * ESPELHO CANÔNICO: `supabase/functions/_shared/keyword-matcher.ts`.
 * Travado por `__tests__/keywordBlocklistParity.test.ts` — editar os dois.
 *
 * Caso real que criou esta lista: o parceiro José cadastrou **"Zap"**. "Zap" é
 * como o brasileiro chama WhatsApp, então qualquer lead que escrevesse
 * "me chama no zap" viraria lead dele. A palavra não identificava — sorteava.
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

/** Tamanho mínimo útil — 1–2 caracteres casam em qualquer texto. */
export const KEYWORD_MIN_LENGTH = 3;

/**
 * `true` quando a keyword não pode identificar um parceiro: está na blocklist,
 * é curta demais, ou está vazia. Mesma régua do runtime (`keyword-matcher.ts`).
 */
export function isGenericKeyword(keyword: string): boolean {
  const n = norm(keyword);
  if (!n) return true;
  if (n.replace(/\s/g, "").length < KEYWORD_MIN_LENGTH) return true;
  return GENERIC_KEYWORD_BLOCKLIST.some((g) => norm(g) === n);
}

function tokens(input: string): string[] {
  return norm(input).split(/\s+/).filter(Boolean);
}

/** Sequência contígua e exata — mesma régua do `hasExactTokenSequence` do runtime. */
function hasSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((t, j) => haystack[i + j] === t)) return true;
  }
  return false;
}

/**
 * `true` quando a palavra é só um pedaço do nome do parceiro — prenome solto
 * ("Erica" em "Erica Pereira"), sobrenome solto, nome sem o meio.
 * ESPELHO de `supabase/functions/_shared/keyword-matcher.ts`.
 */
export function isPartOfPartnerName(keyword: string, nome: string | null | undefined): boolean {
  const kw = tokens(keyword);
  const nm = tokens(nome || "");
  if (kw.length === 0 || nm.length < 2) return false;
  if (kw.length >= nm.length) return false;
  return kw.every((t) => nm.includes(t));
}

/**
 * `true` quando a chave é um prenome que o cadastro não tem como completar:
 * o parceiro foi salvo só com "Daniel", então não existe nome inteiro para
 * usar. Aqui o sistema não inventa sobrenome — quem resolve é o consultor.
 */
export function isWeakNameKeyword(keyword: string, nome: string | null | undefined): boolean {
  const kw = tokens(keyword);
  if (kw.length !== 1) return false;
  const nm = tokens(nome || "");
  return nm.length <= 1 && nm.includes(kw[0]);
}

/**
 * Palavra que o runtime REALMENTE vai usar para atribuir o lead.
 *
 * Prenome solto vira o nome inteiro quando ele aparece na frase do QR — é o
 * que o lead envia ao escanear. Sem isso, "Erica" pegaria qualquer mensagem
 * com "erica" e "rafael" (parceiro) roubaria lead do consultor Rafael.
 */
export function resolveEffectiveKeyword(
  keyword: string,
  nome: string | null | undefined,
  qrPhrase: string | null | undefined,
): string {
  const nm = String(nome || "").trim();
  const nmTokens = tokens(nm);
  if (nmTokens.length < 2 || !isPartOfPartnerName(keyword, nm)) return keyword;
  const phraseTokens = tokens(qrPhrase || "");
  const nomeNaFrase = phraseTokens.length === 0 || hasSequence(phraseTokens, nmTokens);
  return nomeNaFrase ? nm : keyword;
}
