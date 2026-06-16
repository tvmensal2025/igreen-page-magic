// =============================================================================
// Esteira de Acompanhamento — Tipos
// =============================================================================

export const SALES_ATTACHMENTS_BUCKET = "sales-attachments";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_ATTACHMENT_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type AllowedMime = (typeof ALLOWED_ATTACHMENT_MIMES)[number];

export const DEFAULT_TEMPLATE_STAGES = [
  "Foto e documentação",
  "Visita técnica",
  "Dimensionamento",
  "Contrato enviado",
];

export type StageStatus = "pendente" | "concluido";

// Linhas cruas (snake_case) -----------------------------------------------------
export interface TemplateRow {
  id: string;
  position: number;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StageProgressRow {
  id: string;
  sale_id: string;
  template_position: number;
  name_snapshot: string;
  status: StageStatus;
  note: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttachmentRow {
  id: string;
  sale_stage_id: string;
  storage_path: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

// Modelos da aplicação (camelCase) ---------------------------------------------
export interface StageTemplate {
  id: string;
  position: number;
  name: string;
  isActive: boolean;
}

export interface SaleStage {
  id: string;
  saleId: string;
  position: number;
  name: string;
  status: StageStatus;
  note: string | null;
  completedAt: string | null;
  completedBy: string | null;
}

export interface StageAttachment {
  id: string;
  stageId: string;
  storagePath: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
}

export interface UploadValidation {
  ok: boolean;
  reason?: "size" | "mime";
  message?: string;
}
