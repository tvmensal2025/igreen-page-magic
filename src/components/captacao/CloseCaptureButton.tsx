import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, CheckCircle2, XCircle } from "lucide-react";
import { CloseCaptureDialog } from "./CloseCaptureDialog";

interface Props {
  customerId: string;
  consultantId: string;
  onClosed?: () => void;
}

interface ClosedState {
  closedAt: string | null;
  outcome: "won" | "lost" | null;
}

export function CloseCaptureButton({ customerId, consultantId, onClosed }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ClosedState>({ closedAt: null, outcome: null });

  const load = useCallback(async () => {
    const [{ data: cust }, { data: sale }] = await Promise.all([
      supabase
        .from("customers")
        .select("capture_closed_at")
        .eq("id", customerId)
        .maybeSingle(),
      supabase
        .from("sales")
        .select("outcome")
        .eq("customer_id", customerId)
        .eq("consultant_id", consultantId)
        .maybeSingle(),
    ]);
    setState({
      closedAt: ((cust as any)?.capture_closed_at as string | null) ?? null,
      outcome: ((sale as any)?.outcome as "won" | "lost" | null) ?? null,
    });
  }, [customerId, consultantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleClosed = () => {
    void load();
    onClosed?.();
  };

  if (state.closedAt) {
    const d = new Date(state.closedAt);
    const label = Number.isFinite(d.getTime()) ? d.toLocaleDateString("pt-BR") : "";
    const isWon = state.outcome !== "lost";
    return (
      <div
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium ${
          isWon
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
        }`}
      >
        {isWon ? (
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 shrink-0" />
        )}
        <span>{isWon ? "Ganho" : "Perdido"} em {label}</span>
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
        onClick={() => setOpen(true)}
        title="Registre se este lead virou cliente (Ganho) ou foi perdido"
      >
        <ClipboardCheck className="w-3.5 h-3.5" />
        Encerrar captação
      </Button>

      <CloseCaptureDialog
        open={open}
        onOpenChange={setOpen}
        customerId={customerId}
        consultantId={consultantId}
        onClosed={handleClosed}
      />
    </>
  );
}
