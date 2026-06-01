// format-reply — embeleza mensagens enviadas ao lead no WhatsApp.
//
// Problema que resolve: respostas da IA chegavam (1) cortadas no meio de uma
// frase por um `slice(280)` cego, (2) com espaçamento bagunçado, (3) sem
// capitalização no início e (4) sem destaque visual. Este módulo é puro e
// testável (sem I/O) e é aplicado na saída do `generateAiAnswer` e do RAG.
//
// Convenção de negrito do WhatsApp: *texto* (asteriscos simples).

/** Limite padrão de tamanho para respostas de IA no WhatsApp. */
export const DEFAULT_MAX_LEN = 600;

/**
 * Trunca um texto SEM cortar no meio de uma frase/palavra.
 *
 * Estratégia:
 *   1. Se já cabe no limite, retorna inalterado.
 *   2. Tenta cortar no fim da última frase completa (. ! ? …) antes do limite.
 *   3. Se não houver pontuação utilizável, corta no último espaço (palavra
 *      inteira) e adiciona reticências.
 */
export function truncateAtSentence(text: string, maxLen = DEFAULT_MAX_LEN): string {
  const t = (text ?? "").trim();
  if (t.length <= maxLen) return t;

  const slice = t.slice(0, maxLen);

  // (2) última fronteira de frase dentro do limite.
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf(".\n"),
    slice.lastIndexOf("!\n"),
    slice.lastIndexOf("?\n"),
  );
  // Aceita o corte por frase se ele preserva ao menos 40% do conteúdo
  // (evita cortar cedo demais quando a 1ª frase é minúscula).
  if (sentenceEnd >= maxLen * 0.4) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }

  // Também considera o caso de a frase terminar exatamente no limite.
  if (/[.!?…]$/.test(slice)) return slice.trim();

  // (3) corta no último espaço e adiciona reticências.
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return base.trim().replace(/[,;:\-\s]+$/, "") + "…";
}

/**
 * Normaliza o espaçamento:
 *   - remove espaços em fim de linha;
 *   - colapsa 3+ quebras de linha em no máximo 2 (parágrafo);
 *   - colapsa espaços duplicados;
 *   - trim geral.
 */
export function normalizeSpacing(text: string): string {
  return (text ?? "")
    .replace(/[ \t]+\n/g, "\n")      // espaço antes de quebra
    .replace(/\n{3,}/g, "\n\n")        // no máx. 1 linha em branco
    .replace(/[ \t]{2,}/g, " ")       // espaços duplos
    .replace(/\s+([,.!?])/g, "$1")    // espaço antes de pontuação
    .trim();
}

/**
 * Capitaliza a primeira letra de cada frase (início do texto e após . ! ?).
 * Preserva o restante das palavras (não mexe em siglas/nomes no meio).
 */
export function capitalizeSentences(text: string): string {
  if (!text) return text;
  // Início do texto.
  let out = text.replace(/^(\s*)([a-zà-ÿ])/u, (_m, sp, ch) => sp + ch.toUpperCase());
  // Após pontuação de fim de frase + espaço(s).
  out = out.replace(/([.!?]\s+)([a-zà-ÿ])/gu, (_m, p, ch) => p + ch.toUpperCase());
  // Após quebra de linha.
  out = out.replace(/(\n+\s*)([a-zà-ÿ])/gu, (_m, nl, ch) => nl + ch.toUpperCase());
  return out;
}

/**
 * Aplica *negrito* (estilo WhatsApp) em termos-chave da iGreen, uma vez cada,
 * sem aninhar negrito já existente. Mantém a mensagem com destaque visual sem
 * exagerar.
 */
const BOLD_TERMS: string[] = [
  "iGreen",
  "ANEEL",
  "CNPJ",
  "LGPD",
  "sem multa",
  "sem fidelidade",
  "sem custo",
  "gratuito",
  "desconto",
  "economia",
];

export function emphasizeKeyTerms(text: string): string {
  if (!text) return text;
  let out = text;
  for (const term of BOLD_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Casa a 1ª ocorrência como palavra inteira que NÃO já esteja entre *...*
    const rx = new RegExp(`(^|[^*\\wà-ÿ])(${escaped})(?![*\\wà-ÿ])`, "iu");
    let done = false;
    out = out.replace(rx, (m, pre, hit) => {
      if (done) return m;
      done = true;
      return `${pre}*${hit}*`;
    });
  }
  return out;
}

export interface FormatReplyOptions {
  maxLen?: number;
  /** Aplica negrito em termos-chave. Default true. */
  emphasize?: boolean;
}

/**
 * Pipeline completo de embelezamento para respostas de IA enviadas ao lead.
 * Ordem: normaliza espaços → trunca por frase → capitaliza → negrito.
 */
export function formatReply(text: string | null | undefined, opts: FormatReplyOptions = {}): string {
  const maxLen = opts.maxLen ?? DEFAULT_MAX_LEN;
  const emphasize = opts.emphasize ?? true;

  let out = normalizeSpacing(String(text ?? ""));
  if (!out) return "";
  out = truncateAtSentence(out, maxLen);
  out = capitalizeSentences(out);
  if (emphasize) out = emphasizeKeyTerms(out);
  return out;
}
