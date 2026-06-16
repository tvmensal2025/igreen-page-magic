// =============================================================================
// Orçamento — Cálculo de valor por família
// =============================================================================
// Funções puras (testáveis) que montam o valor do orçamento conforme a lógica
// comercial de cada família:
//   - plan_monthly:     mensalidade do plano escolhido
//   - project_once:     valor do projeto (à vista) + parcela de financiamento
//   - savings_estimate: economia estimada sobre a conta de luz informada
//   - market_free:      mercado livre de energia (até 30%, sem valor exato)
//   - none:             produto não orçável (ex.: Expansão) — sem valor
//
// Todos os valores monetários são tratados em CENTAVOS inteiros (convenção do
// helper money.ts): calcular em centavos e arredondar só no fim.
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
import { formatBRLFromCents } from "../lib/money";
import {
  PAYMENT_METHOD_LABEL,
  type PaymentOption,
  type ProposalLineItem,
} from "./types";

export interface QuoteAmount {
  /** Valor principal exibido na proposta, em centavos (inteiro). */
  amountCents: number;
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
  /**
   * Cliente faz portabilidade do número? (telecom). Quando `false`, usa o preço
   * `plan.meta.semPortabilidade`; quando `true`/ausente, usa `plan.price`.
   */
  portabilidade?: boolean;
  /** Valor do projeto à vista em centavos (placas). */
  projectAmountCents?: number;
  /** Conta de luz atual do cliente em centavos (energia). */
  currentBillCents?: number;
  /** Desconto aplicado (energia). Fração 0..1. Default usa o meio da faixa. */
  savingsRate?: number;
}

// Formata um valor em centavos como moeda BRL (reaproveita o helper de dinheiro).
const BRL = (cents: number) => formatBRLFromCents(cents);

/**
 * Resolve o preço do plano (em centavos) considerando a portabilidade. Telecom
 * tem dois preços: com portabilidade (`plan.price`, com +5GB) e sem portabilidade
 * (`plan.meta.semPortabilidade`). Quando `portabilidade` é `false` e o plano tem
 * o preço alternativo, usa-o; caso contrário, usa o preço padrão do plano.
 */
function resolvePlanPriceCents(plan: CommercialPlan | undefined, portabilidade?: boolean): number {
  if (!plan) return 0;
  if (portabilidade === false) {
    const sem = plan.meta?.semPortabilidade;
    if (typeof sem === "number") return sem;
  }
  return plan.price;
}

/** Calcula o valor do orçamento conforme a família e os dados informados. */
export function computeQuoteAmount(input: PlanPricingInput): QuoteAmount {
  // Com slug, o perfil do produto sobrepõe a família (Solar × Livre × Placas).
  const config = input.slug
    ? resolveCommercialConfig(input.slug, input.family)
    : getCommercialConfig(input.family);

  switch (config.pricingMode) {
    case "plan_monthly": {
      const priceCents = resolvePlanPriceCents(input.plan, input.portabilidade);
      const details: QuoteDetail[] = [];
      if (input.plan) {
        details.push({ label: "Plano", value: input.plan.label });
        // Telecom: deixa explícito se o preço considera ou não a portabilidade.
        if (input.portabilidade === false) {
          details.push({ label: "Portabilidade", value: "Sem portabilidade" });
        } else if (input.portabilidade === true) {
          details.push({ label: "Portabilidade", value: "Com portabilidade (+5GB)" });
        }
        for (const h of input.plan.highlights) {
          details.push({ label: "Incluso", value: h });
        }
      }
      return {
        amountCents: priceCents,
        period: "month",
        label: config.amountLabel,
        details,
      };
    }

    case "project_once": {
      const totalCents = input.projectAmountCents ?? 0;
      const details: QuoteDetail[] = [
        { label: "Valor do projeto", value: BRL(totalCents) },
      ];
      // O detalhamento de pagamento (à vista, cartão, financiamento) é montado
      // separadamente pelas formas de pagamento que o consultor digita no
      // builder (paymentOptionsToLineItems), então não duplicamos aqui.
      return {
        amountCents: totalCents,
        period: "once",
        label: config.amountLabel,
        details,
      };
    }

    case "savings_estimate": {
      const billCents = input.currentBillCents ?? 0;
      const [min, max] = config.savingsRange ?? [0.15, 0.2];
      const rate = input.savingsRate ?? (min + max) / 2;
      // Calcula em centavos e arredonda só no fim (convenção money.ts).
      const monthlySavingCents = Math.round(billCents * rate);
      const yearlySavingCents = monthlySavingCents * 12;
      return {
        amountCents: monthlySavingCents,
        period: "month",
        label: config.amountLabel,
        details: [
          { label: "Conta atual", value: BRL(billCents) },
          { label: "Desconto estimado", value: `${Math.round(rate * 100)}%` },
          { label: "Economia/mês", value: BRL(monthlySavingCents) },
          { label: "Economia/ano", value: BRL(yearlySavingCents) },
        ],
      };
    }

    case "market_free": {
      // Mercado livre (Conexão Livre): SEM valor fechado. O foco é a solução e
      // o teto de economia (até 30%). A estimativa exata vem da análise de
      // viabilidade da Comerc, então não fixamos um valor monetário aqui.
      const [, max] = config.savingsRange ?? [0.15, 0.3];
      return {
        amountCents: 0,
        period: "month",
        label: config.amountLabel,
        details: [
          { label: "Economia estimada", value: `até ${Math.round(max * 100)}%` },
          { label: "Modelo", value: "Mercado Livre de Energia (ACL)" },
          { label: "Análise de viabilidade", value: "Sem custo" },
        ],
      };
    }

    case "none":
      // Produto não orçável (ex.: Expansão): não gera valor nem detalhes. O
      // builder nem oferece orçamento para estes produtos (allowlist por slug).
      return { amountCents: 0, period: "month", label: config.amountLabel, details: [] };

    default:
      return { amountCents: 0, period: "month", label: config.amountLabel, details: [] };
  }
}

// ===========================================================================
// Formas de pagamento → line items
// ===========================================================================
// Converte as opções de pagamento digitadas pelo consultor (à vista, cartão,
// financiamento) em itens de proposta (kind: "payment"). A página pública lê
// esses itens e os exibe num bloco dedicado, separado dos detalhes comuns.
// Os valores monetários (`total`, `installmentValue`) trafegam em centavos.
export function paymentOptionsToLineItems(options: PaymentOption[]): ProposalLineItem[] {
  return options
    .filter((opt) => isPaymentOptionValid(opt))
    .map((opt) => {
      const label = PAYMENT_METHOD_LABEL[opt.method];
      let value: string;
      if (opt.method === "cash") {
        value = opt.total ? BRL(opt.total) : "À vista";
      } else {
        const n = opt.installments ?? 0;
        const parcela = opt.installmentValue ? BRL(opt.installmentValue) : "";
        value = n > 0 && parcela ? `${n}x de ${parcela}` : parcela || `${n}x`;
      }
      return {
        label,
        value,
        kind: "payment" as const,
        method: opt.method,
        bank: opt.bank ?? null,
        installments: opt.installments ?? null,
        installmentValue: opt.installmentValue ?? null,
        interest: opt.interest ?? null,
        highlight: opt.highlight ?? false,
      };
    });
}

/** Uma opção de pagamento é válida quando tem dados mínimos para exibir. */
export function isPaymentOptionValid(opt: PaymentOption): boolean {
  if (opt.method === "cash") return !!opt.total && opt.total > 0;
  // cartão/financiamento: precisa de parcelas e valor da parcela.
  return (
    !!opt.installments &&
    opt.installments > 0 &&
    !!opt.installmentValue &&
    opt.installmentValue > 0
  );
}
