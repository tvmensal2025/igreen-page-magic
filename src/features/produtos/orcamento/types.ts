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
  countered: "Contraproposta",
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
export interface ProposalLineItem {
  label: string;
  value: string;
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
  };
  consultant: {
    name: string;
    photoUrl: string | null;
    igreenId: string | null;
  } | null;
  product: {
    name: string;
    brandName: string;
    family: string;
  } | null;
  events: ProposalEvent[];
}
