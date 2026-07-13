import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";
import { KanbanDealCard } from "./KanbanDealCard";
import { resolveStep, type CustomStepMap } from "@/lib/flowStepResolver";
import { VirtualList } from "@/components/ui/VirtualList";
import type { Tables } from "@/integrations/supabase/types";

type KanbanStageRow = Tables<"kanban_stages">;
type CrmDealRow = Tables<"crm_deals">;

interface KanbanColumnProps {
  stage: KanbanStageRow;
  deals: CrmDealRow[];
  searchQuery: string;
  stepFilter?: string; // "all" | "none" | step key
  customStepMap: CustomStepMap;
  onDrop: (stageKey: string) => void;
  onDragStart: (id: string) => void;
  onEditDeal: (deal: CrmDealRow) => void;
  onDeleteDeal: (id: string) => void;
  onReclassify?: (deal: CrmDealRow) => void;
  onView?: (params: { customerId?: string | null; dealId?: string | null }) => void;
}

export function KanbanColumn({ stage, deals, searchQuery, stepFilter = "all", customStepMap, onDrop, onDragStart, onEditDeal, onDeleteDeal, onReclassify, onView }: KanbanColumnProps) {
  const allStageDeals = deals.filter((d) => d.stage === stage.stage_key);
  const stageDeals = allStageDeals.filter((d) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const phone = d.remote_jid?.split("@")[0] || "";
      const notes = d.notes || "";
      const name = ((d as any).customer_name || "").toLowerCase();
      if (!(phone.includes(q) || notes.toLowerCase().includes(q) || name.includes(q))) return false;
    }
    if (stepFilter && stepFilter !== "all") {
      const info = resolveStep((d as any).conversation_step, customStepMap);
      if (stepFilter === "none") return !info;
      if (!info) return false;
      const raw = (d as any).conversation_step as string | null;
      const stripped = raw?.startsWith("flow:") ? raw.slice(5) : raw;
      if (info.rawKey !== stepFilter && stripped !== stepFilter) return false;
    }
    return true;
  });

  return (
    <div
      style={{ width: "var(--kanban-col-w, 248px)", maxWidth: "calc(100vw - 2rem)" }}
      className="shrink-0 snap-start h-full min-h-0 min-w-0 flex flex-col bg-card/40 rounded-xl border border-border/50 shadow-sm overflow-hidden transition-colors hover:border-border/60"
      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-primary/30", "bg-primary/[0.03]"); }}
      onDragLeave={(e) => { e.currentTarget.classList.remove("border-primary/30", "bg-primary/[0.03]"); }}
      onDrop={(e) => { e.currentTarget.classList.remove("border-primary/30", "bg-primary/[0.03]"); onDrop(stage.stage_key); }}
    >
      {/* Barra colorida no topo (padrão Clientes ativos) */}
      <div className={`h-1 w-full ${stage.color}`} />
      {/* Column Header */}
      <div className="flex min-w-0 items-center justify-between gap-2 px-3 py-2.5 border-b border-border/40 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          <Badge variant="secondary" className={`text-[10px] font-semibold ${stage.color} border max-w-full min-w-0 truncate`}>
            {stage.label}
          </Badge>
          {stage.auto_message_enabled && stage.auto_message_text && (
            <Zap className="h-3 w-3 text-primary/60 shrink-0" />
          )}
        </div>
        <span className="text-[12px] font-bold text-foreground bg-muted/60 px-2 py-0.5 rounded-full min-w-[24px] text-center shrink-0">
          {stageDeals.length}
        </span>
      </div>

      {/* Cards — virtualiza quando a coluna fica grande */}
      <div className="kanban-safe-scroll flex-1 min-h-0 min-w-0 max-w-full overflow-hidden p-2">
        {stageDeals.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[11px] text-muted-foreground/60">Vazio</p>
          </div>
        ) : stageDeals.length > 40 ? (
          <VirtualList
            items={stageDeals}
            estimateSize={92}
            overscan={6}
            height="100%"
            getItemKey={(deal) => deal.id}
            renderItem={(deal) => (
              <div className="pb-1.5">
                <KanbanDealCard
                  deal={deal}
                  stepInfo={resolveStep((deal as any).conversation_step, customStepMap)}
                  onDragStart={onDragStart}
                  onEdit={onEditDeal}
                  onDelete={onDeleteDeal}
                  onReclassify={onReclassify}
                  onView={onView}
                />
              </div>
            )}
          />
        ) : (
          <div className="w-full min-w-0 max-w-full overflow-hidden space-y-1.5 overflow-y-auto h-full">
            {stageDeals.map((deal) => (
              <KanbanDealCard
                key={deal.id}
                deal={deal}
                stepInfo={resolveStep((deal as any).conversation_step, customStepMap)}
                onDragStart={onDragStart}
                onEdit={onEditDeal}
                onDelete={onDeleteDeal}
                onReclassify={onReclassify}
                onView={onView}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
