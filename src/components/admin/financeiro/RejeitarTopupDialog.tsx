import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (motivo: string) => void;
}

/** Dialog acessível para recusar uma recarga manual, substituindo `window.prompt`. */
export function RejeitarTopupDialog({ open, onOpenChange, onConfirm }: Props) {
  const [motivo, setMotivo] = useState("");
  useEffect(() => {
    if (open) setMotivo("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Recusar recarga</DialogTitle>
          <DialogDescription>
            Explique brevemente o motivo. O consultor vai ver essa mensagem.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Motivo (opcional)</Label>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: pagamento não identificado no extrato do dia XX/YY"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={() => onConfirm(motivo.trim())}>
            Recusar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
