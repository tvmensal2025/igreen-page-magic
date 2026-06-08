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

export interface RemoteCommand {
  id: string;
  kind: "navigate" | "click" | "fill" | "scrollTo" | "openTab" | "closeTab" | "reload" | "back" | "forward" | "ping";
  selector?: string;
  url?: string;
  value?: string;
  tabId?: number;
}

export interface CommandResult {
  id: string;
  ok: boolean;
  error?: string;
  data?: unknown;
}
