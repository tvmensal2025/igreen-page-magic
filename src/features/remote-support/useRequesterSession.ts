// =============================================================================
// Remote Support — useRequesterSession (lado do consultor)
// =============================================================================
// Gerencia sessão ativa, escuta mudanças via Realtime, cuida do screen share
// e executa os comandos remotos recebidos pelo operador via DataChannel.
// =============================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupportSession, RemoteCommand } from "./types";
import { requestSupport, endSession, rotateCode, logAction } from "./api";
import { createRequesterPeer, captureViewportInfo } from "./screenShare";
import { executeCommand, setActivePeerForQuality, setRemoteControlPaused } from "./actionHandler";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Status de sessão que indicam encerramento
// ---------------------------------------------------------------------------
const TERMINAL_STATUSES = ["ended", "rejected", "expired"] as const;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRequesterSession(userId: string | null | undefined) {
  const [session, setSession]           = useState<SupportSession | null>(null);
  const [code, setCode]                 = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [sharing, setSharing]           = useState(false);
  const [paused, setPausedState]        = useState(false);
  const [shareSurface, setShareSurface] = useState<string | null>(null);

  const peerRef    = useRef<Awaited<ReturnType<typeof createRequesterPeer>> | null>(null);
  const sessionRef = useRef<SupportSession | null>(null);

  // Mantém ref sincronizada para usar em callbacks estáveis
  useEffect(() => { sessionRef.current = session; }, [session]);

  // -------------------------------------------------------------------------
  // Pausa / retomada de controle
  // -------------------------------------------------------------------------
  const togglePause = useCallback(() => {
    setPausedState(prev => {
      const next = !prev;
      setRemoteControlPaused(next);
      const s = sessionRef.current;
      if (s) logAction(s.id, "requester", next ? "control_paused" : "control_resumed");
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Carrega sessão ativa ao montar
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    supabase
      .from("remote_support_sessions" as "remote_support_sessions")
      .select("*")
      .eq("requester_id", userId)
      .in("status", ["requested", "pending_code", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) {
          setSession(data as unknown as SupportSession);
        }
      })
      .catch(e => console.warn("[remote-support] load session:", e));

    return () => { cancelled = true; };
  }, [userId]);

  // -------------------------------------------------------------------------
  // Realtime: mudanças na sessão
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!userId) return;

    const ch = supabase
      .channel(`requester:${userId}:sessions`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "remote_support_sessions",
          filter: `requester_id=eq.${userId}`,
        },
        (payload) => {
          const next = (payload.new ?? payload.old) as SupportSession | null;
          if (!next) return;

          const isTerminal = (TERMINAL_STATUSES as readonly string[]).includes(next.status);
          if (isTerminal) {
            // Só limpa se for a sessão atual
            if (sessionRef.current?.id === next.id) {
              setSession(null);
              setCode(null);
              setCodeExpiresAt(null);
              peerRef.current?.close();
              peerRef.current = null;
              setSharing(false);
              setPausedState(false);
              setRemoteControlPaused(false);
            }
          } else {
            setSession(next);
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // -------------------------------------------------------------------------
  // Broadcast: novo código quando operador aceita
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!session?.id) return;

    const ch = supabase.channel(`support:${session.id}:code`);
    ch
      .on("broadcast", { event: "new_code" }, ({ payload }) => {
        if (!payload?.code) return;
        setCode(payload.code as string);
        setCodeExpiresAt(new Date(payload.rotates_at as string).getTime());
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [session?.id]);

  // -------------------------------------------------------------------------
  // Auto-rotação do código a cada ~60s enquanto pending
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!session?.id || session.status !== "pending_code" || !codeExpiresAt) return;

    // Agenda 1s antes de expirar para evitar janela sem código
    const ms = Math.max(1_000, codeExpiresAt - Date.now() - 1_000);
    const t = setTimeout(async () => {
      try {
        const r = await rotateCode(session.id);
        setCode(r.code);
        setCodeExpiresAt(new Date(r.rotates_at).getTime());
      } catch (e) {
        console.warn("[remote-support] rotate code:", e);
      }
    }, ms);

    return () => clearTimeout(t);
  }, [session?.id, session?.status, codeExpiresAt]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const request = useCallback(async () => {
    try {
      const s = await requestSupport();
      setSession(s);
      toast.success("Pedido enviado ao suporte");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao pedir suporte";
      toast.error(msg);
    }
  }, []);

  const end = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      peerRef.current?.close();
      peerRef.current = null;
      setSharing(false);
      setPausedState(false);
      setRemoteControlPaused(false);
      await endSession(s.id, "requester_ended");
      setSession(null);
      setCode(null);
      setCodeExpiresAt(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao encerrar";
      toast.error(msg);
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || sharing) return;

    try {
      setSharing(true);

      const peer = await createRequesterPeer(
        s.id,
        // Executor de comandos recebidos pelo DataChannel
        async (msg, reply) => {
          try {
            const cmd = JSON.parse(msg) as RemoteCommand;

            // viewportInfo: o operador processa a resposta, mas o consultor
            // não precisa fazer nada além de ack.
            const result = await executeCommand(s.id, cmd);
            reply(JSON.stringify(result));
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            reply(JSON.stringify({ id: "unknown", ok: false, error }));
          }
        },
        // onClose
        () => {
          peerRef.current?.close();
          peerRef.current = null;
          setSharing(false);
          setPausedState(false);
          setRemoteControlPaused(false);
          logAction(s.id, "system", "screen_stopped").catch(() => {});
        },
        // onStage
        (stage, info) => {
          console.debug("[remote-support][rtc]", stage, info ?? "");
          if (stage === "connected") logAction(s.id, "system", "rtc_connected").catch(() => {});
          if (stage === "failed")    logAction(s.id, "system", "rtc_failed", null, { info }).catch(() => {});
        },
      );

      peerRef.current = peer;
      setActivePeerForQuality(peer.pc);

      // Captura e expõe o tipo de superfície compartilhada
      // 'browser' = aba atual → mapeamento pixel-a-pixel
      const vp = captureViewportInfo(peer.stream);
      setShareSurface(vp.displaySurface);

      await logAction(s.id, "requester", "screen_started");
      toast.success("Compartilhando tela com o suporte");

    } catch (e) {
      setSharing(false);
      const msg = e instanceof Error ? e.message : "Falha ao compartilhar tela";
      const isPerm = /Permission|denied|NotAllowed/i.test(msg);
      if (isPerm) {
        logAction(s.id, "system", "screen_permission_denied").catch(() => {});
        toast.error("Permissão negada. Clique em 'Compartilhar tela' novamente e autorize.");
      } else {
        toast.error(msg);
      }
    }
  }, [sharing]);

  return {
    session,
    code,
    codeExpiresAt,
    sharing,
    paused,
    shareSurface,
    togglePause,
    request,
    end,
    startScreenShare,
  };
}
