// =============================================================================
// Orçamento — Cálculo de valor por família
// =============================================================================
// Funções puras (testáveis) que montam o valor do orçamento conforme a lógica
// comercial de cada família:
//   - plan_monthly:     mensalidade do plano escolhido
//   - project_once:     valor do projeto (à vista) + parcela de financiamento
//   - savings_estimate: economia estimada sobre a conta de luz informada
// =============================================================================

import type { ProductFamily } from "../catalogo/types";
import { getCommercialConfig, type CommercialPlan } from "./catalog";

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
  const config = getCommercialConfig(input.family);

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

    default:
      return { amount: 0, period: "month", label: config.amountLabel, details: [] };
  }
}
