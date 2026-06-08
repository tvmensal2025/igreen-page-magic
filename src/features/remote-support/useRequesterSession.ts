import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupportSession } from "./types";
import { requestSupport, endSession, rotateCode, logAction } from "./api";
import { createRequesterPeer } from "./screenShare";
import { executeCommand } from "./actionHandler";
import type { RemoteCommand } from "./types";
import { toast } from "sonner";

/**
 * Hook do consultor: gerencia a sessão de suporte ativa, escuta novas sessões iniciadas pelo
 * operador, recebe códigos de autorização e cuida do screen share.
 */
export function useRequesterSession(userId: string | null | undefined) {
  const [session, setSession] = useState<SupportSession | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const peerRef = useRef<Awaited<ReturnType<typeof createRequesterPeer>> | null>(null);

  // Load latest active/pending session on mount
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from("remote_support_sessions" as any)
        .select("*")
        .eq("requester_id", userId)
        .in("status", ["requested", "pending_code", "active"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setSession(data as unknown as SupportSession);
    })();
  }, [userId]);

  // Realtime: subscribe to changes on my sessions
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`requester:${userId}:sessions`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "remote_support_sessions",
        filter: `requester_id=eq.${userId}`,
      }, (payload) => {
        const next = (payload.new ?? payload.old) as SupportSession;
        if (!next) return;
        if (["ended", "rejected", "expired"].includes(next.status)) {
          if (session?.id === next.id) {
            setSession(null); setCode(null); setCodeExpiresAt(null);
            peerRef.current?.close(); peerRef.current = null; setSharing(false);
          }
        } else {
          setSession(next);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, session?.id]);

  // Listen for code broadcast (when operator accepts)
  useEffect(() => {
    if (!session?.id) return;
    const ch = supabase.channel(`support:${session.id}:code`);
    ch.on("broadcast", { event: "new_code" }, ({ payload }) => {
      setCode(payload.code);
      setCodeExpiresAt(new Date(payload.rotates_at).getTime());
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session?.id]);

  // Auto-rotate code every 60s while pending
  useEffect(() => {
    if (!session?.id || session.status !== "pending_code" || !codeExpiresAt) return;
    const ms = Math.max(1000, codeExpiresAt - Date.now() - 1000);
    const t = setTimeout(async () => {
      try {
        const r = await rotateCode(session.id);
        setCode(r.code);
        setCodeExpiresAt(new Date(r.rotates_at).getTime());
      } catch (e) { console.warn(e); }
    }, ms);
    return () => clearTimeout(t);
  }, [session?.id, session?.status, codeExpiresAt]);

  const request = useCallback(async () => {
    try {
      const s = await requestSupport();
      setSession(s);
      toast.success("Pedido enviado ao suporte");
    } catch (e: any) {
      toast.error(e.message || "Falha ao pedir suporte");
    }
  }, []);

  const end = useCallback(async () => {
    if (!session) return;
    try {
      peerRef.current?.close(); peerRef.current = null; setSharing(false);
      await endSession(session.id, "requester_ended");
      setSession(null); setCode(null); setCodeExpiresAt(null);
    } catch (e: any) {
      toast.error(e.message || "Falha ao encerrar");
    }
  }, [session]);

  const startScreenShare = useCallback(async () => {
    if (!session || sharing) return;
    try {
      setSharing(true);
      const peer = await createRequesterPeer(
        session.id,
        async (msg, reply) => {
          try {
            const cmd = JSON.parse(msg) as RemoteCommand;
            const result = await executeCommand(session.id, cmd);
            reply(JSON.stringify(result));
          } catch (e) {
            reply(JSON.stringify({ ok: false, error: String(e) }));
          }
        },
        () => {
          peerRef.current?.close(); peerRef.current = null; setSharing(false);
          logAction(session.id, "system", "screen_stopped");
        },
        (state) => console.log("[remote-support][rtc]", state),
      );
      peerRef.current = peer;
      await logAction(session.id, "requester", "screen_started");
      toast.success("Compartilhando tela com o suporte");
    } catch (e: any) {
      setSharing(false);
      toast.error(e.message || "Falha ao compartilhar tela");
    }
  }, [session, sharing]);

  return { session, code, codeExpiresAt, sharing, request, end, startScreenShare };
}
