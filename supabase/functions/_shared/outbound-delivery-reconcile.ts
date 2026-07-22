/**
 * Reconcilia delivery_status de outbound via Whapi GET /messages/{id}
 * (e fallback /statuses/{id}).
 *
 * Doc Whapi: POST send sempre volta pending; ACK real vem por webhook
 * statuses ou poll GET. Pending eterno = JID inválido / sem Zap / soft ban.
 */

import { fetchWithTimeout, logStructured, TIMEOUT_WHAPI } from "./utils.ts";

export type DeliveryAck =
  | "pending"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "played"
  | "failed"
  | "unknown";

const ACK_RANK: Record<string, number> = {
  failed: 0,
  pending: 1,
  queued: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  played: 4,
};

export function mapWhapiDeliveryStatus(raw: unknown): DeliveryAck {
  const s = String(raw || "").toLowerCase().trim();
  if (!s) return "unknown";
  if (s === "failed" || s === "error" || s === "deleted") return "failed";
  if (s === "pending") return "pending";
  if (s === "queued" || s === "accepted") return "queued";
  if (s === "sent" || s === "server") return "sent";
  if (s === "delivered" || s === "delivery") return "delivered";
  if (s === "read" || s === "played" || s === "viewed") return "read";
  // códigos numéricos Whapi (failed=0 … read=4)
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n <= 0) return "failed";
    if (n === 1) return "pending";
    if (n === 2) return "sent";
    if (n === 3) return "delivered";
    if (n >= 4) return "read";
  }
  return "unknown";
}

export function shouldUpgradeDelivery(current: string | null, next: DeliveryAck): boolean {
  if (next === "unknown") return false;
  // failed sobrescreve pending/queued/sent (ACK negativo); não rebaixa delivered/read.
  if (next === "failed") {
    const s = String(current || "").toLowerCase();
    return s !== "delivered" && s !== "read" && s !== "played" && s !== "failed";
  }
  const cur = ACK_RANK[String(current || "").toLowerCase()] ?? -1;
  const nxt = ACK_RANK[next] ?? -1;
  return nxt > cur;
}

export function isTerminalDelivery(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return s === "delivered" || s === "read" || s === "played" || s === "failed";
}

export function isAckOk(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return s === "sent" || s === "delivered" || s === "read" || s === "played";
}

/** Poll Whapi: tenta /messages/{id} depois /statuses/{id}. */
export async function fetchWhapiMessageAck(
  apiToken: string,
  messageId: string,
  baseUrl = "https://gate.whapi.cloud",
): Promise<{ ok: true; status: DeliveryAck; raw?: unknown } | { ok: false; detail: string }> {
  const base = baseUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
  };
  const paths = [
    `/messages/${encodeURIComponent(messageId)}`,
    `/statuses/${encodeURIComponent(messageId)}`,
  ];
  let lastDetail = "";
  for (const path of paths) {
    try {
      const res = await fetchWithTimeout(`${base}${path}`, {
        method: "GET",
        headers,
        timeout: TIMEOUT_WHAPI,
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        lastDetail = `http_${res.status}:${text.slice(0, 120)}`;
        continue;
      }
      const rawStatus =
        data?.status ??
        data?.message?.status ??
        data?.statuses?.[0]?.status ??
        data?.code;
      const status = mapWhapiDeliveryStatus(rawStatus);
      if (status === "unknown" && !rawStatus) {
        lastDetail = "no_status_field";
        continue;
      }
      return { ok: true, status, raw: data };
    } catch (e) {
      lastDetail = (e as Error)?.message || String(e);
    }
  }
  return { ok: false, detail: lastDetail || "whapi_status_unreachable" };
}

export const RECONCILE_PENDING_STALE_MS = 15 * 60_000;
export const RECONCILE_MIN_AGE_MS = 2 * 60_000;
export const RECONCILE_MAX_AGE_MS = 48 * 60 * 60_000;

export function isPendingStale(createdAtIso: string, now = Date.now()): boolean {
  const t = Date.parse(createdAtIso);
  if (!Number.isFinite(t)) return false;
  return now - t >= RECONCILE_PENDING_STALE_MS;
}

export function logReconcile(action: string, extra: Record<string, unknown> = {}): void {
  logStructured("info", action, extra);
}
