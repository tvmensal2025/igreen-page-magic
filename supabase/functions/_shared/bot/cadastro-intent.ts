/**
 * Classificação unificada de intenção do lead (cadastro / dúvida / status).
 * Substitui listas espalhadas em purchase-intent, RE_INTENT_CADASTRAR e STRONG_PURCHASE.
 */

export type CadastroIntentKind =
  | "advance"   // quer avançar no cadastro
  | "status"    // pergunta se já está cadastrando / em que passo
  | "question"  // dúvida FAQ/IA
  | "none";

const NEGATION_BEFORE = ["nao ", "nem ", "nunca ", "jamais "];

/** Frases de AVANÇO — match com limite de palavra (evita "me cadastra" ⊆ "cadastrando"). */
const ADVANCE_PHRASES = [
  "quero contratar", "quero assinar", "quero cadastrar", "quero me cadastrar",
  "quero aderir", "quero fechar", "quero participar", "quero o desconto",
  "ativar o beneficio", "ativar o benefício", "ativar beneficio", "ativar benefício",
  "quero ativar",
  "quero sim", "vou querer", "pode fazer", "pode cadastrar",
  "me inscreve", "me cadastra", "vamos fechar", "vamos fazer", "vamos sim",
  "vamos la", "bora fechar", "bora cadastrar", "simbora",
  "como faco para aderir", "como eu faco para cadastrar", "como cadastrar",
  "aceito a proposta", "aceito sim",
  "to dentro",
  "continuar cadastro", "continuar o cadastro",
  "quero continuar", "seguir com cadastro", "fazer cadastro", "faca o cadastro",
  "inscrever", "cadastrar agora", "quero me cadastrar agora",
  "btn_quero_cadastrar", "quero_cadastrar", "sim_cadastrar", "btn_cadastrar",
  "continuar cadastro", "quero me cadastrar",
];

/** Comandos curtos exatos (mensagem inteira) — não embutidos em frase ambígua. */
const ADVANCE_EXACT = new Set([
  "bora", "partiu", "aceito", "fechou", "fechado", "topo", "ativar", "cadastrar", "cadastro",
]);

/** Regex de STATUS — checados ANTES de advance. */
const STATUS_PATTERNS: RegExp[] = [
  /\b(ja|já)\s+estou\s+(me\s+)?cadastrando\b/i,
  /\bestou\s+(me\s+)?cadastrando\b/i,
  /\bja\s+(estou|to)\s+(no\s+)?cadastro\b/i,
  /\bem\s+que\s+passo\b/i,
  /\bonde\s+(estou|parei|parou)\b/i,
  /\bcadastro\s+(ja|já)\s+(foi|esta|está|andando|comecou|começou)\b/i,
  /\b(to|estou)\s+cadastrando\s+(ainda|ja|já)\b/i,
  /^[\s?！？]{1,4}$/, // "?" curto = pedido de contexto
];

const QUESTION_START =
  /^(como|quanto|qual|quando|onde|quem|por\s?que|pq|o\s+que|sera|será|tem|posso|preciso|precisa|funciona|é|e\s|cobra|paga|cancel|seguro|garantia|fidelidade|multa|vale|consigo|atende|d[uú]vida|me\s+(explica|conta|tira))/i;

export function stripAccents(s: string): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Frase inteira com limite de token — "me cadastra" não casa em "me cadastrando". */
export function phraseMatchesBounded(normalized: string, phrase: string): boolean {
  const p = escapeRegex(stripAccents(phrase).trim());
  if (!p) return false;
  const re = new RegExp(`(?:^|[^a-z0-9])${p}(?:[^a-z0-9]|$)`);
  const idx = normalized.search(re);
  if (idx < 0) return false;
  const before = normalized.slice(Math.max(0, idx - 6), idx);
  return !NEGATION_BEFORE.some((neg) => before.includes(neg.trim()));
}

export function isStatusQuestion(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return STATUS_PATTERNS.some((rx) => rx.test(raw));
}

export function isCadastroQuestion(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (raw.includes("?")) return true;
  return QUESTION_START.test(raw);
}

/** Lead quer AVANÇAR no cadastro (não confundir com pergunta de status). */
export function wantsToAdvance(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (isStatusQuestion(raw)) return false;
  const normalized = stripAccents(raw);
  if (ADVANCE_EXACT.has(normalized.replace(/[!?.]+$/g, "").trim())) return true;
  // Atalho no início: "cadastrar", "cadastro" como comando (não "cadastrando")
  if (/^(cadastrar|cadastro|inscrever)\b/.test(normalized)) return true;
  if (/^(quero|bora|vamos|partiu|aceito|pode|faz)\b/.test(normalized) && /\bcadastr/.test(normalized)) {
    if (/\bcadastrando\b/.test(normalized)) return false;
    return true;
  }
  return ADVANCE_PHRASES.some((phrase) => phraseMatchesBounded(normalized, phrase));
}

export function classifyLeadIntent(text: string): CadastroIntentKind {
  const raw = String(text || "").trim();
  if (!raw) return "none";
  if (isStatusQuestion(raw)) return "status";
  if (wantsToAdvance(raw)) return "advance";
  if (isCadastroQuestion(raw)) return "question";
  return "none";
}

/** @deprecated Use `wantsToAdvance` — mantido para imports existentes. */
export function hasPurchaseIntent(questionText: string): boolean {
  return wantsToAdvance(questionText);
}
