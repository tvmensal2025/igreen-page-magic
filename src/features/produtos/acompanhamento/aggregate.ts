// =============================================================================
// Acompanhamento — Agregação de vendas (pontos e comissão)
// =============================================================================
// Funções puras que resumem as vendas de um consultor por produto: total de
// negócios fechados, valor fechado, pontos kWh-equivalente acumulados e
// comissão estimada. A comissão é uma ESTIMATIVA local a partir de
// products.commission_rule — o valor oficial é sempre o do portal iGreen.
// Deixamos explícito para não induzir erro.
//
// Venda única: não há recorrência nem mensalidade. Todos os valores monetários
// trafegam em CENTAVOS (inteiros); a conversão para reais acontece só na UI
// (ver `lib/money.ts`). "Fechado" é o status final do acompanhamento.
// =============================================================================

import type { CommissionRule, Product } from "../catalogo/types";
import type { Proposal, ProposalStatus } from "../orcamento/types";
import type { Sale } from "../vendas/types";
import { reaisToCents } from "../lib/money";

const PENDING_PROPOSAL_STATUSES: ProposalStatus[] = ["sent", "viewed", "countered"];

export interface FinancialSummary {
  /** Soma do valor das vendas fechadas, em centavos. */
  totalFechado: number;
  /** Comissão estimada total das vendas fechadas, em centavos. */
  totalEstimatedCommission: number;
  /** Valor total em propostas aguardando resposta, em centavos. */
  pipelineValue: number;
  /** Propostas aguardando resposta (sent/viewed/countered). */
  proposalsPending: number;
  /** Propostas aceitas. */
  proposalsAccepted: number;
}

export interface ProductRollup {
  productId: string;
  productName: string;
  /** Vendas fechadas (geram pontos/comissão). */
  closedCount: number;
  /** Total de vendas (qualquer status). */
  totalCount: number;
  /** Pontos kWh-equivalente acumulados (somente vendas fechadas). */
  pointsKwh: number;
  /** Comissão estimada em CENTAVOS — aproximação local, não substitui o portal. */
  estimatedCommission: number;
}

export interface SalesSummary {
  byProduct: ProductRollup[];
  totalClosed: number;
  totalSales: number;
  totalPointsKwh: number;
  /** Comissão estimada total em CENTAVOS. */
  totalEstimatedCommission: number;
}

/**
 * Estima a comissão de UMA venda fechada conforme a regra do produto.
 * Trabalha sempre em CENTAVOS. Como é venda única, as regras de percentual
 * (recurring/royalties) aplicam o percentual sobre o valor da venda — sem
 * conotação mensal. As regras de valor fixo (`fixed`, `recruitment`) são
 * informadas em reais no catálogo e convertidas para centavos aqui.
 */
export function estimateCommission(rule: CommissionRule, sale: Sale): number {
  switch (rule.type) {
    case "recurring_percent":
    case "royalties_percent": {
      const baseCents = sale.amountCents ?? 0;
      return Math.round((baseCents * rule.max_percent) / 100);
    }
    case "fixed": {
      // Telecom: comissão de geração própria por plano conectado (reais → centavos).
      return reaisToCents(rule.own);
    }
    case "recruitment":
      return reaisToCents(rule.direct_bonus);
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
        closedCount: 0,
        totalCount: 0,
        pointsKwh: 0,
        estimatedCommission: 0,
      };
      rollups.set(sale.productId, rollup);
    }

    rollup.totalCount += 1;
    if (sale.status === "fechado") {
      rollup.closedCount += 1;
      rollup.pointsKwh = round2(rollup.pointsKwh + sale.pointsKwh);
      if (product) {
        // Comissão em centavos: soma inteira, sem arredondamento de float.
        rollup.estimatedCommission += estimateCommission(product.commissionRule, sale);
      }
    }
  }

  const byProduct = [...rollups.values()].sort((a, b) => b.pointsKwh - a.pointsKwh);

  return {
    byProduct,
    totalClosed: byProduct.reduce((acc, r) => acc + r.closedCount, 0),
    totalSales: byProduct.reduce((acc, r) => acc + r.totalCount, 0),
    totalPointsKwh: round2(byProduct.reduce((acc, r) => acc + r.pointsKwh, 0)),
    totalEstimatedCommission: byProduct.reduce((acc, r) => acc + r.estimatedCommission, 0),
  };
}

/** Filtra vendas por produto (ou retorna todas quando `all`). */
export function filterSalesByProduct(sales: Sale[], productId: string | "all"): Sale[] {
  if (productId === "all") return sales;
  return sales.filter((s) => s.productId === productId);
}

/** Filtra propostas por produto (ou retorna todas quando `all`). */
export function filterProposalsByProduct(
  proposals: Proposal[],
  productId: string | "all",
): Proposal[] {
  if (productId === "all") return proposals;
  return proposals.filter((p) => p.productId === productId);
}

/** Resume valor fechado, pipeline de orçamentos e comissão estimada (em centavos). */
export function computeFinancialMetrics(
  sales: Sale[],
  products: Product[],
  proposals: Proposal[] = [],
): FinancialSummary {
  let totalFechado = 0;

  for (const sale of sales) {
    if (sale.status !== "fechado") continue;
    totalFechado += sale.amountCents ?? 0;
  }

  let pipelineValue = 0;
  let proposalsPending = 0;
  let proposalsAccepted = 0;

  for (const proposal of proposals) {
    if (proposal.status === "accepted") proposalsAccepted += 1;
    if (!PENDING_PROPOSAL_STATUSES.includes(proposal.status)) continue;
    proposalsPending += 1;
    pipelineValue += proposal.amountCents ?? 0;
  }

  const { totalEstimatedCommission } = summarizeSales(sales, products);

  return {
    totalFechado,
    totalEstimatedCommission,
    pipelineValue,
    proposalsPending,
    proposalsAccepted,
  };
}

/** Arredonda para 2 casas — usado apenas para pontos kWh (não é dinheiro). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
