// =============================================================================
// Orçamento — Types
// =============================================================================
// Modelo da entidade `proposals` (migration 20260614100000_proposals.sql). Um
// orçamento tem vida própria: o consultor monta, envia por link público e o
// destinatário responde. A venda (sales) só nasce quando o cliente aceita.
// =============================================================================

export type ProposalStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "accepted"
  | "rejected"
  | "countered"
  | "expired";

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  viewed: "Visualizada",
  accepted: "Aceita",
  rejected: "Recusada",
  countered: "Proposta concorrente",
  expired: "Expirada",
};

export type ProposalEventType =
  | "created"
  | "sent"
  | "viewed"
  | "accepted"
  | "rejected"
  | "countered"
  | "consultant_reply"
  | "expired";

// Linha de detalhamento do orçamento (montada pelo catálogo comercial).
// Pode ser uma linha simples (label/value) OU uma forma de pagamento
// estruturada (kind: "payment"), usada em produtos com financiamento (Placas).
// As formas de pagamento são guardadas aqui dentro de propósito: o `line_items`
// já trafega pela edge function pública e já chega na página, então não exige
// migration nem novo deploy. A página pública separa os itens de pagamento dos
// detalhes comuns e os renderiza num bloco dedicado.
export interface ProposalLineItem {
  label: string;
  value: string;
  /** Marca este item como uma forma de pagamento (renderiza em bloco próprio). */
  kind?: "payment";
  /** Tipo da forma de pagamento. */
  method?: PaymentMethod;
  /** Banco/financeira (apenas financiamento). */
  bank?: string | null;
  /** Número de parcelas (cartão ou financiamento). */
  installments?: number | null;
  /** Valor de cada parcela em R$ (consultor digita). */
  installmentValue?: number | null;
  /** Juros informado pelo consultor (texto livre, ex.: "1,99% a.m."). */
  interest?: string | null;
  /** Marca a opção como recomendada/destaque. */
  highlight?: boolean;
}

// Forma de pagamento de uma proposta com financiamento (Placas).
export type PaymentMethod = "cash" | "card" | "financing";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "À vista",
  card: "Cartão de crédito",
  financing: "Financiamento",
};

// Bancos/financeiras principais para o consultor escolher (financiamento solar).
export const FINANCING_BANKS = [
  "BV Financeira",
  "Santander",
  "Sol Agora",
  "Banco do Brasil",
  "Caixa",
  "Sicredi",
  "Sicoob",
  "Bradesco",
  "Itaú",
  "Banco Inter",
  "Outro",
] as const;

// Forma de pagamento estruturada (entrada no builder, antes de virar lineItem).
export interface PaymentOption {
  method: PaymentMethod;
  /** À vista: valor total. Cartão/financiamento: opcional (informativo). */
  total?: number | null;
  bank?: string | null;
  installments?: number | null;
  installmentValue?: number | null;
  interest?: string | null;
  highlight?: boolean;
}

// ---------------------------------------------------------------------------
// Proposta normalizada para a aplicação (lado consultor).
// ---------------------------------------------------------------------------
export interface Proposal {
  id: string;
  publicToken: string;
  consultantId: string;
  productId: string;
  customerId: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  status: ProposalStatus;
  amount: number | null;
  amountPeriod: "month" | "once";
  discount: number | null;
  lineItems: ProposalLineItem[];
  message: string | null;
  validUntil: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
  saleId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Shape cru vindo do Supabase (snake_case).
export interface ProposalRow {
  id: string;
  public_token: string;
  consultant_id: string;
  product_id: string;
  customer_id: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  status: ProposalStatus;
  amount: number | null;
  amount_period: "month" | "once";
  discount: number | null;
  line_items: unknown;
  message: string | null;
  valid_until: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  sale_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalEvent {
  type: ProposalEventType;
  actor: "consultant" | "recipient" | "system";
  note: string | null;
  counterAmount: number | null;
  attachmentUrl: string | null;
  createdAt: string;
}

// Input para criar uma proposta (lado consultor).
export interface CreateProposalInput {
  consultantId: string;
  productId: string;
  customerId?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  amount: number;
  amountPeriod: "month" | "once";
  discount?: number | null;
  lineItems: ProposalLineItem[];
  message?: string | null;
  /** Dias até expirar (prazo). */
  validForDays: number;
}

// ---------------------------------------------------------------------------
// Dados de exibição da página pública (retornados por proposal-public-get).
// ---------------------------------------------------------------------------
export interface PublicProposalView {
  proposal: {
    token: string;
    status: ProposalStatus;
    amount: number | null;
    amountPeriod: "month" | "once";
    discount: number | null;
    lineItems: ProposalLineItem[];
    message: string | null;
    validUntil: string | null;
    sentAt: string | null;
    respondedAt: string | null;
    recipientName: string | null;
  };
  consultant: {
    name: string;
    photoUrl: string | null;
    igreenId: string | null;
  } | null;
  product: {
    slug: string;
    name: string;
    brandName: string;
    family: string;
  } | null;
  events: ProposalEvent[];
}
