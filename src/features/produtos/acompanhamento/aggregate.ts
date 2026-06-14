// =============================================================================
// Acompanhamento — Agregação de vendas (pontos e comissão)
// =============================================================================
// Funções puras que resumem as vendas de um consultor por produto: total de
// vendas, pontos kWh-equivalente acumulados e comissão estimada. A comissão é
// uma ESTIMATIVA local a partir de products.commission_rule — o valor oficial
// é sempre o do portal iGreen. Deixamos explícito para não induzir erro.
// =============================================================================

import type { CommissionRule, Product, ProductFamily } from "../catalogo/types";
import type { Proposal, ProposalStatus } from "../orcamento/types";
import type { Sale } from "../vendas/types";

const PENDING_PROPOSAL_STATUSES: ProposalStatus[] = ["sent", "viewed", "countered"];

export interface FinancialSummary {
  /** Soma mensal de vendas ativas (energia, telecom, seguros, club). */
  mrrActive: number;
  /** Soma de vendas únicas ativas (placas/projetos). */
  oneTimeActive: number;
  /** Comissão estimada mensal (vendas ativas). */
  totalEstimatedCommission: number;
  /** Valor mensal em propostas aguardando resposta. */
  pipelineMrr: number;
  /** Valor único em propostas aguardando resposta. */
  pipelineOneTime: number;
  /** Propostas aguardando resposta (sent/viewed/countered). */
  proposalsPending: number;
  /** Propostas aceitas. */
  proposalsAccepted: number;
  /** Vendas em captura (aceitas, ainda não ativas — não entram no MRR). */
  salesCapturing: number;
}

/** Monta rótulo do pipeline separando recorrente e valor único. */
export function formatPipelineLabel(
  financial: Pick<FinancialSummary, "pipelineMrr" | "pipelineOneTime" | "proposalsPending">,
  formatCurrency: (n: number) => string,
): { value: string; hint: string } {
  const parts: string[] = [];
  if (financial.pipelineMrr > 0) parts.push(`${formatCurrency(financial.pipelineMrr)}/mês`);
  if (financial.pipelineOneTime > 0) parts.push(`${formatCurrency(financial.pipelineOneTime)} único`);
  return {
    value: parts.length > 0 ? parts.join(" + ") : formatCurrency(0),
    hint: `${financial.proposalsPending} aguardando resposta`,
  };
}

/** Infere periodicidade de faturamento a partir da família do produto. */
export function inferRevenuePeriod(product: Product): "month" | "once" | null {
  switch (product.family as ProductFamily) {
    case "energia":
    case "telecom":
    case "seguros":
    case "club":
      return "month";
    case "placas":
      return "once";
    case "expansao":
    default:
      return null;
  }
}

export interface ProductRollup {
  productId: string;
  productName: string;
  /** Vendas ativas (geram pontos/comissão). */
  activeCount: number;
  /** Total de vendas (qualquer status). */
  totalCount: number;
  /** Pontos kWh-equivalente acumulados (somente vendas ativas). */
  pointsKwh: number;
  /** Comissão estimada (R$) — aproximação local, não substitui o portal. */
  estimatedCommission: number;
}

export interface SalesSummary {
  byProduct: ProductRollup[];
  totalActive: number;
  totalSales: number;
  totalPointsKwh: number;
  totalEstimatedCommission: number;
}

/**
 * Estima a comissão de UMA venda ativa conforme a regra do produto.
 * É deliberadamente conservadora: regras recorrentes/royalties usam o valor
 * da venda (amount) como base mensal; tipos sem base monetária retornam 0.
 */
export function estimateCommission(rule: CommissionRule, sale: Sale): number {
  switch (rule.type) {
    case "recurring_percent":
    case "royalties_percent": {
      const base = sale.amount ?? 0;
      return round2((base * rule.max_percent) / 100);
    }
    case "fixed": {
      // Telecom: comissão de geração própria por plano conectado.
      return round2(rule.own);
    }
    case "recruitment":
      return round2(rule.direct_bonus);
    case "per_policy":
    case "none":
    default:
      return 0;
  }
}

/** Resume as vendas por produto. `products` fornece nome e regra de comissão. */
export function summarizeSales(sales: Sale[], products: Product[]): SalesSummary {
  const productById = new Map(products.map((p) => [p.id, p]));
  const rollups = new Map<string, ProductRollup>();

  for (const sale of sales) {
    const product = productById.get(sale.productId);
    const productName = product?.name ?? "Produto";
    let rollup = rollups.get(sale.productId);
    if (!rollup) {
      rollup = {
        productId: sale.productId,
        productName,
        activeCount: 0,
        totalCount: 0,
        pointsKwh: 0,
        estimatedCommission: 0,
      };
      rollups.set(sale.productId, rollup);
    }

    rollup.totalCount += 1;
    if (sale.status === "active") {
      rollup.activeCount += 1;
      rollup.pointsKwh = round2(rollup.pointsKwh + sale.pointsKwh);
      if (product) {
        rollup.estimatedCommission = round2(
          rollup.estimatedCommission + estimateCommission(product.commissionRule, sale),
        );
      }
    }
  }

  const byProduct = [...rollups.values()].sort((a, b) => b.pointsKwh - a.pointsKwh);

  return {
    byProduct,
    totalActive: byProduct.reduce((acc, r) => acc + r.activeCount, 0),
    totalSales: byProduct.reduce((acc, r) => acc + r.totalCount, 0),
    totalPointsKwh: round2(byProduct.reduce((acc, r) => acc + r.pointsKwh, 0)),
    totalEstimatedCommission: round2(byProduct.reduce((acc, r) => acc + r.estimatedCommission, 0)),
  };
}

/** Resume faturamento ativo, pipeline de orçamentos e comissão estimada. */
export function computeFinancialMetrics(
  sales: Sale[],
  products: Product[],
  proposals: Proposal[] = [],
): FinancialSummary {
  const productById = new Map(products.map((p) => [p.id, p]));
  let mrrActive = 0;
  let oneTimeActive = 0;

  for (const sale of sales) {
    if (sale.status !== "active") continue;
    const product = productById.get(sale.productId);
    if (!product) continue;
    const period = inferRevenuePeriod(product);
    const amount = sale.amount ?? 0;
    if (period === "month") mrrActive = round2(mrrActive + amount);
    else if (period === "once") oneTimeActive = round2(oneTimeActive + amount);
  }

  let pipelineMrr = 0;
  let pipelineOneTime = 0;
  let proposalsPending = 0;
  let proposalsAccepted = 0;

  for (const proposal of proposals) {
    if (proposal.status === "accepted") proposalsAccepted += 1;
    if (!PENDING_PROPOSAL_STATUSES.includes(proposal.status)) continue;
    proposalsPending += 1;
    const amount = proposal.amount ?? 0;
    if (proposal.amountPeriod === "month") pipelineMrr = round2(pipelineMrr + amount);
    else pipelineOneTime = round2(pipelineOneTime + amount);
  }

  const { totalEstimatedCommission } = summarizeSales(sales, products);
  const salesCapturing = sales.filter((s) => s.status === "capturing").length;

  return {
    mrrActive,
    oneTimeActive,
    totalEstimatedCommission,
    pipelineMrr,
    pipelineOneTime,
    proposalsPending,
    proposalsAccepted,
    salesCapturing,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
