// =============================================================================
// CRM — Timeline do histórico de etapas da venda
// =============================================================================

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2 } from "lucide-react";
import { useSaleStatusHistory } from "../vendas/hooks";
import { SALE_STATUS_LABEL, type SaleStatus } from "../vendas/types";

interface SaleHistoryTimelineProps {
  saleId: string;
}

export function SaleHistoryTimeline({ saleId }: SaleHistoryTimelineProps) {
  const { data: entries = [], isLoading } = useSaleStatusHistory(saleId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando histórico...
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic py-1">
        Nenhuma mudança de etapa registrada ainda.
      </p>
    );
  }

  return (
    <ol className="space-y-2 border-l border-border/60 ml-1.5 pl-3">
      {entries.map((entry) => (
        <li key={entry.id} className="relative text-[11px]">
          <span className="absolute -left-[0.72rem] top-1.5 h-2 w-2 rounded-full bg-pv-accent border border-background" />
          <p className="text-foreground font-medium">
            {labelTransition(entry.fromStatus, entry.toStatus)}
          </p>
          <p className="text-muted-foreground">
            {format(new Date(entry.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
          </p>
          {entry.note && (
            <p className="text-muted-foreground mt-0.5 italic line-clamp-3">
              Motivo: {entry.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function labelTransition(from: SaleStatus | null, to: SaleStatus): string {
  if (!from) return `Início em ${SALE_STATUS_LABEL[to]}`;
  return `${SALE_STATUS_LABEL[from]} → ${SALE_STATUS_LABEL[to]}`;
}
