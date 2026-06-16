// =============================================================================
// Orçamento — Testes do cálculo de valor por família
// =============================================================================

import { describe, it, expect } from "vitest";
import { computeQuoteAmount, paymentOptionsToLineItems, isPaymentOptionValid } from "../pricing";
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

  it("project_once (placas): mostra o valor do projeto", () => {
    const quote = computeQuoteAmount({ family: "placas", projectAmount: 18000 });
    expect(quote.amount).toBe(18000);
    expect(quote.period).toBe("once");
    expect(quote.details.some((d) => d.label === "Valor do projeto")).toBe(true);
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

describe("paymentOptionsToLineItems", () => {
  it("formata à vista com o valor total", () => {
    const items = paymentOptionsToLineItems([{ method: "cash", total: 28900 }]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("payment");
    expect(items[0].value).toContain("28.900");
  });

  it("formata financiamento com parcelas, banco e juros", () => {
    const items = paymentOptionsToLineItems([
      {
        method: "financing",
        bank: "BV Financeira",
        installments: 60,
        installmentValue: 1281.77,
        interest: "1,99% a.m.",
      },
    ]);
    expect(items[0].value).toContain("60x");
    expect(items[0].bank).toBe("BV Financeira");
    expect(items[0].interest).toBe("1,99% a.m.");
  });

  it("descarta opções inválidas (sem dados mínimos)", () => {
    const items = paymentOptionsToLineItems([
      { method: "cash", total: null },
      { method: "card", installments: null, installmentValue: null },
      { method: "financing", installments: 48, installmentValue: 1376.08 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].method).toBe("financing");
  });

  it("isPaymentOptionValid valida os dados mínimos", () => {
    expect(isPaymentOptionValid({ method: "cash", total: 100 })).toBe(true);
    expect(isPaymentOptionValid({ method: "cash", total: 0 })).toBe(false);
    expect(
      isPaymentOptionValid({ method: "card", installments: 12, installmentValue: 50 }),
    ).toBe(true);
    expect(isPaymentOptionValid({ method: "card", installments: 12 })).toBe(false);
  });
});
