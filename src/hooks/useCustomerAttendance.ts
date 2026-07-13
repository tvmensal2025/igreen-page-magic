import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { notifyAttendanceOutcome } from "@/lib/attendanceShortcut";
import type { AttendanceUiState } from "@/components/whatsapp/AttendanceStatusBar";

/**
 * Estado + ações do atendimento profissional (protocolo + pesquisa 1–5).
 * Compartilhado entre WhatsApp (ChatView) e Captação (CaptacaoPanel).
 */
export function useCustomerAttendance(
  customerId: string | null | undefined,
  consultantId: string,
) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const go = useCallback((path: string) => { if (path) navigate(path); }, [navigate]);
  const mountIdRef = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [welcomeSentAt, setWelcomeSentAt] = useState<string | null>(null);
  const [attendanceEndedAt, setAttendanceEndedAt] = useState<string | null>(null);
  const [trackingProtocol, setTrackingProtocol] = useState<string | null>(null);
  const [attendanceRatingRequestedAt, setAttendanceRatingRequestedAt] = useState<string | null>(null);
  const [attendanceRating, setAttendanceRating] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  // Após finalizar (attendance_ended_at), lead volta a poder iniciar — exceto
  // enquanto a nota 1–5 ainda está pendente.
  const uiState: AttendanceUiState = !welcomeSentAt
    ? "not_started"
    : attendanceRatingRequestedAt && attendanceRating == null
    ? "awaiting_rating"
    : attendanceEndedAt || attendanceRating != null
    ? "not_started"
    : "in_progress";

  const refresh = useCallback(async () => {
    if (!customerId) {
      setWelcomeSentAt(null);
      setAttendanceEndedAt(null);
      setTrackingProtocol(null);
      setAttendanceRatingRequestedAt(null);
      setAttendanceRating(null);
      return;
    }
    // Colunas de avaliação podem ainda não existir no banco (migration pendente).
    // Fallback para select mínimo — nunca derruba a tela.
    let data: Record<string, unknown> | null = null;
    const full = await supabase
      .from("customers")
      .select("welcome_sent_at, attendance_ended_at, tracking_protocol, attendance_rating_requested_at, attendance_rating")
      .eq("id", customerId)
      .maybeSingle();
    if (full.error) {
      const minimal = await supabase
        .from("customers")
        .select("welcome_sent_at, tracking_protocol")
        .eq("id", customerId)
        .maybeSingle();
      data = (minimal.data as Record<string, unknown> | null) ?? null;
    } else {
      data = (full.data as Record<string, unknown> | null) ?? null;
    }
    setWelcomeSentAt((data?.welcome_sent_at as string | null | undefined) ?? null);
    setAttendanceEndedAt((data?.attendance_ended_at as string | null | undefined) ?? null);
    setTrackingProtocol((data?.tracking_protocol as string | null | undefined) ?? null);
    setAttendanceRatingRequestedAt(
      (data?.attendance_rating_requested_at as string | null | undefined) ?? null,
    );
    const rating = data?.attendance_rating;
    setAttendanceRating(typeof rating === "number" ? rating : null);
  }, [customerId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, refresh]);

  useEffect(() => {
    if (!customerId) return;
    const topic = `attendance:${customerId}:${mountIdRef.current}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "customers",
            filter: `id=eq.${customerId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown> | null;
            if (!row) return;
            if ("welcome_sent_at" in row) {
              setWelcomeSentAt((row.welcome_sent_at as string | null) ?? null);
            }
            if ("attendance_ended_at" in row) {
              setAttendanceEndedAt((row.attendance_ended_at as string | null) ?? null);
            }
            if ("tracking_protocol" in row) {
              setTrackingProtocol((row.tracking_protocol as string | null) ?? null);
            }
            if ("attendance_rating_requested_at" in row) {
              setAttendanceRatingRequestedAt(
                (row.attendance_rating_requested_at as string | null) ?? null,
              );
            }
            if ("attendance_rating" in row) {
              const r = row.attendance_rating;
              setAttendanceRating(typeof r === "number" ? r : null);
            }
          },
        );
      channel.subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          void refresh();
        }
      });
    } catch (error) {
      // Realtime é melhoria de UX; nunca pode derrubar a tela do WhatsApp.
      console.warn("[attendance] realtime subscription skipped", error);
    }

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [customerId, refresh]);

  const startAttendance = useCallback(async () => {
    if (!customerId || starting) return;
    setStarting(true);
    const doInvoke = () => supabase.functions.invoke("start-customer-attendance", {
      body: { customerId, consultantId },
    });
    try {
      const { data, error } = await doInvoke();
      if (error && !data) throw error;
      const body = (data ?? {}) as Parameters<typeof notifyAttendanceOutcome>[0];
      notifyAttendanceOutcome(body, {
        kind: "start",
        navigate: go,
        onRetry: () => { void startAttendance(); },
      });
      if (body.ok !== false) {
        setWelcomeSentAt(new Date().toISOString());
        setAttendanceEndedAt(null);
        setAttendanceRatingRequestedAt(null);
        setAttendanceRating(null);
        if (body.protocol) setTrackingProtocol(String(body.protocol));
        await refresh();
      }
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }, [customerId, consultantId, starting, toast, refresh, go]);

  const endAttendance = useCallback(async () => {
    if (!customerId || ending) return;
    setEnding(true);
    const doInvoke = () => supabase.functions.invoke("end-customer-attendance", {
      body: { customerId, consultantId },
    });
    try {
      const { data, error } = await doInvoke();
      if (error && !data) throw error;
      const body = (data ?? {}) as Parameters<typeof notifyAttendanceOutcome>[0];
      notifyAttendanceOutcome(body, {
        kind: "end",
        navigate: go,
        onRetry: () => { void endAttendance(); },
      });
      if (body.ok !== false) {
        setAttendanceEndedAt(new Date().toISOString());
        setAttendanceRatingRequestedAt(new Date().toISOString());
        await refresh();
        try {
          window.dispatchEvent(new CustomEvent("captacao:batch-finished"));
        } catch { /* ignore */ }
      }
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setEnding(false);
    }
  }, [customerId, consultantId, ending, toast, refresh, go]);

  return {
    uiState,
    protocol: trackingProtocol,
    rating: attendanceRating,
    starting,
    ending,
    startAttendance,
    endAttendance,
    refresh,
  };
}
