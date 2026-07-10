/**
 * Parse de valor monetário BR/US — fonte única para conta de luz / simulação.
 *
 * Regras:
 *  - Com vírgula → formato BR: "." = milhar, "," = decimal
 *    "1.688,15" → 1688.15 | "350,00" → 350
 *  - Vários pontos sem vírgula → milhares
 *    "1.688.150" → 1688150
 *  - Um ponto + exatamente 3 casas → milhar BR
 *    "1.688" → 1688
 *  - Um ponto + 1–2 casas → decimal (US / teclado)
 *    "350.00" → 350 | "200.0" → 200 | "1688.15" → 1688.15
 *  - Só dígitos → inteiro
 *    "350" → 350
 *
 * Nunca remove o ponto cegamente (bug clássico: "350.00" → 35000).
 */

/** Número monetário: 350 | 350.00 | 350,50 | 1.688 | 1.688,15 */
export const MONEY_NUM_SRC =
  String.raw`\d{1,3}(?:\.\d{3})+,\d{1,2}|\d{1,3}(?:\.\d{3})+|\d{1,6}[.,]\d{1,2}|\d{2,6}`;

const MONEY_IN_TEXT_RE = new RegExp(
  `(?:r\\$\\s*)?(${MONEY_NUM_SRC})`,
  "i",
);

export function parseMoneyBR(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") {
    return Number.isFinite(input) && input > 0 ? input : null;
  }

  let raw = String(input).replace(/[^\d.,]/g, "");
  if (!raw) return null;

  if (raw.includes(",")) {
    // Formato BR: pontos são milhar, vírgula é decimal (só a primeira vírgula).
    const firstComma = raw.indexOf(",");
    const intPart = raw.slice(0, firstComma).replace(/\./g, "");
    const fracPart = raw.slice(firstComma + 1).replace(/[^\d]/g, "").slice(0, 2);
    raw = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  } else {
    const dots = (raw.match(/\./g) || []).length;
    if (dots > 1) {
      raw = raw.replace(/\./g, "");
    } else if (dots === 1) {
      const frac = raw.split(".")[1] || "";
      if (frac.length === 3) {
        // "1.688" → milhar BR
        raw = raw.replace(/\./g, "");
      }
      // senão: decimal US ("350.00", "200.0") — parseFloat direto
    }
  }

  const v = parseFloat(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Extrai o primeiro valor monetário de uma mensagem de chat.
 * Retorna null se não achar número válido.
 */
export function extractMoneyFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = String(text).match(MONEY_IN_TEXT_RE);
  if (!m) return null;
  return parseMoneyBR(m[1]);
}
