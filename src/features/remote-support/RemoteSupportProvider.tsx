import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LifeBuoy } from "lucide-react";
import { useRequesterSession } from "./useRequesterSession";
import { ActiveSessionBanner } from "./ActiveSessionBanner";
import { IncomingOperatorRequestDialog } from "./IncomingOperatorRequestDialog";
import { supabase } from "@/integrations/supabase/client";

/**
 * Monte uma única vez em App.tsx (dentro do Router). Fica invisível quando não há sessão;
 * exibe banner + botão flutuante quando o usuário está autenticado.
 */
export function RemoteSupportProvider() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUserId(s?.user?.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const { session, code, codeExpiresAt, sharing, request, end, startScreenShare } = useRequesterSession(userId);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!userId) return null;

  return (
    <>
      {session && session.status !== "ended" && session.status !== "rejected" && (
        <ActiveSessionBanner
          session={session}
          code={code}
          codeExpiresAt={codeExpiresAt}
          sharing={sharing}
          onStartShare={startScreenShare}
          onEnd={end}
        />
      )}

      <IncomingOperatorRequestDialog
        key={refreshKey}
        session={session}
        onResolved={() => setRefreshKey(k => k + 1)}
      />

      {/* Ícone de ajuda discreto no topo direito — visível quando não há sessão */}
      {!session && (
        <button
          type="button"
          onClick={request}
          title="Pedir ajuda ao suporte"
          aria-label="Pedir ajuda ao suporte"
          className="fixed top-20 right-2 z-[9998] p-2 rounded-full bg-background/80 backdrop-blur border border-border shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors opacity-60 hover:opacity-100"
          data-remote-support-banner
        >
          <LifeBuoy className="size-4" />
        </button>
      )}
    </>
  );
}
