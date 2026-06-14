// =============================================================================
// Orçamento — Cálculo de valor por família
// =============================================================================
// Funções puras (testáveis) que montam o valor do orçamento conforme a lógica
// comercial de cada família:
//   - plan_monthly:     mensalidade do plano escolhido
//   - project_once:     valor do projeto (à vista) + parcela de financiamento
//   - savings_estimate: economia estimada sobre a conta de luz informada
//   - market_free:      mercado livre de energia (até 30%, sem valor exato)
//
// Quando o `slug` é informado, a config é resolvida via resolveCommercialConfig
// (perfil do slug sobrepõe a família). É o que permite Solar e Livre — ambos
// da família `energia` — se comportarem de formas diferentes.
// =============================================================================

import type { ProductFamily } from "../catalogo/types";
import {
  getCommercialConfig,
  resolveCommercialConfig,
  type CommercialPlan,
} from "./catalog";

export interface QuoteAmount {
  /** Valor principal exibido na proposta (R$). */
  amount: number;
  /** Periodicidade do valor principal. */
  period: "month" | "once";
  /** Rótulo do valor principal (ex.: "Mensalidade", "Economia estimada/mês"). */
  label: string;
  /** Linhas de detalhe para exibir na proposta. */
  details: QuoteDetail[];
}

export interface QuoteDetail {
  label: string;
  value: string;
}

export interface PlanPricingInput {
  family: ProductFamily;
  /** Slug do produto. Quando presente, resolve o perfil específico (Solar × Livre). */
  slug?: string;
  /** Plano escolhido (telecom, seguros, club). */
  plan?: CommercialPlan;
  /** Valor do projeto à vista (placas). */
  projectAmount?: number;
  /** Nº de parcelas de financiamento (placas). 0/undefined = à vista. */
  installments?: number;
  /** Conta de luz atual do cliente (energia). */
  currentBill?: number;
  /** Desconto aplicado (energia). Fração 0..1. Default usa o meio da faixa. */
  savingsRate?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Calcula o valor do orçamento conforme a família e os dados informados. */
export function computeQuoteAmount(input: PlanPricingInput): QuoteAmount {
  // Com slug, o perfil do produto sobrepõe a família (Solar × Livre × Placas).
  const config = input.slug
    ? resolveCommercialConfig(input.slug, input.family)
    : getCommercialConfig(input.family);

  switch (config.pricingMode) {
    case "plan_monthly": {
      const price = input.plan?.price ?? 0;
      const details: QuoteDetail[] = [];
      if (input.plan) {
        details.push({ label: "Plano", value: input.plan.label });
        for (const h of input.plan.highlights) {
          details.push({ label: "Incluso", value: h });
        }
      }
      return {
        amount: round2(price),
        period: "month",
        label: config.amountLabel,
        details,
      };
    }

    case "project_once": {
      const total = input.projectAmount ?? 0;
      const details: QuoteDetail[] = [
        { label: "Valor do projeto", value: BRL(round2(total)) },
      ];
      if (input.installments && input.installments > 1 && total > 0) {
        const parcela = round2(total / input.installments);
        details.push({
          label: "Financiamento",
          value: `${input.installments}x de ${BRL(parcela)}`,
        });
      } else {
        details.push({ label: "Pagamento", value: "À vista" });
      }
      return {
        amount: round2(total),
        period: "once",
        label: config.amountLabel,
        details,
      };
    }

    case "savings_estimate": {
      const bill = input.currentBill ?? 0;
      const [min, max] = config.savingsRange ?? [0.15, 0.2];
      const rate = input.savingsRate ?? (min + max) / 2;
      const monthlySaving = round2(bill * rate);
      const yearlySaving = round2(monthlySaving * 12);
      return {
        amount: monthlySaving,
        period: "month",
        label: config.amountLabel,
        details: [
          { label: "Conta atual", value: BRL(round2(bill)) },
          { label: "Desconto estimado", value: `${Math.round(rate * 100)}%` },
          { label: "Economia/mês", value: BRL(monthlySaving) },
          { label: "Economia/ano", value: BRL(yearlySaving) },
        ],
      };
    }

    case "market_free": {
      // Mercado livre (Conexão Livre): SEM valor fechado. O foco é a solução e
      // o teto de economia (até 30%). A estimativa exata vem da análise de
      // viabilidade da Comerc, então não fixamos um valor monetário aqui.
      const [, max] = config.savingsRange ?? [0.15, 0.3];
      return {
        amount: 0,
        period: "month",
        label: config.amountLabel,
        details: [
          { label: "Economia estimada", value: `até ${Math.round(max * 100)}%` },
          { label: "Modelo", value: "Mercado Livre de Energia (ACL)" },
          { label: "Análise de viabilidade", value: "Sem custo" },
        ],
      };
    }

    default:
      return { amount: 0, period: "month", label: config.amountLabel, details: [] };
  }
}
