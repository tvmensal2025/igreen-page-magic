export type SupportStatus = "requested" | "pending_code" | "active" | "ended" | "rejected" | "expired";

export interface SupportSession {
  id: string;
  requester_id: string;
  operator_id: string | null;
  status: SupportStatus;
  initiated_by: "requester" | "operator";
  started_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type RemoteCommandKind =
  | "navigate" | "click" | "fill" | "scrollTo"
  | "openTab" | "closeTab" | "reload" | "back" | "forward" | "ping"
  // Controle direto por coordenadas (normalizadas 0..1 do viewport do consultor)
  | "mouseMove" | "mouseClick" | "mouseDblClick" | "mouseDown" | "mouseUp"
  | "contextMenu" | "wheel" | "key" | "type";

export interface RemoteCommand {
  id: string;
  kind: RemoteCommandKind;
  selector?: string;
  url?: string;
  value?: string;
  tabId?: number;
  /** coordenada normalizada (0..1) em relação ao viewport do consultor */
  x?: number;
  y?: number;
  /** scroll wheel deltas em pixels */
  dx?: number;
  dy?: number;
  /** botão do mouse (0=esq, 1=meio, 2=dir) */
  button?: number;
  /** teclado */
  key?: string;
  code?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface CommandResult {
  id: string;
  ok: boolean;
  error?: string;
  data?: unknown;
}
