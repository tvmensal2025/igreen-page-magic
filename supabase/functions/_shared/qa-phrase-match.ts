/**
 * Match conservador de gatilho FAQ × mensagem do lead.
 * Evita falsos positivos de substring ("nao sou" ⊆ "nao sou de uberlandia")
 * e de palavras genéricas soltas ("depois", "link", "ativar").
 */

export const QA_STOPWORDS: ReadonlySet<string> = new Set([
  "nao", "sim", "ok", "oi", "ola", "eai", "opa", "e", "a", "o", "de", "da",
  "do", "que", "pra", "para", "com", "meu", "minha", "um", "uma", "isso",
]);

/** Palavras únicas que NÃO devem disparar FAQ / atalho sozinhas. */
export const QA_GENERIC_SINGLE: ReadonlySet<string> = new Set([
  "depois", "link", "conta", "ativar", "pensar", "taxa", "solar", "moro",
  "cidade", "cobertura", "aqui", "atende", "pagar", "paga", "quero", "bora",
  "pode", "vamos", "aceito", "fechado", "fechou", "topo", "partiu", "seguro",
  "medo", "obra", "prazo", "anos", "data", "sair", "regiao", "região", "ligar",
  "explica", "humano", "baixo", "alto", "medio", "médio", "amanha", "amanhã",
  "talvez", "interessado", "interessada",
  "fidelidade", "multa", "golpe", "furada", "enganacao", "fraude", "picaretagem",
  "scam", "aneel", "cnpj", "lgpd", "pix", "ceo", "dono", "mentira", "placa",
  "juros", "caro", "sede", "socio", "enel", "cemig", "light", "spc", "cosip",
  "apagao", "piramide", "ap", "cancelar",
]);

export function normalizeQaText(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundaryTest(needle: string, haystack: string): boolean {
  const escaped = escapeRegex(needle);
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

/**
 * Decide se `phrase` (gatilho) casa com `message` (ambos já normalizados
 * OU brutos — a função normaliza internamente se detectar acento/caixa).
 *
 * Regras:
 * 1. Igualdade exata
 * 2. Palavra única → word-boundary (exceto stopwords / genéricos)
 * 3. Frase ≥6 chars → substring contígua (exige ≥1 token significativo)
 * 4. Atalho curto: mensagem = UMA palavra ≥4 chars, significativa, contida
 *    como palavra no gatilho (ex.: "simular" → "quero simular").
 *    NÃO aceita fragmento multi-palavra ("nao sou") nem genéricos.
 */
export function phraseMatchesMessage(phraseRaw: string, messageRaw: string): boolean {
  const phrase = normalizeQaText(phraseRaw);
  const message = normalizeQaText(messageRaw);
  if (!phrase || phrase.length < 2 || !message) return false;

  // F10: Match de igualdade exata tem prioridade máxima.
  if (message === phrase) return true;

  // F10: Previne match acidental em respostas automáticas de outros bots/mensagens de sistema longas
  // Se a mensagem for muito longa (>200 chars) e a phrase for curta, ignora match de substring.
  if (message.length > 200 && phrase.length < 20) return false;

  const isSingleWord = !phrase.includes(" ");

  if (isSingleWord) {
    if (QA_STOPWORDS.has(phrase) || QA_GENERIC_SINGLE.has(phrase)) return false;
    return wordBoundaryTest(phrase, message);
  }

  const significant = phrase.split(" ").filter((w) => w.length >= 3 && !QA_STOPWORDS.has(w));
  if (significant.length === 0) {
    return message === phrase;
  }

  if (phrase.length >= 6 && message.includes(phrase)) return true;

  // Regra 4 endurecida: só atalho de UMA palavra significativa no gatilho.
  if (
    message.length >= 4 &&
    message.length <= 12 &&
    !message.includes(" ") &&
    !QA_STOPWORDS.has(message) &&
    !QA_GENERIC_SINGLE.has(message)
  ) {
    return wordBoundaryTest(message, phrase);
  }

  return false;
}
