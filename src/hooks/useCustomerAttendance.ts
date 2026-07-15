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
  const [trackingProtocol, setTrackingProtocol] = useState<string | null>(null);
  const [attendanceRatingRequestedAt, setAttendanceRatingRequestedAt] = useState<string | null>(null);
  const [attendanceRating, setAttendanceRating] = useState<number | null>(null);
  const [doNotContact, setDoNotContact] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  const uiState: AttendanceUiState = !welcomeSentAt
    ? "not_started"
    : attendanceRating != null
    ? "rated"
    : attendanceRatingRequestedAt
    ? "awaiting_rating"
    : "in_progress";

  const refresh = useCallback(async () => {
    if (!customerId) {
      setWelcomeSentAt(null);
      setTrackingProtocol(null);
      setAttendanceRatingRequestedAt(null);
      setAttendanceRating(null);
      setDoNotContact(false);
      return;
    }
    // Colunas de avaliação podem ainda não existir no banco (migration pendente).
    // Fallback para select mínimo — nunca derruba a tela.
    let data: Record<string, unknown> | null = null;
    const full = await supabase
      .from("customers")
      .select("welcome_sent_at, tracking_protocol, attendance_rating_requested_at, attendance_rating, do_not_contact")
      .eq("id", customerId)
      .maybeSingle();
    if (full.error) {
      const minimal = await supabase
        .from("customers")
        .select("welcome_sent_at, tracking_protocol, do_not_contact")
        .eq("id", customerId)
        .maybeSingle();
      data = (minimal.data as Record<string, unknown> | null) ?? null;
    } else {
      data = (full.data as Record<string, unknown> | null) ?? null;
    }
    setWelcomeSentAt((data?.welcome_sent_at as string | null | undefined) ?? null);
    setTrackingProtocol((data?.tracking_protocol as string | null | undefined) ?? null);
    setAttendanceRatingRequestedAt(
      (data?.attendance_rating_requested_at as string | null | undefined) ?? null,
    );
    const rating = data?.attendance_rating;
    setAttendanceRating(typeof rating === "number" ? rating : null);
    setDoNotContact(!!data?.do_not_contact);
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
            if ("do_not_contact" in row) {
              setDoNotContact(!!row.do_not_contact);
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

  const startAttendance = useCallback(async (opts?: { restart?: boolean }) => {
    if (!customerId || starting) return;
    if (doNotContact) {
      toast({
        title: "Lead em lista de não contato",
        description: "Não é possível iniciar atendimento. Revogue o opt-out se for o caso.",
        variant: "destructive",
      });
      return;
    }
    setStarting(true);
    const doInvoke = () => supabase.functions.invoke("start-customer-attendance", {
      body: { customerId, consultantId, restart: opts?.restart === true },
    });
    try {
      const { data, error } = await doInvoke();
      if (error && !data) throw error;
      const body = (data ?? {}) as Parameters<typeof notifyAttendanceOutcome>[0];
      notifyAttendanceOutcome(body, {
        kind: "start",
        navigate: go,
        onRetry: () => { void startAttendance(opts); },
      });
      if (body.ok !== false) {
        setWelcomeSentAt(new Date().toISOString());
        if (opts?.restart) {
          setAttendanceRating(null);
          setAttendanceRatingRequestedAt(null);
        }
        if (body.protocol) setTrackingProtocol(String(body.protocol));
        await refresh();
      }
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }, [customerId, consultantId, starting, toast, refresh, go, doNotContact]);

  const restartAttendance = useCallback(() => startAttendance({ restart: true }), [startAttendance]);

  const endAttendance = useCallback(async () => {
    if (!customerId || ending) return;
    if (doNotContact) {
      toast({
        title: "Lead em lista de não contato",
        description: "Não enviaremos pedido de nota nem mensagens de encerramento.",
        variant: "destructive",
      });
      return;
    }
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
        setAttendanceRatingRequestedAt(new Date().toISOString());
        await refresh();
      }
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setEnding(false);
    }
  }, [customerId, consultantId, ending, toast, refresh, go, doNotContact]);

  return {
    uiState,
    protocol: trackingProtocol,
    rating: attendanceRating,
    doNotContact,
    starting,
    ending,
    startAttendance,
    restartAttendance,
    endAttendance,
    refresh,
  };
}
