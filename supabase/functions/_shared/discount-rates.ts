/**
 * Taxas de desconto/economia por variante de fluxo.
 *
 * Regra geral (A/B/C/D/E): 8% (mín) a 20% (máx) — mem://copy/discount-rate-20.
 * Exceção Fluxo M (MG):    10% (mín) a 28% (máx).
 *
 * Usado por:
 *  - _shared/render-vars.ts (chaves {{economia_mensal|anual|range|faixa}})
 *  - src/lib/captacao/postBillConfirm.ts (fallback pós-OCR)
 *  - {whapi,evolution}-webhook/handlers/bot-flow.ts (mapa de substituição + simulação inline)
 *
 * NÃO altera copy pública (LP/FAQ) — só o runtime do bot.
 */

export type FlowVariantForRates = "A" | "B" | "C" | "D" | "E" | "M" | string;

export interface DiscountRates {
  /** Fração mínima (ex.: 0.08 = 8%). */
  min: number;
  /** Fração máxima (ex.: 0.20 = 20%). */
  max: number;
  /** Rótulo curto "até X%". */
  label: string;
  /** Rótulo faixa "X% e Y%". */
  rangeLabel: string;
  /** Percentual inteiro máximo (para texto rápido). */
  maxPct: number;
  /** Percentual inteiro mínimo. */
  minPct: number;
}

export function discountRates(variant?: FlowVariantForRates | null): DiscountRates {
  const v = String(variant || "A").toUpperCase();
  if (v === "M") {
    return {
      min: 0.10,
      max: 0.28,
      label: "até 28%",
      rangeLabel: "10% e 28%",
      maxPct: 28,
      minPct: 10,
    };
  }
  return {
    min: 0.08,
    max: 0.20,
    label: "até 20%",
    rangeLabel: "8% e 20%",
    maxPct: 20,
    minPct: 8,
  };
}
