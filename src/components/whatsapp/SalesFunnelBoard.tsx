import { useMemo, useState } from "react";
import { Search, RefreshCw, Flame, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSalesFunnel, SALES_PHASES, type SalesPhase, type FunnelLead } from "@/hooks/useSalesFunnel";
import { SalesFunnelCard } from "./SalesFunnelCard";
import { DragResizer } from "@/components/layout/DragResizer";

interface SalesFunnelBoardProps {
  consultantId: string;
  onOpenChat?: (phone: string) => void;
}

export function SalesFunnelBoard({ consultantId, onOpenChat }: SalesFunnelBoardProps) {
  const { leads, loading, fetchLeads, movePhase } = useSalesFunnel(consultantId);
  const [search, setSearch] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hotOnly, setHotOnly] = useState(false);
  const { toast } = useToast();

  const filtered = useMemo(() => {
    let list = leads;
    if (hotOnly) list = list.filter((l) => (l.qualification_score ?? 0) >= 80);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.name?.toLowerCase().includes(q) ||
          l.phone_whatsapp?.includes(q) ||
          l.address_city?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [leads, search, hotOnly]);

  const byPhase = useMemo(() => {
    const map = new Map<SalesPhase, FunnelLead[]>();
    for (const phase of SALES_PHASES) map.set(phase.key, []);
    for (const lead of filtered) {
      const phase = (lead.sales_phase as SalesPhase) || "abertura";
      const bucket = map.get(phase) ?? map.get("abertura")!;
      bucket.push(lead);
    }
    return map;
  }, [filtered]);

  const totals = useMemo(() => {
    const hot = leads.filter((l) => (l.qualification_score ?? 0) >= 80).length;
    return { total: leads.length, hot };
  }, [leads]);

  const handleDrop = async (phase: SalesPhase) => {
    if (!draggedId) return;
    const lead = leads.find((l) => l.id === draggedId);
    setDraggedId(null);
    if (!lead || lead.sales_phase === phase) return;
    const ok = await movePhase(draggedId, phase);
    if (ok) {
      const phaseLabel = SALES_PHASES.find((p) => p.key === phase)?.label;
      toast({ title: "✅ Cliente interessado movido", description: `${lead.name || lead.phone_whatsapp} → ${phaseLabel}` });
    } else {
      toast({ title: "Erro ao mover cliente interessado", variant: "destructive" });
    }
  };

  const handleCardClick = (lead: FunnelLead) => {
    if (onOpenChat) {
      const phone = lead.phone_whatsapp?.replace(/\D/g, "") || "";
      onOpenChat(phone);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 p-2 sm:p-3 border-b border-border bg-background/50 sticky top-0 z-10">
        <div className="relative flex-1 min-w-[160px] order-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nome, telefone ou cidade…"
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Button
          variant={hotOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setHotOnly((v) => !v)}
          className="gap-1 sm:gap-1.5 h-9 px-2.5 order-2"
        >
          <Flame className="w-3.5 h-3.5" />
          <span className="text-xs sm:text-sm">Quentes</span>
          {totals.hot > 0 && <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">{totals.hot}</Badge>}
        </Button>
        <Button variant="outline" size="sm" onClick={() => fetchLeads()} disabled={loading} className="h-9 w-9 p-0 shrink-0 order-3">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
        <div className="text-[11px] sm:text-xs text-muted-foreground basis-full sm:basis-auto sm:ml-auto order-4 tabular-nums">
          {filtered.length} de {totals.total} leads
        </div>
      </div>


      {/* Board */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden" data-resize-scope style={{ "--funnel-col-w": "248px" } as React.CSSProperties}>
        <div className="flex gap-2 p-2 h-full min-w-max items-stretch">
          <DragResizer storageKey="funnel-col" cssVar="funnel-col-w" defaultPx={248} minPx={200} maxPx={480} />
          {SALES_PHASES.map((phase) => {
            const items = byPhase.get(phase.key) || [];
            const isDragOver = draggedId !== null;
            return (
              <div
                key={phase.key}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={() => handleDrop(phase.key)}
                style={{ width: "var(--funnel-col-w)" }}
                className={`shrink-0 flex flex-col bg-muted/20 rounded-xl border ${
                  isDragOver ? "border-primary/50 border-dashed" : "border-border/50"
                } transition-colors`}
              >
                <div className={`px-3 py-2 rounded-t-xl border-b border-border/50 flex items-center justify-between ${phase.color}`}>
                  <div className="flex items-center gap-1.5">
                    <span>{phase.icon}</span>
                    <h3 className="text-sm font-semibold">{phase.label}</h3>
                  </div>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                    {items.length}
                  </Badge>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px]">
                  {items.length === 0 ? (
                    <div className="text-center text-[11px] text-muted-foreground/60 py-8">
                      Arraste clientes interessados para cá
                    </div>
                  ) : (
                    items.map((lead) => (
                      <SalesFunnelCard
                        key={lead.id}
                        lead={lead}
                        onDragStart={setDraggedId}
                        onClick={handleCardClick}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
