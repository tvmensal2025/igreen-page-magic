// =============================================================================
// Orçamento — Testes do cálculo de valor por família
// =============================================================================

import { describe, it, expect } from "vitest";
import { computeQuoteAmount, paymentOptionsToLineItems, isPaymentOptionValid } from "../pricing";
import { FAMILY_COMMERCIAL } from "../catalog";

describe("computeQuoteAmount", () => {
  it("plan_monthly (telecom): usa a mensalidade do plano (com portabilidade por padrão)", () => {
    const plan = FAMILY_COMMERCIAL.telecom.plans.find((p) => p.id === "giga")!;
    const quote = computeQuoteAmount({ family: "telecom", plan });
    // Giga = R$ 69,90 com portabilidade → 6990 centavos.
    expect(quote.amountCents).toBe(6990);
    expect(quote.period).toBe("month");
    expect(quote.details.some((d) => d.label === "Plano")).toBe(true);
  });

  it("plan_monthly (telecom): com portabilidade usa plan.price", () => {
    const plan = FAMILY_COMMERCIAL.telecom.plans.find((p) => p.id === "giga")!;
    const quote = computeQuoteAmount({ family: "telecom", plan, portabilidade: true });
    expect(quote.amountCents).toBe(6990);
    expect(
      quote.details.some((d) => d.label === "Portabilidade" && d.value.includes("Com")),
    ).toBe(true);
  });

  it("plan_monthly (telecom): sem portabilidade usa plan.meta.semPortabilidade", () => {
    const plan = FAMILY_COMMERCIAL.telecom.plans.find((p) => p.id === "giga")!;
    const quote = computeQuoteAmount({ family: "telecom", plan, portabilidade: false });
    // Giga sem portabilidade = R$ 74,90 → 7490 centavos.
    expect(quote.amountCents).toBe(7490);
    expect(
      quote.details.some((d) => d.label === "Portabilidade" && d.value.includes("Sem")),
    ).toBe(true);
  });

  it("plan_monthly (seguros): mensalidade do plano de proteção", () => {
    const plan = FAMILY_COMMERCIAL.seguros.plans.find((p) => p.id === "premium")!;
    const quote = computeQuoteAmount({ family: "seguros", plan });
    // Premium = R$ 149,00 → 14900 centavos.
    expect(quote.amountCents).toBe(14900);
    expect(quote.period).toBe("month");
  });

  it("plan_monthly (seguros): sem semPortabilidade no meta, ignora a flag de portabilidade", () => {
    const plan = FAMILY_COMMERCIAL.seguros.plans.find((p) => p.id === "premium")!;
    const quote = computeQuoteAmount({ family: "seguros", plan, portabilidade: false });
    // Seguros não tem preço alternativo — usa o preço padrão do plano.
    expect(quote.amountCents).toBe(14900);
  });

  it("project_once (placas): mostra o valor do projeto em centavos", () => {
    // R$ 18.000,00 → 1.800.000 centavos.
    const quote = computeQuoteAmount({ family: "placas", projectAmountCents: 1_800_000 });
    expect(quote.amountCents).toBe(1_800_000);
    expect(quote.period).toBe("once");
    expect(quote.details.some((d) => d.label === "Valor do projeto")).toBe(true);
  });

  it("savings_estimate (energia): aplica o meio da faixa por padrão", () => {
    // R$ 1.000,00 → 100000 centavos. Faixa [0.15, 0.20] → meio = 0.175.
    const quote = computeQuoteAmount({ family: "energia", currentBillCents: 100_000 });
    // 100000 * 0.175 = 17500 centavos = R$ 175,00/mês.
    expect(quote.amountCents).toBe(17_500);
    expect(quote.period).toBe("month");
  });

  it("savings_estimate (energia): respeita savingsRate explícito", () => {
    // R$ 500,00 → 50000 centavos; 20% → 10000 centavos = R$ 100,00.
    const quote = computeQuoteAmount({ family: "energia", currentBillCents: 50_000, savingsRate: 0.2 });
    expect(quote.amountCents).toBe(10_000);
  });

  it("none (expansao): não gera valor (produto não orçável)", () => {
    const quote = computeQuoteAmount({ family: "expansao" });
    expect(quote.amountCents).toBe(0);
    expect(quote.details).toHaveLength(0);
  });

  it("retorna 0 quando faltam dados", () => {
    expect(computeQuoteAmount({ family: "telecom" }).amountCents).toBe(0);
    expect(computeQuoteAmount({ family: "placas" }).amountCents).toBe(0);
    expect(computeQuoteAmount({ family: "energia" }).amountCents).toBe(0);
  });
});

describe("paymentOptionsToLineItems", () => {
  it("formata à vista com o valor total (em centavos)", () => {
    // R$ 28.900,00 → 2.890.000 centavos.
    const items = paymentOptionsToLineItems([{ method: "cash", total: 2_890_000 }]);
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
        // R$ 1.281,77 → 128177 centavos.
        installmentValue: 128_177,
        interest: "1,99% a.m.",
      },
    ]);
    expect(items[0].value).toContain("60x");
    expect(items[0].value).toContain("1.281,77");
    expect(items[0].bank).toBe("BV Financeira");
    expect(items[0].interest).toBe("1,99% a.m.");
  });

  it("descarta opções inválidas (sem dados mínimos)", () => {
    const items = paymentOptionsToLineItems([
      { method: "cash", total: null },
      { method: "card", installments: null, installmentValue: null },
      { method: "financing", installments: 48, installmentValue: 137_608 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].method).toBe("financing");
  });

  it("isPaymentOptionValid valida os dados mínimos", () => {
    expect(isPaymentOptionValid({ method: "cash", total: 10_000 })).toBe(true);
    expect(isPaymentOptionValid({ method: "cash", total: 0 })).toBe(false);
    expect(
      isPaymentOptionValid({ method: "card", installments: 12, installmentValue: 5_000 }),
    ).toBe(true);
    expect(isPaymentOptionValid({ method: "card", installments: 12 })).toBe(false);
  });
});
