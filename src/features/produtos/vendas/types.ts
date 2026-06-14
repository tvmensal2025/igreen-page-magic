// =============================================================================
// Vendas — Types
// =============================================================================
// Modelo da entidade `sales` (migration 20260614091000_sales.sql). Uma venda
// liga um produto do catálogo a um consultor (e opcionalmente a um cliente),
// com pipeline próprio, pontos kWh-equivalente e dados de captura por família.
// =============================================================================

export type SaleStatus =
  | "lead"
  | "capturing"
  | "submitted"
  | "active"
  | "rejected"
  | "cancelled";

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  lead: "Interesse",
  capturing: "Em captura",
  submitted: "Enviada",
  active: "Ativa",
  rejected: "Reprovada",
  cancelled: "Cancelada",
};

// Ordem canônica do pipeline (para boards e progressão).
export const SALE_STATUS_ORDER: SaleStatus[] = [
  "lead",
  "capturing",
  "submitted",
  "active",
  "rejected",
  "cancelled",
];

// ---------------------------------------------------------------------------
// Dados de captura por família (espelham os schemas Zod do Bloco C).
// Mantidos como tipos abertos no nível da venda; a validação acontece na
// captura. Aqui só descrevem o shape esperado dentro de capture_data.
// ---------------------------------------------------------------------------
export interface TelecomCaptureData {
  plano?: string;
  portabilidade?: boolean;
  numero?: string;
  tipo_chip?: "fisico" | "esim";
}

export interface SegurosCaptureData {
  placa?: string;
  modelo?: string;
  ano?: number;
  plano?: string;
}

export interface PlacasCaptureData {
  consumo_kwh?: number;
  tipo_imovel?: "residencial" | "comercial" | "industrial" | "rural";
  financiamento?: boolean;
}

export type CaptureData =
  | TelecomCaptureData
  | SegurosCaptureData
  | PlacasCaptureData
  | Record<string, unknown>;

// ---------------------------------------------------------------------------
// Venda normalizada para a aplicação.
// ---------------------------------------------------------------------------
export interface Sale {
  id: string;
  consultantId: string;
  productId: string;
  customerId: string | null;
  status: SaleStatus;
  amount: number | null;
  pointsKwh: number;
  captureData: CaptureData;
  notes: string | null;
  submittedAt: string | null;
  activatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Shape cru vindo do Supabase (snake_case).
export interface SaleRow {
  id: string;
  consultant_id: string;
  product_id: string;
  customer_id: string | null;
  status: SaleStatus;
  amount: number | null;
  points_kwh: number;
  capture_data: unknown;
  notes: string | null;
  submitted_at: string | null;
  activated_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Input para criar uma venda.
export interface CreateSaleInput {
  consultantId: string;
  productId: string;
  customerId?: string | null;
  status?: SaleStatus;
  amount?: number | null;
  captureData?: CaptureData;
  notes?: string | null;
}
