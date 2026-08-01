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

const POLL_MS_AUTH = 60_000;
const POLL_MS_DOWN = 30_000;
/** Falhas suaves seguidas antes de sair de AUTH (evita QR loop). */
const AUTH_STICKY_FAILS = 3;

/** Motivos que confirmam queda real do canal (pode abrir gate/QR). */
const HARD_DOWN_REASONS = new Set<string>([
  "unpaid",
  "invalid_token",
  "channel_not_found",
  "channel_error",
]);

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

function isHardDown(status: WhapiHealthStatus, reason: WhapiReasonCode): boolean {
  if (status === "QR") return true;
  if (status === "OFFLINE" && reason && HARD_DOWN_REASONS.has(reason)) return true;
  return false;
}

export function useWhapiHealth(enabled: boolean): WhapiHealth & {
  refresh: () => Promise<WhapiHealthStatus | null>;
} {
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
  /** Já confirmou AUTH nesta sessão — não demota por blip de rede. */
  const stickyAuthRef = useRef(false);
  const softFailRef = useRef(0);

  const refresh = useCallback(async (): Promise<WhapiHealthStatus | null> => {
    if (!enabled) return null;
    setHealth((h) => ({ ...h, checking: true, error: null }));
    try {
      const { data, error } = await supabase.functions.invoke("whapi-proxy", {
        body: { action: "health_check", payload: {} },
      });
      if (error) throw error;
      if (!mountedRef.current) return null;

      const nextStatus = normalize(data);
      const reasonCode = (data?.reasonCode ?? null) as WhapiReasonCode;
      let status = nextStatus;

      if (nextStatus === "AUTH") {
        stickyAuthRef.current = true;
        softFailRef.current = 0;
        status = "AUTH";
      } else if (stickyAuthRef.current) {
        if (isHardDown(nextStatus, reasonCode)) {
          stickyAuthRef.current = false;
          softFailRef.current = 0;
          status = nextStatus;
        } else {
          softFailRef.current += 1;
          if (softFailRef.current < AUTH_STICKY_FAILS) {
            // Mantém AUTH — falha transitória / INIT / rate limit.
            status = "AUTH";
          } else {
            stickyAuthRef.current = false;
            softFailRef.current = 0;
            status = nextStatus;
          }
        }
      } else {
        softFailRef.current = 0;
      }

      setHealth({
        status,
        statusCode: typeof data?.statusCode === "number" ? data.statusCode : null,
        statusText: data?.statusText ?? null,
        phone: data?.phone ?? null,
        channelId: data?.channel_id ?? null,
        webhookOk: typeof data?.webhook_ok === "boolean" ? data.webhook_ok : null,
        expectedWebhookUrl: data?.expected_webhook_url ?? null,
        checking: false,
        lastCheckedAt: Date.now(),
        error: null,
        reasonCode,
        reasonMessage: data?.reasonMessage ?? null,
        helpUrl: data?.helpUrl ?? null,
        deviceLikelyOffline: !!data?.device_likely_offline,
        outboundRecentCount: Number(data?.outbound_recent_count ?? 0),
        outboundPendingCount: Number(data?.outbound_pending_count ?? 0),
        outboundDeliveredCount: Number(data?.outbound_delivered_count ?? 0),
        lastOutboundAt: typeof data?.last_outbound_at === "number" ? data.last_outbound_at : null,
        lastOutboundStatus: data?.last_outbound_status ?? null,
      });
      return status;
    } catch (e: any) {
      if (!mountedRef.current) return null;
      // Rede/timeout: se já estava AUTH, não abre QR por um blip.
      if (stickyAuthRef.current) {
        softFailRef.current += 1;
        if (softFailRef.current < AUTH_STICKY_FAILS) {
          setHealth((h) => ({
            ...h,
            status: "AUTH",
            checking: false,
            lastCheckedAt: Date.now(),
            error: e?.message || "Falha ao consultar canal WhatsApp",
          }));
          return "AUTH";
        }
        stickyAuthRef.current = false;
        softFailRef.current = 0;
      }
      setHealth((h) => ({
        ...h,
        status: "OFFLINE",
        checking: false,
        lastCheckedAt: Date.now(),
        error: e?.message || "Falha ao consultar canal WhatsApp",
      }));
      return "OFFLINE";
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) {
      stickyAuthRef.current = false;
      softFailRef.current = 0;
      return () => {
        mountedRef.current = false;
      };
    }
    void refresh();
    // Intervalo adapta: AUTH = mais raro (menos carga); fora = 30s.
    let timer: ReturnType<typeof setInterval> | null = null;
    const arm = (ms: number) => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        void refresh().then((status) => {
          arm(status === "AUTH" ? POLL_MS_AUTH : POLL_MS_DOWN);
        });
      }, ms);
    };
    arm(POLL_MS_DOWN);
    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [enabled, refresh]);

  return { ...health, refresh };
}
