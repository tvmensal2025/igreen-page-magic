// =============================================================================
// Acompanhamento — Testes de agregação e plano de carreira
// =============================================================================
// Venda única: valores monetários em CENTAVOS; "fechado" é o status final.
// =============================================================================

import { describe, it, expect } from "vitest";
import { estimateCommission, summarizeSales, computeFinancialMetrics } from "../aggregate";
import { computeCareerProgress, CAREER_TIERS } from "../careerPlan";
import type { Product } from "../../catalogo/types";
import type { Proposal } from "../../orcamento/types";
import type { Sale } from "../../vendas/types";

function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    slug: "conexao-green",
    name: "Conexão Green",
    brandName: "iGreen Energy",
    family: "energia",
    isActive: true,
    sortOrder: 10,
    scoringRule: { mode: "contracted_kwh", multiplier: 1 },
    commissionRule: { type: "recurring_percent", max_percent: 4 },
    landingContent: {},
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function makeSale(over: Partial<Sale> = {}): Sale {
  return {
    id: "s1",
    consultantId: "c1",
    productId: "p1",
    customerId: null,
    status: "fechado",
    // Valor em centavos (R$ 500,00 = 50000).
    amountCents: 50000,
    pointsKwh: 500,
    captureData: {},
    notes: null,
    submittedAt: null,
    activatedAt: null,
    closedAt: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function makeProposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: "pr1",
    publicToken: "abc",
    consultantId: "c1",
    productId: "p1",
    customerId: null,
    recipientName: "João",
    recipientPhone: "11999999999",
    status: "sent",
    // Valor em centavos (R$ 100,00 = 10000).
    amountCents: 10000,
    amountPeriod: "month",
    discountCents: null,
    lineItems: [],
    message: null,
    validUntil: null,
    sentAt: null,
    viewedAt: null,
    respondedAt: null,
    saleId: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("computeFinancialMetrics", () => {
  it("soma o valor das vendas fechadas em centavos", () => {
    const green = makeProduct({ id: "g", family: "energia" });
    const placas = makeProduct({ id: "pl", family: "placas" });
    const sales = [
      // R$ 500,00 fechado
      makeSale({ id: "1", productId: "g", status: "fechado", amountCents: 50000 }),
      // R$ 15.000,00 fechado
      makeSale({ id: "2", productId: "pl", status: "fechado", amountCents: 1500000 }),
      // negociando não entra no total fechado
      makeSale({ id: "3", productId: "g", status: "negociando", amountCents: 30000 }),
    ];
    const metrics = computeFinancialMetrics(sales, [green, placas]);
    expect(metrics.totalFechado).toBe(1550000);
  });

  it("soma o pipeline das propostas pendentes em centavos", () => {
    const product = makeProduct();
    const proposals = [
      // R$ 59,90 pendente
      makeProposal({ id: "a", status: "sent", amountCents: 5990 }),
      // R$ 12.000,00 pendente (contraposta)
      makeProposal({ id: "b", status: "countered", amountCents: 1200000 }),
      // aceita: conta em proposalsAccepted, não no pipeline
      makeProposal({ id: "c", status: "accepted", amountCents: 10000 }),
      // recusada: não entra em nada
      makeProposal({ id: "d", status: "rejected", amountCents: 5000 }),
    ];
    const metrics = computeFinancialMetrics([], [product], proposals);
    expect(metrics.pipelineValue).toBe(1205990);
    expect(metrics.proposalsPending).toBe(2);
    expect(metrics.proposalsAccepted).toBe(1);
  });

  it("ignora vendas não fechadas no total fechado", () => {
    const product = makeProduct();
    const sales = [
      makeSale({ id: "1", status: "fechado", amountCents: 50000 }),
      makeSale({ id: "2", status: "negociando", amountCents: 30000 }),
      makeSale({ id: "3", status: "interesse", amountCents: 20000 }),
      makeSale({ id: "4", status: "perdido", amountCents: 10000 }),
    ];
    const metrics = computeFinancialMetrics(sales, [product]);
    expect(metrics.totalFechado).toBe(50000);
  });
});

describe("estimateCommission", () => {
  it("recurring_percent: aplica % sobre o valor da venda (centavos)", () => {
    // 4% de R$ 500,00 (50000 centavos) = R$ 20,00 (2000 centavos)
    expect(
      estimateCommission({ type: "recurring_percent", max_percent: 4 }, makeSale({ amountCents: 50000 })),
    ).toBe(2000);
  });

  it("royalties_percent: aplica % sobre o valor da venda (centavos)", () => {
    // 10% de R$ 1.000,00 (100000 centavos) = R$ 100,00 (10000 centavos)
    expect(
      estimateCommission({ type: "royalties_percent", max_percent: 10 }, makeSale({ amountCents: 100000 })),
    ).toBe(10000);
  });

  it("fixed: retorna comissão de geração própria em centavos (telecom)", () => {
    // own = R$ 7,00 → 700 centavos
    expect(
      estimateCommission({ type: "fixed", own: 7 }, makeSale({ amountCents: 5490 })),
    ).toBe(700);
  });

  it("recruitment: retorna bônus direto em centavos", () => {
    // direct_bonus = R$ 300,00 → 30000 centavos
    expect(
      estimateCommission({ type: "recruitment", direct_bonus: 300 }, makeSale()),
    ).toBe(30000);
  });

  it("per_policy / none: retornam 0", () => {
    expect(estimateCommission({ type: "per_policy" }, makeSale())).toBe(0);
    expect(estimateCommission({ type: "none" }, makeSale())).toBe(0);
  });
});

describe("summarizeSales", () => {
  it("soma pontos e comissão (centavos) apenas de vendas fechadas", () => {
    const product = makeProduct();
    const sales = [
      makeSale({ id: "a", status: "fechado", amountCents: 50000, pointsKwh: 500 }),
      makeSale({ id: "b", status: "interesse", amountCents: 50000, pointsKwh: 500 }),
    ];
    const summary = summarizeSales(sales, [product]);
    expect(summary.totalClosed).toBe(1);
    expect(summary.totalSales).toBe(2);
    expect(summary.totalPointsKwh).toBe(500);
    // 4% de R$ 500,00 = R$ 20,00 = 2000 centavos
    expect(summary.totalEstimatedCommission).toBe(2000);
  });

  it("agrupa por produto e ordena por pontos desc", () => {
    const green = makeProduct({ id: "g", name: "Green" });
    const telecom = makeProduct({
      id: "t",
      name: "Telecom",
      family: "telecom",
      commissionRule: { type: "fixed", own: 7 },
    });
    const sales = [
      makeSale({ id: "1", productId: "t", status: "fechado", amountCents: 5490, pointsKwh: 200 }),
      makeSale({ id: "2", productId: "g", status: "fechado", amountCents: 50000, pointsKwh: 500 }),
    ];
    const summary = summarizeSales(sales, [green, telecom]);
    expect(summary.byProduct[0].productId).toBe("g");
    expect(summary.byProduct[1].productId).toBe("t");
  });
});

describe("computeCareerProgress", () => {
  it("inicia em Licenciado com 0 kWh", () => {
    const p = computeCareerProgress(0);
    expect(p.current.key).toBe("licenciado");
    expect(p.next?.key).toBe("senior");
    expect(p.kwhToNext).toBe(10_000);
  });

  it("atinge Sênior em 10.000 kWh", () => {
    const p = computeCareerProgress(10_000);
    expect(p.current.key).toBe("senior");
    expect(p.next?.key).toBe("gestor");
  });

  it("topo de carreira não tem próximo nível", () => {
    const top = CAREER_TIERS[CAREER_TIERS.length - 1];
    const p = computeCareerProgress(top.kwhRequired + 1);
    expect(p.current.key).toBe(top.key);
    expect(p.next).toBeNull();
    expect(p.ratioToNext).toBe(1);
  });

  it("ratioToNext fica entre 0 e 1 no meio da faixa", () => {
    const p = computeCareerProgress(30_000); // entre senior(10k) e gestor(50k)
    expect(p.ratioToNext).toBeGreaterThan(0);
    expect(p.ratioToNext).toBeLessThan(1);
  });
});
