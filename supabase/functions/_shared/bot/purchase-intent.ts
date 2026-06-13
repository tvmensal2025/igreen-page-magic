/**
 * Detecção de intenção de compra durante FAQ/detour.
 * Compartilhado entre evolution-webhook e whapi-webhook.
 */

const PURCHASE_PHRASES = [
  "quero contratar", "quero assinar", "quero cadastrar", "quero aderir",
  "quero fechar", "vou querer", "pode fazer", "me inscreve",
  "me cadastra", "vamos fechar", "vamos fazer", "bora fechar",
  "como faço para aderir", "aceito a proposta", "aceito sim",
  "quero sim", "vamos sim",
];

/** Prefixos checados APÓS strip de acentos (só ASCII). */
const NEGATION_PREFIXES = ["nao ", "nem ", "nunca ", "jamais "];

function stripAccents(s: string): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Retorna true se a mensagem indica que o lead quer avançar no fluxo. */
export function hasPurchaseIntent(questionText: string): boolean {
  const normalized = stripAccents(questionText);
  return PURCHASE_PHRASES.some((phrase) => {
    const idx = normalized.indexOf(stripAccents(phrase));
    if (idx < 0) return false;
    const before = normalized.slice(Math.max(0, idx - 6), idx);
    return !NEGATION_PREFIXES.some((neg) => before.includes(neg.trim()));
  });
}
