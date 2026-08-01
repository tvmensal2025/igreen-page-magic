// =============================================================================
// Remote Support — IncomingOperatorRequestDialog
// =============================================================================
// Mostra popup quando o Super Admin iniciou a sessão e o consultor precisa
// autorizar.
//
// Correção P11: modal NÃO fecha ao clicar fora (modal="true" implícito via
// onInteractOutside bloqueado). Recusa só ocorre via botão explícito.
// =============================================================================

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldX, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupportSession } from "./types";
import { acceptSession, endSession } from "./api";
import { toast } from "@/components/ui/sonner";

interface Props {
  session: SupportSession | null;
  onResolved: () => void;
}

export function IncomingOperatorRequestDialog({ session, onResolved }: Props) {
  const [operatorName, setOperatorName] = useState<string | null>(null);
  const [authorizing,  setAuthorizing]  = useState(false);
  const [refusing,     setRefusing]     = useState(false);

  useEffect(() => {
    if (!session?.operator_id) return;
    supabase
      .from("consultants")
      .select("name")
      .eq("id", session.operator_id)
      .maybeSingle()
      .then(
        ({ data }) => setOperatorName(data?.name ?? "Suporte"),
        () => setOperatorName("Suporte"),
      );
  }, [session?.operator_id]);

  const isOpen =
    !!session &&
    session.initiated_by === "operator" &&
    session.status === "requested";

  const authorize = async () => {
    if (!session || authorizing) return;
    setAuthorizing(true);
    try {
      await acceptSession(session.id);
      toast.success("Acesso autorizado. Leia o código exibido na tela para o suporte.");
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao autorizar");
    } finally {
      setAuthorizing(false);
    }
  };

  const refuse = async () => {
    if (!session || refusing) return;
    setRefusing(true);
    try {
      await endSession(session.id, "requester_refused");
      onResolved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao recusar");
    } finally {
      setRefusing(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      // Bloqueia fechamento por clique fora ou ESC — a decisão é sempre explícita
      onOpenChange={() => { /* intencional: não fecha sem ação do usuário */ }}
    >
      <DialogContent
        data-remote-support-banner
        // Impede que o Radix feche ao pressionar ESC ou clicar fora
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="text-primary size-5" aria-hidden="true" />
            Suporte solicitando acesso
          </DialogTitle>
          <DialogDescription className="pt-1">
            <b>{operatorName ?? "Suporte"}</b> está pedindo permissão para ver o seu
            navegador e te ajudar remotamente. Você poderá encerrar a qualquer momento.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={refuse}
            disabled={refusing || authorizing}
          >
            {refusing
              ? <Loader2 className="size-4 mr-1 animate-spin" />
              : <ShieldX className="size-4 mr-1" aria-hidden="true" />
            }
            Recusar
          </Button>
          <Button
            onClick={authorize}
            disabled={authorizing || refusing}
          >
            {authorizing
              ? <Loader2 className="size-4 mr-1 animate-spin" />
              : <ShieldCheck className="size-4 mr-1" aria-hidden="true" />
            }
            Autorizar acesso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
