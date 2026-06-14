// =============================================================================
// Acompanhamento — Testes de agregação e plano de carreira
// =============================================================================

import { describe, it, expect } from "vitest";
import { estimateCommission, summarizeSales, inferRevenuePeriod, computeFinancialMetrics, formatPipelineLabel } from "../aggregate";
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
    status: "active",
    amount: 500,
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
    amount: 100,
    amountPeriod: "month",
    discount: null,
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

describe("inferRevenuePeriod", () => {
  it("energia/telecom/seguros/club são mensais", () => {
    expect(inferRevenuePeriod(makeProduct({ family: "energia" }))).toBe("month");
    expect(inferRevenuePeriod(makeProduct({ family: "telecom" }))).toBe("month");
    expect(inferRevenuePeriod(makeProduct({ family: "seguros" }))).toBe("month");
    expect(inferRevenuePeriod(makeProduct({ family: "club" }))).toBe("month");
  });

  it("placas é venda única", () => {
    expect(inferRevenuePeriod(makeProduct({ family: "placas" }))).toBe("once");
  });

  it("expansao retorna null", () => {
    expect(inferRevenuePeriod(makeProduct({ family: "expansao" }))).toBeNull();
  });
});

describe("computeFinancialMetrics", () => {
  it("soma MRR e vendas únicas apenas de vendas ativas", () => {
    const green = makeProduct({ id: "g", family: "energia" });
    const placas = makeProduct({ id: "pl", family: "placas" });
    const sales = [
      makeSale({ id: "1", productId: "g", status: "active", amount: 500 }),
      makeSale({ id: "2", productId: "pl", status: "active", amount: 15000 }),
      makeSale({ id: "3", productId: "g", status: "lead", amount: 300 }),
    ];
    const metrics = computeFinancialMetrics(sales, [green, placas]);
    expect(metrics.mrrActive).toBe(500);
    expect(metrics.oneTimeActive).toBe(15000);
  });

  it("conta pipeline de propostas pendentes por periodicidade", () => {
    const product = makeProduct();
    const proposals = [
      makeProposal({ id: "a", status: "sent", amount: 59.9, amountPeriod: "month" }),
      makeProposal({ id: "b", status: "countered", amount: 12000, amountPeriod: "once" }),
      makeProposal({ id: "c", status: "accepted", amount: 100, amountPeriod: "month" }),
      makeProposal({ id: "d", status: "rejected", amount: 50, amountPeriod: "month" }),
    ];
    const metrics = computeFinancialMetrics([], [product], proposals);
    expect(metrics.pipelineMrr).toBe(59.9);
    expect(metrics.pipelineOneTime).toBe(12000);
    expect(metrics.proposalsPending).toBe(2);
    expect(metrics.proposalsAccepted).toBe(1);
  });

  it("conta vendas em captura separadamente do MRR", () => {
    const product = makeProduct();
    const sales = [
      makeSale({ id: "1", status: "active", amount: 500 }),
      makeSale({ id: "2", status: "capturing", amount: 300 }),
    ];
    const metrics = computeFinancialMetrics(sales, [product]);
    expect(metrics.mrrActive).toBe(500);
    expect(metrics.salesCapturing).toBe(1);
  });
});

describe("formatPipelineLabel", () => {
  const brl = (n: number) => `R$${n}`;

  it("separa recorrente e valor único", () => {
    const label = formatPipelineLabel(
      { pipelineMrr: 59.9, pipelineOneTime: 12000, proposalsPending: 2 },
      brl,
    );
    expect(label.value).toBe("R$59.9/mês + R$12000 único");
    expect(label.hint).toBe("2 aguardando resposta");
  });

  it("mostra zero formatado quando pipeline vazio", () => {
    const label = formatPipelineLabel(
      { pipelineMrr: 0, pipelineOneTime: 0, proposalsPending: 0 },
      brl,
    );
    expect(label.value).toBe("R$0");
  });
});

describe("estimateCommission", () => {
  it("recurring_percent: aplica % sobre o valor da venda", () => {
    expect(
      estimateCommission({ type: "recurring_percent", max_percent: 4 }, makeSale({ amount: 500 })),
    ).toBe(20);
  });

  it("fixed: retorna comissão de geração própria (telecom)", () => {
    expect(
      estimateCommission({ type: "fixed", own: 7 }, makeSale({ amount: 54.9 })),
    ).toBe(7);
  });

  it("recruitment: retorna bônus direto", () => {
    expect(
      estimateCommission({ type: "recruitment", direct_bonus: 300 }, makeSale()),
    ).toBe(300);
  });

  it("per_policy / none: retornam 0", () => {
    expect(estimateCommission({ type: "per_policy" }, makeSale())).toBe(0);
    expect(estimateCommission({ type: "none" }, makeSale())).toBe(0);
  });
});

describe("summarizeSales", () => {
  it("soma pontos e comissão apenas de vendas ativas", () => {
    const product = makeProduct();
    const sales = [
      makeSale({ id: "a", status: "active", amount: 500, pointsKwh: 500 }),
      makeSale({ id: "b", status: "lead", amount: 500, pointsKwh: 500 }),
    ];
    const summary = summarizeSales(sales, [product]);
    expect(summary.totalActive).toBe(1);
    expect(summary.totalSales).toBe(2);
    expect(summary.totalPointsKwh).toBe(500);
    expect(summary.totalEstimatedCommission).toBe(20);
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
      makeSale({ id: "1", productId: "t", status: "active", amount: 54.9, pointsKwh: 200 }),
      makeSale({ id: "2", productId: "g", status: "active", amount: 500, pointsKwh: 500 }),
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
