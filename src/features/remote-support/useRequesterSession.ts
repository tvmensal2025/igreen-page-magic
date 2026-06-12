// =============================================================================
// Remote Support — useRequesterSession (lado do consultor)
// =============================================================================
// Gerencia sessão ativa, escuta mudanças via Realtime, cuida do screen share
// e executa os comandos remotos recebidos pelo operador via DataChannel.
//
// Reconexão automática (v4):
//   - Quando o track de vídeo encerra inesperadamente (usuário fecha o seletor,
//     perde permissão, troca de aba, etc.) o hook tenta reconectar até
//     MAX_RECONNECT_ATTEMPTS vezes com backoff exponencial.
//   - Reconexão NÃO ocorre se:
//       • A sessão foi encerrada explicitamente pelo consultor (end()).
//       • A sessão foi encerrada pelo operador (status terminal via Realtime).
//       • Já atingiu o limite de tentativas.
//   - Em cada tentativa, mostra toast informativo ao usuário.
//   - Se o usuário cancela o seletor de tela (NotAllowedError), o hook para
//     de tentar reconectar e exibe uma mensagem de orientação.
// =============================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupportSession, RemoteCommand } from "./types";
import { requestSupport, endSession, rotateCode, logAction } from "./api";
import { createRequesterPeer, captureViewportInfo } from "./screenShare";
import { executeCommand, setActivePeerForQuality, setRemoteControlPaused } from "./actionHandler";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Status que indicam sessão finalizada (não requer limpeza do peer). */
const TERMINAL_STATUSES = ["ended", "rejected", "expired"] as const;

/** Máximo de tentativas de reconexão automática após queda do track. */
const MAX_RECONNECT_ATTEMPTS = 3;

/** Base do backoff exponencial em ms (1s, 2s, 4s). */
const RECONNECT_BASE_DELAY_MS = 1_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRequesterSession(userId: string | null | undefined) {
  const [session, setSession]             = useState<SupportSession | null>(null);
  const [code, setCode]                   = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [sharing, setSharing]             = useState(false);
  const [paused, setPausedState]          = useState(false);
  const [shareSurface, setShareSurface]   = useState<string | null>(null);
  const [reconnecting, setReconnecting]   = useState(false);

  const peerRef              = useRef<Awaited<ReturnType<typeof createRequesterPeer>> | null>(null);
  const sessionRef           = useRef<SupportSession | null>(null);
  /** true quando o encerramento foi intencional (end() ou status terminal). */
  const intentionalEndRef    = useRef(false);
  /** Contador de tentativas de reconexão consecutivas. */
  const reconnectAttemptsRef = useRef(0);
  /** Handle do timeout de reconexão — permite cancelar. */
  const reconnectTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Indica se está em processo de reconexão para evitar chamadas concorrentes. */
  const reconnectingRef      = useRef(false);

  // Mantém sessionRef sincronizada para uso em callbacks estáveis
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // -------------------------------------------------------------------------
  // Utilitário interno: limpa o peer atual
  // -------------------------------------------------------------------------
  const cleanupPeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    setActivePeerForQuality(null);
  }, []);

  // -------------------------------------------------------------------------
  // Utilitário interno: cancela reconexão agendada
  // -------------------------------------------------------------------------
  const cancelReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    setReconnecting(false);
  }, []);

  // -------------------------------------------------------------------------
  // Pausa / retomada de controle
  // -------------------------------------------------------------------------
  const togglePause = useCallback(() => {
    setPausedState(prev => {
      const next = !prev;
      setRemoteControlPaused(next);
      const s = sessionRef.current;
      if (s) logAction(s.id, "requester", next ? "control_paused" : "control_resumed").catch(() => {});
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
      .then(
        ({ data }) => {
          if (!cancelled && data) {
            setSession(data as unknown as SupportSession);
          }
        },
        (e) => console.warn("[remote-support] load session:", e),
      );

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
            if (sessionRef.current?.id === next.id) {
              // Operador encerrou — marca como intencional para não reconectar
              intentionalEndRef.current = true;
              cancelReconnect();
              cleanupPeer();
              setSession(null);
              setCode(null);
              setCodeExpiresAt(null);
              setSharing(false);
              setShareSurface(null);
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
  }, [userId, cancelReconnect, cleanupPeer]);

  // -------------------------------------------------------------------------
  // Broadcast: novo código quando operador aceita
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!session?.id) return;

    const ch = supabase.channel(`support:${session.id}:code`, {
      config: { private: true },
    });
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
  // Core: inicia (ou reconecta) o screen share
  // Retorna true em sucesso, false se o usuário cancelou (NotAllowed).
  // Lança em caso de erro não recuperável.
  // -------------------------------------------------------------------------
  const _doStartShare = useCallback(async (
    s: SupportSession,
    isReconnect: boolean,
  ): Promise<"ok" | "permission_denied" | "error"> => {
    try {
      const peer = await createRequesterPeer(
        s.id,
        // Executor de comandos recebidos pelo DataChannel
        async (msg, reply) => {
          try {
            const cmd = JSON.parse(msg) as RemoteCommand;
            const result = await executeCommand(s.id, cmd);
            reply(JSON.stringify(result));
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            reply(JSON.stringify({ id: "unknown", ok: false, error }));
          }
        },
        // onClose — track encerrada
        () => {
          cleanupPeer();
          setSharing(false);
          setShareSurface(null);
          logAction(s.id, "system", "screen_stopped").catch(() => {});

          // Não reconecta se foi encerramento intencional
          if (intentionalEndRef.current) return;

          // Sessão ainda ativa? Tenta reconectar com backoff
          const currentSession = sessionRef.current;
          if (!currentSession || currentSession.status !== "active") return;

          const attempt = reconnectAttemptsRef.current + 1;
          if (attempt > MAX_RECONNECT_ATTEMPTS) {
            console.warn("[remote-support] max reconnect attempts reached");
            setReconnecting(false);
            reconnectingRef.current = false;
            toast.error(
              "Compartilhamento encerrado. Clique em 'Compartilhar tela' para retomar.",
              { duration: 8_000 },
            );
            logAction(s.id, "system", "screen_reconnect_exhausted").catch(() => {});
            return;
          }

          reconnectAttemptsRef.current = attempt;
          reconnectingRef.current = true;
          setReconnecting(true);

          const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.info(`[remote-support] reconectando em ${delay}ms (tentativa ${attempt}/${MAX_RECONNECT_ATTEMPTS})`);
          toast(`Reconectando compartilhamento… (${attempt}/${MAX_RECONNECT_ATTEMPTS})`, {
            icon: "🔄",
            duration: delay + 1_000,
          });
          logAction(s.id, "system", "screen_reconnect_attempt", null, { attempt, delay }).catch(() => {});

          reconnectTimerRef.current = setTimeout(async () => {
            reconnectTimerRef.current = null;
            if (intentionalEndRef.current) return;
            const result = await _doStartShare(s, true);
            if (result === "ok") {
              reconnectAttemptsRef.current = 0;
              reconnectingRef.current = false;
              setReconnecting(false);
              toast.success("Reconexão bem-sucedida.");
            } else if (result === "permission_denied") {
              // Usuário cancelou o seletor durante reconexão — para de tentar
              reconnectAttemptsRef.current = 0;
              reconnectingRef.current = false;
              setReconnecting(false);
            }
            // "error" → o contador já foi incrementado; próximo onClose tentará de novo
          }, delay);
        },
        // onStage
        (stage, info) => {
          console.debug("[remote-support][rtc]", stage, info ?? "");
          if (stage === "connected") {
            logAction(s.id, "system", isReconnect ? "screen_reconnected" : "rtc_connected").catch(() => {});
          }
          if (stage === "failed") {
            logAction(s.id, "system", "rtc_failed", null, { info }).catch(() => {});
          }
        },
      );

      peerRef.current = peer;
      setActivePeerForQuality(peer.pc);
      setSharing(true);

      const vp = captureViewportInfo(peer.stream);
      setShareSurface(vp.displaySurface);

      await logAction(s.id, "requester", isReconnect ? "screen_reconnected" : "screen_started");

      if (!isReconnect) {
        toast.success("Compartilhando tela com o suporte");
      }

      return "ok";

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isPerm = /Permission|denied|NotAllowed|AbortError/i.test(msg);

      if (isPerm) {
        logAction(s.id, "system", "screen_permission_denied").catch(() => {});
        if (!isReconnect) {
          toast.error("Permissão negada. Clique em 'Compartilhar tela' e autorize o compartilhamento.");
        }
        return "permission_denied";
      }

      console.error("[remote-support] startShare error:", msg);
      return "error";
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupPeer]);

  // -------------------------------------------------------------------------
  // Actions públicas
  // -------------------------------------------------------------------------

  const request = useCallback(async () => {
    try {
      const s = await requestSupport();
      setSession(s);
      intentionalEndRef.current = false;
      toast.success("Pedido enviado ao suporte");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao pedir suporte";
      toast.error(msg);
    }
  }, []);

  const end = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;

    // Marca como intencional ANTES de qualquer limpeza
    intentionalEndRef.current = true;
    cancelReconnect();
    cleanupPeer();
    setSharing(false);
    setShareSurface(null);
    setPausedState(false);
    setRemoteControlPaused(false);

    try {
      await endSession(s.id, "requester_ended");
    } catch (e) {
      console.warn("[remote-support] endSession:", e);
    }

    setSession(null);
    setCode(null);
    setCodeExpiresAt(null);
  }, [cancelReconnect, cleanupPeer]);

  const startScreenShare = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || sharing || reconnectingRef.current) return;

    // Nova tentativa manual — reseta contadores
    intentionalEndRef.current = false;
    cancelReconnect();
    reconnectAttemptsRef.current = 0;

    const result = await _doStartShare(s, false);

    if (result === "error") {
      setSharing(false);
      toast.error("Falha ao iniciar compartilhamento. Tente novamente.");
    }
  }, [sharing, cancelReconnect, _doStartShare]);

  // -------------------------------------------------------------------------
  // Limpeza ao desmontar
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      intentionalEndRef.current = true;
      cancelReconnect();
      cleanupPeer();
    };
  }, [cancelReconnect, cleanupPeer]);

  return {
    session,
    code,
    codeExpiresAt,
    sharing,
    paused,
    shareSurface,
    reconnecting,
    togglePause,
    request,
    end,
    startScreenShare,
  };
}
