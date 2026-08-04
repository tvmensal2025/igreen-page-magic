export interface WhatsAppInstance {
  id: string;
  consultant_id: string;
  instance_name: string;
  created_at: string;
}

export type TemplateMediaType = "text" | "image" | "audio" | "video" | "document";

/**
 * Item de um template multi-arquivo (tabela template_items).
 * Um template pode ter vários itens ordenados por `position`.
 */
export interface TemplateItem {
  id?: string;
  template_id?: string;
  position: number;
  message_type: TemplateMediaType;
  message_text: string | null;
  media_url: string | null;
  image_url: string | null;
  delay_seconds: number;
  /**
   * Identidade estável apenas para a UI (React key) de itens ainda não salvos.
   * Nunca é persistido: o gravador em useTemplates monta as linhas campo a campo.
   */
  _uiKey?: string;
}

export interface MessageTemplate {
  id: string;
  consultant_id: string;
  name: string;
  content: string;
  media_type: TemplateMediaType;
  media_url: string | null;
  image_url: string | null;
  created_at: string;
  origin_template_id?: string | null;
  shortcut?: string | null;
  is_quick_reply?: boolean;
  is_public?: boolean;
  /** Itens ordenados (multi-arquivo). Quando ausente, usa media_url/image_url (legado). */
  items?: TemplateItem[];
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface BulkSendProgress {
  total: number;
  sent: number;
  failed: number;
  inProgress: boolean;
}

export interface BulkContact {
  id: string;
  name: string;
  phone: string;
  electricity_bill_value?: number;
  city?: string;
  source: "database" | "pasted" | "imported";
}

export interface BlockConfig {
  blockSize: 10 | 20 | 30 | 40 | 50;
  intervalMinutes: 5 | 10 | 15 | 30 | 60;
}

export interface BlockProgress {
  currentBlock: number;
  totalBlocks: number;
  sentInBlock: number;
  failedInBlock: number;
  totalSent: number;
  totalFailed: number;
  totalContacts: number;
  isPaused: boolean;
  isWaitingBetweenBlocks: boolean;
  blockCountdown: number;
  messageCountdown: number;
}
