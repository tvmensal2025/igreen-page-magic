// =============================================================================
// Pós-Venda — Valor da conta opcional na aprovação (CRM)
// =============================================================================
// O consultor pode informar a fatura ao aprovar/validar, mas NÃO é obrigatório.
// =============================================================================

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface BillValueCustomer {
  id: string;
  name: string | null;
  electricity_bill_value?: number | null;
}

/** Estágio destino opcional escolhido na hora de aprovar (split button). */
export type ApproveTargetStage = "aprovado" | "d30" | "d60" | "d90" | "d120";

interface Props {
  customer: BillValueCustomer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Estágio que o consultor pediu para o cliente cair direto após aprovar. */
  targetStage?: ApproveTargetStage;
  /** Chamado após salvar o valor da conta (antes de concluir a aprovação). */
  onSaved: (customerId: string, billValue: number, targetStage?: ApproveTargetStage) => void | Promise<void>;
}


/**
 * Valor da conta NÃO é obrigatório para validar/aprovar no CRM.
 * O diálogo continua disponível se o consultor quiser informar, mas não bloqueia.
 */
export function needsBillValueForApproval(
  _pendingStage: string | null | undefined,
  _bill: number | null | undefined,
): boolean {
  return false;
}

function parseBillInput(raw: string): number | null {
  const normalized = raw.replace(/\./g, "").replace(",", ".").trim();
  const n = parseFloat(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export default function ApproveBillValueDialog({ customer, open, onOpenChange, onSaved, targetStage }: Props) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && customer) {
      const existing = customer.electricity_bill_value;
      setValue(existing != null && existing > 0 ? String(existing) : "");
    }
  }, [open, customer]);

  async function handleConfirm() {
    if (!customer) return;
    const bill = parseBillInput(value);
    if (bill == null) {
      toast.error("Informe o valor da conta de luz (maior que zero).");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("customers")
        .update({ electricity_bill_value: bill })
        .eq("id", customer.id);
      if (error) throw error;
      await onSaved(customer.id, bill, targetStage);
      onOpenChange(false);
      setValue("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Erro ao salvar valor: " + msg);
    } finally {
      setSaving(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving && !o) return; onOpenChange(o); }}>
      <DialogContent
        className="max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Zap className="w-4 h-4 text-primary" />
            Valor da conta de luz
          </DialogTitle>
          <DialogDescription>
            {customer?.name
              ? <>Informe o valor mensal da conta de <strong>{customer.name}</strong> para concluir a aprovação e calcular a comissão.</>
              : "Informe o valor mensal da conta para concluir a aprovação."}
          </DialogDescription>

        </DialogHeader>
        <div className="space-y-2 py-1">
          <Label htmlFor="bill-value" className="text-xs text-muted-foreground">Valor (R$)</Label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-border bg-muted text-muted-foreground text-sm">R$</span>
            <Input
              id="bill-value"
              type="text"
              inputMode="decimal"
              placeholder="350,00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleConfirm(); } }}
              className="rounded-l-none"
              autoFocus
              disabled={saving}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            O sync iGreen nem sempre traz esse valor — ele é usado no cálculo de entrada e recorrente.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Salvar e aprovar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
