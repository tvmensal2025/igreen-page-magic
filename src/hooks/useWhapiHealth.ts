import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type WhapiHealthStatus = "AUTH" | "QR" | "INIT" | "OFFLINE" | "UNKNOWN";

export interface WhapiHealth {
  status: WhapiHealthStatus;
  phone: string | null;
  channelId: string | null;
  checking: boolean;
  lastCheckedAt: number | null;
  error: string | null;
}

const POLL_MS = 30_000;

function normalize(raw: any): WhapiHealthStatus {
  const s = String(raw?.status || "").toUpperCase();
  if (!raw?.ok) return "OFFLINE";
  if (s.includes("AUTH")) return "AUTH";
  if (s.includes("QR")) return "QR";
  if (s.includes("INIT") || s.includes("LAUNCH") || s.includes("STARTING")) return "INIT";
  if (!s) return "UNKNOWN";
  return s as WhapiHealthStatus;
}

export function useWhapiHealth(enabled: boolean): WhapiHealth & { refresh: () => Promise<void> } {
  const [health, setHealth] = useState<WhapiHealth>({
    status: "UNKNOWN",
    phone: null,
    channelId: null,
    checking: false,
    lastCheckedAt: null,
    error: null,
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
        phone: data?.phone ?? null,
        channelId: data?.channel_id ?? null,
        checking: false,
        lastCheckedAt: Date.now(),
        error: null,
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
