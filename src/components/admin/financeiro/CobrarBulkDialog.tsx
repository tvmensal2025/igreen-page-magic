import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { renderCobrancaTemplate } from "./hooks";
import type { BoletoAdminRow } from "./hooks";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  alvos: BoletoAdminRow[];
  template: string;
  onConfirm: () => void;
}

/**
 * Confirma envio em lote de cobranças no WhatsApp. Mostra preview do template
 * renderizado com o primeiro boleto selecionado para o admin conferir antes de
 * abrir várias abas do WhatsApp.
 */
export function CobrarBulkDialog({ open, onOpenChange, alvos, template, onConfirm }: Props) {
  const preview = useMemo(() => {
    const b = alvos[0];
    if (!b) return "";
    return renderCobrancaTemplate(template, {
      nome: b.nome || b.customer_name,
      mes: b.mes_referencia,
      valor: Number(b.total || 0),
      vencimento: b.vencimento,
      url_boleto: b.url_boleto,
    });
  }, [alvos, template]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cobrar {alvos.length} cliente{alvos.length > 1 ? "s" : ""} no WhatsApp?</DialogTitle>
          <DialogDescription>
            Vai abrir {alvos.length} aba(s) do WhatsApp Web. Confirme o texto antes.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs whitespace-pre-wrap max-h-52 overflow-auto">
          {preview || "—"}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Prévia do primeiro selecionado. Cada mensagem é personalizada com nome, valor, vencimento e link.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onConfirm}>
            <MessageCircle className="w-4 h-4 mr-1.5" /> Enviar {alvos.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
