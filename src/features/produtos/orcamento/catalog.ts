// =============================================================================
// Orçamento — Catálogo comercial por família de produto
// =============================================================================
// Cada família de produto tem uma lógica comercial diferente para o orçamento:
//   - telecom:  planos fixos (mensalidade), com/sem portabilidade
//   - seguros:  planos de proteção veicular (mensalidade por faixa)
//   - placas:   venda de sistema fotovoltaico (valor do projeto + financiamento)
//   - energia:  estimativa de economia na conta de luz (% sobre a conta)
//   - club:     mensalidade do clube de benefícios
//   - expansao: oportunidade de licenciamento (sem orçamento ao cliente)
//
// Este catálogo descreve PLANOS/PREÇOS de referência e como montar o valor do
// orçamento. Os números são valores de tabela públicos (planos iGreen Telecom,
// faixas de proteção veicular) e servem de ponto de partida — o consultor pode
// ajustar o valor final na proposta.
// =============================================================================

import type { ProductFamily } from "../catalogo/types";

// ---------------------------------------------------------------------------
// Plano comercial (item selecionável no orçamento).
// ---------------------------------------------------------------------------
export interface CommercialPlan {
  /** Identificador estável do plano. */
  id: string;
  /** Nome exibido. */
  label: string;
  /** Mensalidade de referência (R$). Para placas é o valor à vista do projeto. */
  price: number;
  /** Periodicidade do preço. */
  period: "month" | "once";
  /** Destaques do plano (bullets na proposta). */
  highlights: string[];
  /** Metadados específicos (ex.: dados do plano telecom). */
  meta?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Como o valor do orçamento é montado para cada família.
//   - plan_monthly: mensalidade do plano escolhido (telecom, seguros, club)
//   - project_once: valor único do projeto (placas), com financiamento opcional
//   - savings_estimate: estimativa de economia sobre a conta de luz (energia)
// ---------------------------------------------------------------------------
export type PricingMode = "plan_monthly" | "project_once" | "savings_estimate";

export interface FamilyCommercialConfig {
  family: ProductFamily;
  pricingMode: PricingMode;
  /** Rótulo do valor principal exibido na proposta. */
  amountLabel: string;
  /** Planos de referência (vazio quando o valor é livre/estimado). */
  plans: CommercialPlan[];
  /** Texto curto explicando a lógica comercial (aparece no builder). */
  commercialNote: string;
  /** % de desconto estimado na conta (apenas energia). [min, max] */
  savingsRange?: [number, number];
}

// ─── Telecom (planos oficiais iGreen Telecom) ───────────────────────────────
const TELECOM_PLANS: CommercialPlan[] = [
  {
    id: "start",
    label: "Start — 11GB",
    price: 54.9,
    period: "month",
    highlights: [
      "6GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "11GB", semPortabilidade: 59.9 },
  },
  {
    id: "mega",
    label: "Mega — 15GB",
    price: 59.9,
    period: "month",
    highlights: [
      "10GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "15GB", semPortabilidade: 64.9 },
  },
  {
    id: "giga",
    label: "Giga — 20GB",
    price: 69.9,
    period: "month",
    highlights: [
      "15GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "20GB", semPortabilidade: 74.9 },
  },
  {
    id: "ultra",
    label: "Ultra — 28GB",
    price: 79.9,
    period: "month",
    highlights: [
      "23GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "28GB", semPortabilidade: 84.9 },
  },
  {
    id: "infinity",
    label: "Infinity — 50GB",
    price: 99.9,
    period: "month",
    highlights: [
      "45GB + 5GB na portabilidade",
      "Ligações e WhatsApp ilimitados",
      "Internet acumulada + iGreen Club grátis",
    ],
    meta: { dados: "50GB", semPortabilidade: 104.9 },
  },
];

// ─── Seguros (faixas de proteção veicular) ──────────────────────────────────
const SEGUROS_PLANS: CommercialPlan[] = [
  {
    id: "basic",
    label: "Basic",
    price: 99,
    period: "month",
    highlights: [
      "Roubo, furto e assistência 24h",
      "Guincho até 200km",
      "Carro reserva por 7 dias",
    ],
  },
  {
    id: "premium",
    label: "Premium",
    price: 149,
    period: "month",
    highlights: [
      "Tudo do Basic + colisão, incêndio e vidros",
      "Guincho ilimitado",
      "Proteção de retrovisores",
    ],
  },
  {
    id: "infinite",
    label: "Infinite",
    price: 199,
    period: "month",
    highlights: [
      "Tudo do Premium + cobertura a terceiros",
      "Carro reserva por 30 dias",
      "Proteção de acessórios e desconto em estacionamentos",
    ],
  },
];

// ─── Club (mensalidade do clube de benefícios) ──────────────────────────────
const CLUB_PLANS: CommercialPlan[] = [
  {
    id: "club-pf",
    label: "iGreen Club",
    price: 29.9,
    period: "month",
    highlights: [
      "Descontos em +30 mil lojas",
      "Cashback em compras",
      "Cinema, farmácias e restaurantes",
    ],
  },
];

// ─── Mapa família → configuração comercial ──────────────────────────────────
export const FAMILY_COMMERCIAL: Record<ProductFamily, FamilyCommercialConfig> = {
  telecom: {
    family: "telecom",
    pricingMode: "plan_monthly",
    amountLabel: "Mensalidade",
    plans: TELECOM_PLANS,
    commercialNote:
      "Plano mensal sem fidelidade. Com portabilidade o cliente ganha +5GB e mantém o número.",
  },
  seguros: {
    family: "seguros",
    pricingMode: "plan_monthly",
    amountLabel: "Mensalidade",
    plans: SEGUROS_PLANS,
    commercialNote:
      "Proteção veicular mensal. O valor final pode variar conforme o veículo informado na captura.",
  },
  club: {
    family: "club",
    pricingMode: "plan_monthly",
    amountLabel: "Mensalidade",
    plans: CLUB_PLANS,
    commercialNote: "Clube de benefícios com cashback e descontos. Cobrança mensal recorrente.",
  },
  placas: {
    family: "placas",
    pricingMode: "project_once",
    amountLabel: "Valor do projeto",
    plans: [],
    commercialNote:
      "Venda de sistema fotovoltaico. Informe o valor do projeto (à vista) e, se houver, a opção de financiamento em até 120x.",
  },
  energia: {
    family: "energia",
    pricingMode: "savings_estimate",
    amountLabel: "Economia estimada/mês",
    plans: [],
    commercialNote:
      "Energia por assinatura sem custo de adesão. O orçamento mostra a economia estimada sobre a conta de luz atual do cliente.",
    savingsRange: [0.15, 0.2],
  },
  expansao: {
    family: "expansao",
    pricingMode: "plan_monthly",
    amountLabel: "Investimento",
    plans: [],
    commercialNote:
      "Oportunidade de licenciamento — não gera orçamento ao cliente final. Use a landing de Expansão.",
  },
};

/** Retorna a configuração comercial de uma família. */
export function getCommercialConfig(family: ProductFamily): FamilyCommercialConfig {
  return FAMILY_COMMERCIAL[family];
}
