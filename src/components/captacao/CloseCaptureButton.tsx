import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  customerId: string;
  consultantId: string;
  /** Chamado após encerrar com sucesso — o painel pai geralmente reseta o selectedId. */
  onClosed?: () => void;
}

/**
 * Botão "Encerrar captação" pra usar em QUALQUER lead da Captação (independente
 * de completude da ficha). Ao encerrar, chama a mesma edge do chat WhatsApp:
 * o lead sai da captação, entra em Vendas/CRM/Comissão e o chat WhatsApp
 * segue vivo. Se já estava encerrado, apenas mostra o selo.
 */
export function CloseCaptureButton({ customerId, consultantId, onClosed }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closedAt, setClosedAt] = useState<string | null>(null);

  // Carrega estado atual da coluna customers.capture_closed_at.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("customers")
        .select("capture_closed_at")
        .eq("id", customerId)
        .maybeSingle();
      if (cancelled) return;
      setClosedAt(((data as any)?.capture_closed_at as string | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "close-capture-and-register-sale",
        { body: { customerId, consultantId } },
      );
      if (error) throw new Error(error.message || "Falha ao encerrar");
      const res = (data as any) || {};
      if (!res.ok) throw new Error(res.error || "Falha ao encerrar");
      const roi = res.campaignRoi;
      const brl = (c: number) =>
        (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      let description = "Lead vinculado em Vendas, CRM e Comissão. O chat continua ativo.";
      if (roi) {
        const sign = roi.positive ? "🟢" : "🔴";
        description = `${sign} Campanha: ${brl(roi.investedCents)} investido · ${brl(
          roi.returnedCents,
        )} retorno · ${roi.leadsCount} leads`;
      }
      toast.success(
        res.alreadyClosed ? "Captação já estava encerrada" : "✅ Captação encerrada",
        { description, duration: 6000 },
      );
      setClosedAt(new Date().toISOString());
      setOpen(false);
      onClosed?.();
    } catch (e) {
      toast.error("Erro ao encerrar", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [busy, customerId, consultantId, onClosed]);

  if (closedAt) {
    const d = new Date(closedAt);
    const label = Number.isFinite(d.getTime())
      ? d.toLocaleDateString("pt-BR")
      : "recentemente";
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>Captação encerrada em {label}</span>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full h-8 gap-1.5 text-[11px] border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
        disabled={busy}
        onClick={() => setOpen(true)}
        title="Fecha a captação deste lead e move para Vendas/CRM/Comissão. O chat continua ativo."
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
        Encerrar captação
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar a captação deste lead?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead sai da lista de Captação e entra em <strong>Vendas</strong>,{" "}
              <strong>CRM</strong> e <strong>Comissão</strong>. A conversa no WhatsApp
              continua ativa. Você pode encerrar mesmo com dados faltando.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void run();
              }}
              disabled={busy}
              className="bg-amber-600 hover:bg-amber-500"
            >
              {busy ? "Encerrando…" : "Encerrar captação"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
