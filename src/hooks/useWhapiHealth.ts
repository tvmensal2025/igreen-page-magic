import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type WhapiHealthStatus = "AUTH" | "QR" | "INIT" | "OFFLINE" | "UNKNOWN";

export type WhapiReasonCode =
  | "unpaid"
  | "channel_not_found"
  | "invalid_token"
  | "channel_error"
  | "offline"
  | "rate_limited"
  | "unknown"
  | null;

export interface WhapiHealth {
  status: WhapiHealthStatus;
  statusCode: number | null;
  statusText: string | null;
  phone: string | null;
  channelId: string | null;
  webhookOk: boolean | null;
  expectedWebhookUrl: string | null;
  checking: boolean;
  lastCheckedAt: number | null;
  error: string | null;
  reasonCode: WhapiReasonCode;
  reasonMessage: string | null;
  helpUrl: string | null;
  // Presença do device físico (celular)
  deviceLikelyOffline: boolean;
  outboundRecentCount: number;
  outboundPendingCount: number;
  outboundDeliveredCount: number;
  lastOutboundAt: number | null;
  lastOutboundStatus: string | null;
}

const POLL_MS = 30_000;

function normalize(raw: any): WhapiHealthStatus {
  const s = String(raw?.status || "").toUpperCase();
  if (!raw?.ok && !s) return "OFFLINE";
  if (s === "AUTH") return "AUTH";
  if (s === "QR") return "QR";
  if (s === "INIT" || s === "LAUNCH" || s === "STARTING" || s === "SYNC") return "INIT";
  if (s === "OFFLINE" || s === "ERROR") return "OFFLINE";
  if (!s) return "UNKNOWN";
  return "UNKNOWN";
}

export function useWhapiHealth(enabled: boolean): WhapiHealth & { refresh: () => Promise<void> } {
  const [health, setHealth] = useState<WhapiHealth>({
    status: "UNKNOWN",
    statusCode: null,
    statusText: null,
    phone: null,
    channelId: null,
    webhookOk: null,
    expectedWebhookUrl: null,
    checking: false,
    lastCheckedAt: null,
    error: null,
    reasonCode: null,
    reasonMessage: null,
    helpUrl: null,
    deviceLikelyOffline: false,
    outboundRecentCount: 0,
    outboundPendingCount: 0,
    outboundDeliveredCount: 0,
    lastOutboundAt: null,
    lastOutboundStatus: null,
  });
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setHealth((h) => ({ ...h, checking: true, error: null }));
    try {
      const { data, error } = await supabase.functions.invoke("whapi-proxy", {
        body: { action: "health_check", payload: {} },
      });
      if (error) throw error;
      if (!mountedRef.current) return;
      setHealth({
        status: normalize(data),
        statusCode: typeof data?.statusCode === "number" ? data.statusCode : null,
        statusText: data?.statusText ?? null,
        phone: data?.phone ?? null,
        channelId: data?.channel_id ?? null,
        webhookOk: typeof data?.webhook_ok === "boolean" ? data.webhook_ok : null,
        expectedWebhookUrl: data?.expected_webhook_url ?? null,
        checking: false,
        lastCheckedAt: Date.now(),
        error: null,
        reasonCode: (data?.reasonCode ?? null) as WhapiReasonCode,
        reasonMessage: data?.reasonMessage ?? null,
        helpUrl: data?.helpUrl ?? null,
        deviceLikelyOffline: !!data?.device_likely_offline,
        outboundRecentCount: Number(data?.outbound_recent_count ?? 0),
        outboundPendingCount: Number(data?.outbound_pending_count ?? 0),
        outboundDeliveredCount: Number(data?.outbound_delivered_count ?? 0),
        lastOutboundAt: typeof data?.last_outbound_at === "number" ? data.last_outbound_at : null,
        lastOutboundStatus: data?.last_outbound_status ?? null,
      });
    } catch (e: any) {
      if (!mountedRef.current) return;
      setHealth((h) => ({
        ...h,
        status: "OFFLINE",
        checking: false,
        lastCheckedAt: Date.now(),
        error: e?.message || "Falha ao consultar canal Whapi",
      }));
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return () => { mountedRef.current = false; };
    void refresh();
    const t = setInterval(() => { void refresh(); }, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(t);
    };
  }, [enabled, refresh]);

  return { ...health, refresh };
}

