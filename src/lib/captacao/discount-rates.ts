/**
 * Espelho frontend de supabase/functions/_shared/discount-rates.ts.
 * Manter SINCRONIZADO — Deno não é importável do bundle Vite.
 */

export interface DiscountRates {
  min: number;
  max: number;
  label: string;
  rangeLabel: string;
  maxPct: number;
  minPct: number;
}

export function discountRates(variant?: string | null): DiscountRates {
  const v = String(variant || "A").toUpperCase();
  if (v === "M") {
    return { min: 0.10, max: 0.28, label: "até 28%", rangeLabel: "10% e 28%", maxPct: 28, minPct: 10 };
  }
  return { min: 0.08, max: 0.20, label: "até 20%", rangeLabel: "8% e 20%", maxPct: 20, minPct: 8 };
}
