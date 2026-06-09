// =============================================================================
// Remote Support — Types
// =============================================================================
// Todos os tipos compartilhados entre operador, requester e action handler.
// =============================================================================

export type SupportStatus =
  | "requested"
  | "pending_code"
  | "active"
  | "ended"
  | "rejected"
  | "expired";

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

// ---------------------------------------------------------------------------
// Viewport metadata — enviado pelo consultor via DataChannel logo após conectar.
// Permite ao operador mapear coordenadas com precisão mesmo em telas Retina/HiDPI
// ou quando o consultor compartilha uma janela de tamanho diferente do operador.
// ---------------------------------------------------------------------------
export interface RequesterViewport {
  /** window.innerWidth do consultor no momento do share */
  innerWidth: number;
  /** window.innerHeight do consultor */
  innerHeight: number;
  /** window.devicePixelRatio do consultor (ex: 2 em telas Retina) */
  dpr: number;
  /** displaySurface retornado pelo getDisplayMedia ("browser" | "window" | "monitor") */
  displaySurface: string | null;
}

// ---------------------------------------------------------------------------
// Comandos remotos
// ---------------------------------------------------------------------------
export type RemoteCommandKind =
  | "navigate"
  | "click"
  | "fill"
  | "scrollTo"
  | "openTab"
  | "closeTab"
  | "reload"
  | "back"
  | "forward"
  | "ping"
  // Controle direto por coordenadas (normalizadas 0..1 do viewport do consultor)
  | "mouseMove"
  | "mouseClick"
  | "mouseDblClick"
  | "mouseDown"
  | "mouseUp"
  | "contextMenu"
  | "wheel"
  | "key"
  | "type"
  // Controle de sessão
  | "qualityChange"
  // Metadados do requester enviados automaticamente ao conectar
  | "viewportInfo";

export interface RemoteCommand {
  id: string;
  kind: RemoteCommandKind;

  // Selector-based commands
  selector?: string;
  url?: string;
  value?: string;
  tabId?: number;

  /**
   * Coordenada normalizada (0..1) relativa ao viewport CSS do consultor.
   * Multiplicar por innerWidth/innerHeight do consultor = pixel CSS exato.
   */
  x?: number;
  y?: number;

  /** Scroll wheel deltas em pixels CSS (já normalizados para DOM_DELTA_PIXEL). */
  dx?: number;
  dy?: number;

  /** Botão do mouse (0 = esq, 1 = meio, 2 = dir). */
  button?: number;

  // Teclado
  key?: string;
  code?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;

  /** Payload do comando viewportInfo */
  viewport?: RequesterViewport;
}

export interface CommandResult {
  id: string;
  ok: boolean;
  error?: string;
  data?: unknown;
}
