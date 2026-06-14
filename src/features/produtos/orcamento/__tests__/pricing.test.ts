// =============================================================================
// Orçamento — Testes do cálculo de valor por família
// =============================================================================

import { describe, it, expect } from "vitest";
import { computeQuoteAmount } from "../pricing";
import { FAMILY_COMMERCIAL } from "../catalog";

describe("computeQuoteAmount", () => {
  it("plan_monthly (telecom): usa a mensalidade do plano escolhido", () => {
    const plan = FAMILY_COMMERCIAL.telecom.plans.find((p) => p.id === "giga")!;
    const quote = computeQuoteAmount({ family: "telecom", plan });
    expect(quote.amount).toBe(69.9);
    expect(quote.period).toBe("month");
    expect(quote.details.some((d) => d.label === "Plano")).toBe(true);
  });

  it("plan_monthly (seguros): mensalidade do plano de proteção", () => {
    const plan = FAMILY_COMMERCIAL.seguros.plans.find((p) => p.id === "premium")!;
    const quote = computeQuoteAmount({ family: "seguros", plan });
    expect(quote.amount).toBe(149);
    expect(quote.period).toBe("month");
  });

  it("project_once (placas): à vista quando não há parcelas", () => {
    const quote = computeQuoteAmount({ family: "placas", projectAmount: 18000 });
    expect(quote.amount).toBe(18000);
    expect(quote.period).toBe("once");
    expect(quote.details.some((d) => d.value === "À vista")).toBe(true);
  });

  it("project_once (placas): calcula parcela do financiamento", () => {
    const quote = computeQuoteAmount({ family: "placas", projectAmount: 12000, installments: 120 });
    expect(quote.amount).toBe(12000);
    const financ = quote.details.find((d) => d.label === "Financiamento");
    expect(financ?.value).toContain("120x");
  });

  it("savings_estimate (energia): aplica o meio da faixa por padrão", () => {
    const quote = computeQuoteAmount({ family: "energia", currentBill: 1000 });
    // faixa padrão [0.15, 0.20] → meio = 0.175 → R$175/mês
    expect(quote.amount).toBe(175);
    expect(quote.period).toBe("month");
  });

  it("savings_estimate (energia): respeita savingsRate explícito", () => {
    const quote = computeQuoteAmount({ family: "energia", currentBill: 500, savingsRate: 0.2 });
    expect(quote.amount).toBe(100);
  });

  it("retorna 0 quando faltam dados", () => {
    expect(computeQuoteAmount({ family: "telecom" }).amount).toBe(0);
    expect(computeQuoteAmount({ family: "placas" }).amount).toBe(0);
    expect(computeQuoteAmount({ family: "energia" }).amount).toBe(0);
  });
});
