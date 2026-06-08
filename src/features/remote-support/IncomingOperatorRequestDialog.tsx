import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupportSession } from "./types";
import { acceptSession, endSession } from "./api";
import { toast } from "sonner";

interface Props {
  session: SupportSession | null;
  onResolved: () => void;
}

/** Mostra um popup quando o Super Admin iniciou a sessão e o consultor precisa autorizar. */
export function IncomingOperatorRequestDialog({ session, onResolved }: Props) {
  const [operatorName, setOperatorName] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.operator_id) return;
    (async () => {
      const { data } = await supabase
        .from("consultants").select("name").eq("id", session.operator_id!).maybeSingle();
      setOperatorName(data?.name || "Suporte");
    })();
  }, [session?.operator_id]);

  const isOperatorInitiated =
    !!session && session.initiated_by === "operator" && session.status === "requested";

  const authorize = async () => {
    if (!session) return;
    try {
      await acceptSession(session.id);
      toast.success("Acesso autorizado. Leia o código exibido na tela para o suporte.");
      onResolved();
    } catch (e: any) {
      toast.error(e.message || "Falha ao autorizar");
    }
  };

  const refuse = async () => {
    if (!session) return;
    await endSession(session.id, "requester_refused");
    onResolved();
  };

  return (
    <Dialog open={isOperatorInitiated} onOpenChange={(o) => { if (!o) refuse(); }}>
      <DialogContent data-remote-support-banner>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="text-primary" /> Suporte solicitando acesso
          </DialogTitle>
          <DialogDescription>
            <b>{operatorName || "Suporte"}</b> está pedindo permissão para acessar o seu navegador
            e te ajudar. Você poderá encerrar a qualquer momento.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={refuse}>
            <ShieldX className="size-4 mr-1" /> Recusar
          </Button>
          <Button onClick={authorize}>
            <ShieldCheck className="size-4 mr-1" /> Autorizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
