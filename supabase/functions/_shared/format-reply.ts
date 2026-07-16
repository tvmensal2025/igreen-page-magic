// format-reply — embeleza mensagens enviadas ao lead no WhatsApp.
//
// Problema que resolve: respostas da IA chegavam (1) cortadas no meio de uma
// frase por um `slice(280)` cego, (2) com espaçamento bagunçado, (3) sem
// capitalização no início e (4) sem destaque visual. Este módulo é puro e
// testável (sem I/O) e é aplicado na saída do `generateAiAnswer` e do RAG.
//
// Convenção de negrito do WhatsApp: *texto* (asteriscos simples).
//
// Precisão comercial: NÃO empurrar "quer cadastrar?" em toda resposta.
// FAQ responde a dúvida; o retorno ao fluxo fica nos botões do passo
// (reemit) ou num fechamento neutro — nunca pressão de cadastro.

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

/** Marcas/siglas que devem sair sempre na grafia canônica dentro do *negrito*. */
const CANONICAL_BOLD = new Set(["iGreen", "ANEEL", "CNPJ", "LGPD"]);

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
      const label = CANONICAL_BOLD.has(term) ? term : hit;
      return `${pre}*${label}*`;
    });
  }
  return out;
}

/**
 * Parágrafo inteiro que é só CTA agressivo / botão fantasma.
 */
const PUSHY_PARA_START =
  /^(?:👇\s*)?(?:Posso seguir com|Quer (?:que eu )?(?:já )?(?:comece|adiante|siga com)|Bora (?:deixar tudo pronto|cadastrar|ativar)|Faz sentido pra você seguir|Vamos seguir com (?:o )?seu cadastro|[ÉEe] s[oó] tocar|escolher uma das op)/iu;

/**
 * Frase final pushy no mesmo parágrafo (ex.: "... todo mês. Posso seguir com o seu cadastro para já darmos...?").
 * Cobre as variantes reais vistas em produção.
 */
const PUSHY_TRAILING_SENTENCE =
  /(?:^|(?<=[.!?…]))\s*(?:👇\s*)?(?:Posso seguir com[^.!?\n]{0,160}|Quer (?:que eu )?(?:já )?(?:comece|adiante|siga com)[^.!?\n]{0,100}|Bora (?:deixar tudo pronto|cadastrar|ativar)[^.!?\n]{0,80}|Faz sentido pra você seguir[^.!?\n]{0,80}|Vamos seguir com (?:o )?seu cadastro[^.!?\n]{0,80}|[ÉEe] s[oó] tocar[^.!?\n]{0,80}|escolher uma das op[cç][oõ]es[^.!?\n]{0,60})\?[^\S\n]*(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]*)?\s*$/iu;

/**
 * Remove CTAs agressivos de cadastro E CTAs fantasma de botão
 * ("clique nas opções acima" quando não há botão reemitido).
 */
export function stripPushyCadastroCta(text: string): string {
  const original = String(text || "").trim();
  if (!original) return "";
  let t = original;

  // 1) Remove parágrafos finais que são só CTA / botão fantasma.
  for (let i = 0; i < 4; i++) {
    const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paras.length < 2) break;
    const last = paras[paras.length - 1];
    if (
      PUSHY_PARA_START.test(last) ||
      /op[cç][oõ]es (?:acima|abaixo)/i.test(last) ||
      /^👇/.test(last)
    ) {
      t = paras.slice(0, -1).join("\n\n").trim();
      continue;
    }
    break;
  }

  // 2) Remove frase pushy colada no fim do último parágrafo.
  for (let i = 0; i < 3; i++) {
    const next = t.replace(PUSHY_TRAILING_SENTENCE, "").trim();
    if (next === t) break;
    t = next;
  }

  // Nunca silencia o lead: se a mensagem era SÓ o CTA, mantém o original.
  return t || original;
}

/**
 * Fechamento neutro — NÃO menciona botões/opções (podem não ter sido reemitidos).
 * O reemitStepButtons cuida do CTA clicável em mensagem separada.
 */
export const SOFT_FLOW_CLOSE =
  "Qualquer outra dúvida, é só perguntar.";

/**
 * True se o texto já fecha com pergunta / ponte de retorno (não precisa anexar).
 */
export function hasSoftClose(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/\?\s*$/.test(t)) return true;
  if (/qualquer outra d[uú]vida|quando quiser|ficou claro|posso esclarecer/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Quebra um bloco único (sem \n\n internos) em parágrafos por frase.
 */
function breakWallBlock(block: string): string {
  const t = block.trim();
  if (!t) return "";
  // Já tem quebras internas (lista / linhas curtas) → preserva
  if (t.includes("\n")) return t;
  // Curto: uma ideia só — não força quebra
  if (t.length < 120) return t;

  const parts = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (parts.length < 2) return t;

  // 1 frase por parágrafo quando o texto é médio/longo — mais ar, mais elegante
  const maxCharsPerPara = t.length > 280 ? 110 : 150;
  const paras: string[] = [];
  let buf = "";
  for (const p of parts) {
    const next = buf ? `${buf} ${p}` : p;
    if (buf && (next.length > maxCharsPerPara || buf.split(/(?<=[.!?])/).filter(Boolean).length >= 2)) {
      paras.push(buf.trim());
      buf = p;
    } else {
      buf = next;
    }
  }
  if (buf.trim()) paras.push(buf.trim());
  return paras.join("\n\n");
}

/**
 * Quebra "parede de texto" em parágrafos curtos e arejados para WhatsApp.
 * Não apaga conteúdo — só insere \n\n entre ideias.
 *
 * Importante: mesmo quando já existe um `\n\n` (ex.: soft-close / CTA),
 * ainda quebra paredes longas nos outros blocos — evita o bug em que
 * "textão + \n\n + CTA" passava sem arejar o textão.
 */
export function prettifyFaqLayout(text: string): string {
  let t = String(text || "").trim();
  if (!t) return "";

  // Separadores de lista já legíveis → preserva e só limpa espaços
  if (/^\s*[-•]/.test(t) || /\n\s*[-•]/.test(t)) {
    return normalizeSpacing(
      t
        .replace(/\n\s*[-•*]\s*/g, "\n• ")
        .replace(/^\s*[-*]\s*/gm, "• "),
    );
  }

  const blocks = t.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const pretty = blocks.map((b) => breakWallBlock(b));
  return normalizeSpacing(pretty.join("\n\n"));
}

export interface FormatReplyOptions {
  maxLen?: number;
  /** Aplica negrito em termos-chave. Default true. */
  emphasize?: boolean;
  /** Layout FAQ (parágrafos). Default false — ative nas respostas a dúvidas. */
  faqLayout?: boolean;
  /**
   * Remove CTAs agressivos de cadastro. Default: true quando faqLayout.
   * FAQ responde; botões do passo trazem o lead de volta.
   */
  stripCadastroPush?: boolean;
}

/**
 * Pipeline completo de embelezamento para respostas de IA enviadas ao lead.
 * Ordem: remove pressão de cadastro → layout FAQ → normaliza → trunca → capitaliza → negrito.
 */
export function formatReply(text: string | null | undefined, opts: FormatReplyOptions = {}): string {
  const maxLen = opts.maxLen ?? DEFAULT_MAX_LEN;
  const emphasize = opts.emphasize ?? true;
  const stripPush = opts.stripCadastroPush ?? !!opts.faqLayout;

  let out = String(text ?? "");
  if (stripPush) out = stripPushyCadastroCta(out);
  if (opts.faqLayout) out = prettifyFaqLayout(out);
  out = normalizeSpacing(out);
  if (!out) return "";
  out = truncateAtSentence(out, maxLen);
  out = capitalizeSentences(out);
  if (emphasize) out = emphasizeKeyTerms(out);
  return out;
}

/**
 * Atalho para respostas de dúvida/FAQ (match QA + IA).
 * Layout arejado, sem empurrão de cadastro.
 */
export function formatFaqReply(text: string | null | undefined): string {
  return formatReply(text, {
    maxLen: 900,
    emphasize: true,
    faqLayout: true,
    stripCadastroPush: true,
  });
}

/**
 * Anexa fechamento neutro de retorno ao fluxo — só se a resposta ainda
 * não tiver pergunta/ponte. Nunca pede cadastro.
 */
export function withSoftFlowClose(text: string): string {
  const base = stripPushyCadastroCta(String(text || "").trim());
  if (!base) return "";
  if (hasSoftClose(base)) return base;
  return `${base}\n\n${SOFT_FLOW_CLOSE}`;
}
