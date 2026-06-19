// Presença do consultor — Supabase Realtime presence channel.
//
// Quando o consultor abre o painel admin, esse hook registra "consultor X está
// online" no canal `consultant-presence:{consultantId}`. O bot consulta antes
// de mandar dados de OCR pro cliente: se há ao menos um device do consultor
// presente, segura a confirmação por até 5 min pra ele revisar a foto + dados
// no painel. Se não há presença, segue automático (cliente confirma no chat).
//
// O canal também escreve na tabela `consultant_presence` (last_seen) para o
// edge function (que não tem WS) consultar via SELECT.

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const HEARTBEAT_MS = 45_000; // tabela `consultant_presence` é atualizada a cada 45s (reduz ~45% das chamadas vs. 25s)
const PRESENCE_TTL_MS = 90_000; // edge function considera presente se last_seen < 90s

export interface ConsultantPresenceState {
  isOnline: boolean;
  /** Quando true, o hook está ativo e mantendo heartbeat. */
  isTracking: boolean;
  /** Último timestamp em que enviamos heartbeat com sucesso. */
  lastHeartbeatAt: number | null;
}

export function useConsultantPresence(consultantId: string | null): ConsultantPresenceState {
  const [state, setState] = useState<ConsultantPresenceState>({
    isOnline: false,
    isTracking: false,
    lastHeartbeatAt: null,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Heartbeat: atualiza tabela `consultant_presence` periodicamente.
  // O edge function lê dessa tabela (não tem WebSocket pra ouvir o canal).
  const writeHeartbeat = useCallback(async () => {
    if (!consultantId) return;
    try {
      const now = new Date().toISOString();
      // `consultant_presence` é criada pela migração 20260522180000 — o
      // tipo gerado só fica disponível após `supabase gen types`. Cast do
      // client inteiro pra any aqui evita travar o build no intervalo
      // entre migration e typegen (runtime é igual; supabase-js valida).
      await (supabase as any)
        .from("consultant_presence")
        .upsert({
          consultant_id: consultantId,
          last_seen_at: now,
          updated_at: now,
        }, { onConflict: "consultant_id" });
      setState((s) => ({ ...s, isOnline: true, lastHeartbeatAt: Date.now() }));
    } catch (e) {
      // Falha silenciosa — presença é "best effort". Se falhar, edge function
      // assume ausente e segue o caminho automático.
      console.warn("[presence] heartbeat falhou", e);
    }
  }, [consultantId]);

  useEffect(() => {
    if (!consultantId) return;

    setState((s) => ({ ...s, isTracking: true }));

    // 1. Heartbeat inicial + intervalo.
    void writeHeartbeat();
    intervalRef.current = setInterval(() => { void writeHeartbeat(); }, HEARTBEAT_MS);

    // 2. Canal de presence — opcional, ajuda quando há múltiplos consultores
    //    no mesmo workspace (futuro).
    const channel = supabase.channel(`consultant-presence:${consultantId}`, {
      config: { presence: { key: consultantId } },
    });
    channel.on("presence", { event: "sync" }, () => {
      // qualquer state change do canal não muda nosso isOnline (que é apenas
      // local — refletindo o heartbeat na tabela).
    });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try { await channel.track({ online_at: new Date().toISOString() }); } catch (_) { /* noop */ }
      }
    });
    channelRef.current = channel;

    // 3. Quando aba fica oculta, marca presença ausente. Quando volta, reativa.
    const onVisibility = () => {
      if (document.hidden) {
        // Marca como ausente IMEDIATAMENTE ao trocar de aba.
        try {
          void (supabase as any)
            .from("consultant_presence")
            .upsert({
              consultant_id: consultantId,
              last_seen_at: new Date(0).toISOString(), // 1970 → vence o TTL
              updated_at: new Date().toISOString(),
            }, { onConflict: "consultant_id" });
        } catch { /* noop */ }
        setState((s) => ({ ...s, isOnline: false }));
      } else {
        void writeHeartbeat();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // 4. Cleanup: marca offline ao desmontar.
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      try { void channel.untrack(); } catch (_) { /* noop */ }
      try { void supabase.removeChannel(channel); } catch (_) { /* noop */ }
      // Beacon final: marca offline mesmo que a aba feche bruscamente.
      try {
        void (supabase as any)
          .from("consultant_presence")
          .upsert({
            consultant_id: consultantId,
            last_seen_at: new Date(0).toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "consultant_id" });
      } catch { /* noop */ }
      setState({ isOnline: false, isTracking: false, lastHeartbeatAt: null });
    };
  }, [consultantId, writeHeartbeat]);

  return state;
}

/** Constantes exportadas para uso pelo edge function (via SQL). */
export const PRESENCE_CONFIG = {
  HEARTBEAT_MS,
  PRESENCE_TTL_MS,
};
