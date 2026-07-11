import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
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
  const [welcomeSentAt, setWelcomeSentAt] = useState<string | null>(null);
  const [trackingProtocol, setTrackingProtocol] = useState<string | null>(null);
  const [attendanceRatingRequestedAt, setAttendanceRatingRequestedAt] = useState<string | null>(null);
  const [attendanceRating, setAttendanceRating] = useState<number | null>(null);
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
      return;
    }
    // Colunas de avaliação podem ainda não existir no banco (migration pendente).
    // Fallback para select mínimo — nunca derruba a tela.
    let data: Record<string, unknown> | null = null;
    const full = await supabase
      .from("customers")
      .select("welcome_sent_at, tracking_protocol, attendance_rating_requested_at, attendance_rating")
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
    // Nome único por mount evita erro "cannot add postgres_changes callbacks
    // after subscribe()" quando StrictMode/remount reaproveita um channel já
    // subscribed com o mesmo nome.
    const channel = supabase.channel(
      `attendance-${customerId}-${Math.random().toString(36).slice(2, 10)}`,
    );
    channel.on(
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
      },
    );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [customerId]);

  const startAttendance = useCallback(async () => {
    if (!customerId || starting) return;
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke("start-customer-attendance", {
        body: { customerId, consultantId },
      });
      if (error) throw error;
      if (data?.ok === false) {
        toast({
          title: data?.fallback ? "Envie manualmente" : "Não deu pra iniciar",
          description: data?.message || data?.detail || data?.error || "Tente de novo.",
          variant: "destructive",
        });
        return;
      }
      setWelcomeSentAt(new Date().toISOString());
      if (data?.protocol) setTrackingProtocol(String(data.protocol));
      await refresh();
      toast({
        title: data?.skipped === "already_sent" ? "Atendimento já iniciado" : "Atendimento iniciado",
        description: data?.protocol ? `Protocolo ${data.protocol}` : undefined,
      });
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }, [customerId, consultantId, starting, toast, refresh]);

  const endAttendance = useCallback(async () => {
    if (!customerId || ending) return;
    setEnding(true);
    try {
      const { data, error } = await supabase.functions.invoke("end-customer-attendance", {
        body: { customerId, consultantId },
      });
      if (error) throw error;
      if (data?.ok === false) {
        toast({
          title: data?.fallback ? "Envie manualmente" : "Não deu pra finalizar",
          description: data?.message || data?.detail || data?.error || "Tente de novo.",
          variant: "destructive",
        });
        return;
      }
      setAttendanceRatingRequestedAt(new Date().toISOString());
      await refresh();
      toast({
        title:
          data?.skipped === "already_rated"
            ? "Avaliação já registrada"
            : data?.skipped === "rating_pending"
            ? "Pesquisa já enviada"
            : "Atendimento finalizado",
        description: data?.skipped ? undefined : "Pesquisa de 1 a 5 enviada ao cliente.",
      });
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setEnding(false);
    }
  }, [customerId, consultantId, ending, toast, refresh]);

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
