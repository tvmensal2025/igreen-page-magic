/**
 * Diálogo de confirmação para "Nunca mais contatar" / revogar.
 * Usado no WhatsApp e Captação.
 */
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  suppressContact,
  revokeContactSuppression,
  type SuppressionReason,
} from "@/services/contactSuppression";
import { toast as sonnerToast } from "sonner";

interface SuppressProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  consultantId: string;
  customerId?: string | null;
  phone?: string | null;
  capturedLeadId?: string | null;
  channel?: string;
  leadLabel?: string | null;
  onDone?: () => void;
}

export function NeverContactConfirmDialog({
  open,
  onOpenChange,
  consultantId,
  customerId,
  phone,
  capturedLeadId,
  channel = "whatsapp",
  leadLabel,
  onDone,
}: SuppressProps) {
  const [reason, setReason] = useState<SuppressionReason>("complaint");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const r = await suppressContact({
        consultantId,
        customerId,
        phone,
        capturedLeadId,
        reason,
        channel,
      });
      if (!r.ok) {
        sonnerToast.error(r.error || "Falha ao bloquear");
        return;
      }
      sonnerToast.success("Lead bloqueado — não receberá mais contato automático nem manual.");
      onOpenChange(false);
      onDone?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Nunca mais contatar?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <span className="block">
              {leadLabel ? `“${leadLabel}”` : "Este lead"} será marcado como não contato:
              bot pausado, WhatsApp/bulk/reheat bloqueados, voz/SMS na lista Não Perturbe
              e buffer de captação descartado.
            </span>
            <span className="block text-destructive font-medium">
              O composer também fica bloqueado até revogar o opt-out.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-1">
          <Label className="text-xs text-muted-foreground">Motivo</Label>
          <Select value={reason} onValueChange={(v) => setReason(v as SuppressionReason)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="complaint">Reclamação / cliente chato</SelectItem>
              <SelectItem value="requested">Pediu para parar</SelectItem>
              <SelectItem value="legal">Jurídico / LGPD</SelectItem>
              <SelectItem value="opt_out">Opt-out geral</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {loading ? "Bloqueando…" : "Bloquear para sempre"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface RevokeProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  consultantId: string;
  customerId: string;
  onDone?: () => void;
}

export function RevokeNeverContactDialog({
  open,
  onOpenChange,
  consultantId,
  customerId,
  onDone,
}: RevokeProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const r = await revokeContactSuppression({ consultantId, customerId });
      if (!r.ok) {
        sonnerToast.error(r.error || "Falha ao revogar");
        return;
      }
      sonnerToast.success("Opt-out revogado. Remova o número da aba Voz → Não Perturbe se quiser liberar ligação/SMS.");
      onOpenChange(false);
      onDone?.();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revogar “nunca mais contatar”?</AlertDialogTitle>
          <AlertDialogDescription>
            O lead volta a poder receber mensagens. A lista Não Perturbe (voz) precisa
            ser limpa manualmente na aba Voz se ainda estiver lá.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
          >
            {loading ? "Revogando…" : "Revogar opt-out"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
