// =============================================================================
// CRM Multiproduto — Pipeline de Vendas (Magazine 7+5 redesign)
// =============================================================================
// Board kanban Sage & Cream com hero editorial (manchete serif + 4 KPIs) e
// colunas com cards ricos (kicker da família, tempo na etapa, valor, kWh,
// status-dot, próxima ação). Coluna "Ativo" em cartão escuro com gold.
// =============================================================================

import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useProducts } from "../catalogo/hooks";
import { PRODUCT_FAMILY_LABEL, type Product } from "../catalogo/types";
import { useSales, useUpdateSaleStatus } from "../vendas/hooks";
import { SALE_STATUS_LABEL, type Sale, type SaleStatus } from "../vendas/types";
import { pvSerif } from "../theme";

const PIPELINE_STAGES: SaleStatus[] = ["lead", "capturing", "submitted", "active"];

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const KWH = (n: number) => `${n.toLocaleString("pt-BR")} kWh`;

const NEXT_ACTION: Record<SaleStatus, { label: string; dot: string }> = {
  lead: { label: "Qualificar consumo", dot: "bg-orange-400" },
  capturing: { label: "Aguardando fatura", dot: "bg-blue-400" },
  submitted: { label: "Aguardando análise", dot: "bg-sky-400" },
  active: { label: "Contrato ativo", dot: "bg-emerald-500" },
  rejected: { label: "Reprovada", dot: "bg-red-400" },
  cancelled: { label: "Cancelada", dot: "bg-zinc-400" },
};

interface SalesPipelineBoardProps {
  consultantId: string;
}

export function SalesPipelineBoard({ consultantId }: SalesPipelineBoardProps) {
  const [productFilter, setProductFilter] = useState<string>("all");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: products = [] } = useProducts();
  const { data: sales = [], isLoading } = useSales({
    consultantId,
    productId: productFilter === "all" ? undefined : productFilter,
  });
  const updateStatus = useUpdateSaleStatus(consultantId);

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const salesByStage = useMemo(() => {
    const grouped: Record<SaleStatus, Sale[]> = {
      lead: [], capturing: [], submitted: [], active: [], rejected: [], cancelled: [],
    };
    for (const s of sales) grouped[s.status].push(s);
    return grouped;
  }, [sales]);

  // KPIs editoriais
  const kpis = useMemo(() => {
    const activeSales = salesByStage.active;
    const totalAtivo = activeSales.reduce((acc, s) => acc + (s.amount ?? 0), 0);
    const ganhoEstimado = sales.reduce((acc, s) => acc + (s.amount ?? 0), 0);
    const propostasAtivas = sales.length - activeSales.length;
    const totalFechadoOuRejeitado = activeSales.length + salesByStage.rejected.length;
    const conversao = totalFechadoOuRejeitado > 0
      ? Math.round((activeSales.length / totalFechadoOuRejeitado) * 100)
      : 0;
    // Ciclo médio (dias) = ativatedAt - createdAt das ativas
    const cycles = activeSales
      .map((s) => {
        if (!s.activatedAt) return null;
        return (new Date(s.activatedAt).getTime() - new Date(s.createdAt).getTime()) / 86400000;
      })
      .filter((d): d is number => d !== null && d >= 0);
    const cicloMedio = cycles.length > 0
      ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
      : 0;
    return { totalAtivo, ganhoEstimado, propostasAtivas, conversao, cicloMedio };
  }, [sales, salesByStage]);

  const handleDrop = async (stage: SaleStatus) => {
    if (!draggedId) return;
    const sale = sales.find((s) => s.id === draggedId);
    setDraggedId(null);
    if (!sale || sale.status === stage) return;
    try {
      await updateStatus.mutateAsync({ saleId: sale.id, status: stage });
      toast({ title: `Venda movida para "${SALE_STATUS_LABEL[stage]}"` });
    } catch (err) {
      toast({
        title: "Erro ao mover venda",
        description: err instanceof Error ? err.message : "Falha desconhecida",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-10">
      {/* Hero magazine 7+5 */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        <div className="lg:col-span-7">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#7d9b76] mb-3 block">
            Pipeline de Vendas
          </span>
          <h1 className={`text-5xl md:text-7xl text-[#1a2e1f] leading-[1.05] ${pvSerif}`}>
            Pipeline de <br />Performance
          </h1>
          <p className="mt-5 text-base text-[#1a2e1f]/70 max-w-md leading-relaxed">
            Gerencie suas conversões e fluxo de propostas em tempo real. {sales.length} venda(s)
            no funil — {salesByStage.active.length} já ativa(s).
          </p>
          <div className="mt-5 max-w-[260px]">
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="h-9 text-xs rounded-none bg-white border-[#a8c0a0]/40">
                <SelectValue placeholder="Filtrar por produto" />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                <SelectItem value="all" className="text-xs">Todos os produtos</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name} · {PRODUCT_FAMILY_LABEL[p.family]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="lg:col-span-5 grid grid-cols-2 gap-3">
          <KpiBlock
            kicker="Ganho Estimado"
            value={BRL(kpis.ganhoEstimado)}
            accent="gold"
            bar={Math.min(1, kpis.ganhoEstimado / Math.max(kpis.ganhoEstimado, 50000))}
          />
          <KpiBlock
            kicker="Ciclo Médio"
            value={kpis.cicloMedio > 0 ? `${kpis.cicloMedio} d` : "—"}
            accent="accent"
            sparkline
          />
          <KpiBlock
            kicker="Propostas Ativas"
            value={String(kpis.propostasAtivas)}
            accent="accent"
          />
          <KpiBlock
            kicker="Conversão"
            value={`${kpis.conversao}%`}
            accent="ink"
          />
        </div>
      </section>

      {/* Kanban board */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {PIPELINE_STAGES.map((stage) => {
          const items = salesByStage[stage];
          const totalCol = items.reduce((acc, s) => acc + (s.amount ?? 0), 0);
          const isActive = stage === "active";
          return (
            <div
              key={stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(stage)}
              className="space-y-3 min-h-[200px]"
            >
              <div className="flex items-center justify-between border-b border-[#a8c0a0] pb-2">
                <h3 className="uppercase text-[10px] tracking-[0.2em] font-bold text-[#1a2e1f]">
                  {SALE_STATUS_LABEL[stage]} ({items.length})
                </h3>
                <span className={`text-[10px] font-medium ${isActive ? "text-[#c9a84c]" : "text-[#7d9b76]"}`}>
                  {totalCol > 0 ? BRL(totalCol) : "—"}
                </span>
              </div>

              {isLoading && (
                <p className="text-[10px] text-[#1a2e1f]/40 text-center py-6">Carregando...</p>
              )}
              {!isLoading && items.length === 0 && (
                <p className="text-[10px] text-[#1a2e1f]/40 text-center py-6 italic">
                  Arraste cards aqui
                </p>
              )}

              {items.map((sale) => (
                <SaleCard
                  key={sale.id}
                  sale={sale}
                  product={productById.get(sale.productId)}
                  dark={isActive}
                  onDragStart={() => setDraggedId(sale.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface KpiBlockProps {
  kicker: string;
  value: string;
  accent: "gold" | "accent" | "ink";
  bar?: number;
  sparkline?: boolean;
}

function KpiBlock({ kicker, value, accent, bar, sparkline }: KpiBlockProps) {
  const borderColor =
    accent === "gold" ? "border-[#c9a84c]" : accent === "ink" ? "border-[#1a2e1f]" : "border-[#7d9b76]";
  const bg = accent === "gold" ? "bg-[#dce5d4]" : "bg-white/60";
  return (
    <div className={`${bg} p-5 border-l-4 ${borderColor} min-h-[110px] flex flex-col justify-between`}>
      <span className="text-[10px] uppercase tracking-[0.18em] text-[#1a2e1f]/60 font-semibold">
        {kicker}
      </span>
      <div>
        <div className={`text-3xl font-light text-[#1a2e1f] mt-1 ${pvSerif}`}>{value}</div>
        {bar !== undefined && (
          <div className="mt-2 h-1 w-full bg-[#a8c0a0]/30 overflow-hidden">
            <div className="h-full bg-[#c9a84c]" style={{ width: `${Math.round(bar * 100)}%` }} />
          </div>
        )}
        {sparkline && (
          <svg className="mt-2 w-full h-4" viewBox="0 0 100 20" preserveAspectRatio="none">
            <path
              d="M0,15 Q25,5 50,15 T100,5"
              fill="none"
              stroke="#7d9b76"
              strokeWidth="2"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

interface SaleCardProps {
  sale: Sale;
  product?: Product;
  dark: boolean;
  onDragStart: () => void;
}

function SaleCard({ sale, product, dark, onDragStart }: SaleCardProps) {
  const familyLabel = product ? PRODUCT_FAMILY_LABEL[product.family] : "Produto";
  const action = NEXT_ACTION[sale.status];
  const daysAgo = Math.floor((Date.now() - new Date(sale.updatedAt).getTime()) / 86400000);
  const timeLabel =
    daysAgo === 0 ? "hoje" : daysAgo === 1 ? "ontem" : `${daysAgo}d atrás`;

  if (dark) {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        className="bg-[#1a2e1f] p-4 border border-[#1a2e1f] shadow-lg cursor-grab active:cursor-grabbing"
      >
        <div className="flex justify-between items-start">
          <span className="text-[10px] font-semibold text-[#c9a84c] uppercase tracking-wider">
            {familyLabel}
          </span>
          <span className="text-[9px] text-white/40 italic">{timeLabel}</span>
        </div>
        <h4 className={`text-base mt-2 text-[#f5f0e8] font-medium leading-tight`}>
          {product?.name ?? "Produto"}
        </h4>
        <div className="mt-3 flex items-center justify-between">
          {sale.pointsKwh > 0 && (
            <span className="text-xs text-[#f5f0e8]/60">{KWH(sale.pointsKwh)}</span>
          )}
          {sale.amount !== null && (
            <span className="text-xs font-semibold text-[#c9a84c]">{BRL(sale.amount)}</span>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#7d9b76]" />
          <span className="text-[10px] text-white/50 uppercase tracking-tighter italic">
            {action.label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group bg-white p-4 border border-[#dce5d4] hover:border-[#7d9b76] hover:shadow-sm transition-all cursor-grab active:cursor-grabbing"
    >
      <div className="flex justify-between items-start">
        <span className="text-[10px] font-semibold text-[#7d9b76] uppercase tracking-wider">
          {familyLabel}
        </span>
        <span className="text-[9px] text-[#1a2e1f]/40">{timeLabel}</span>
      </div>
      <h4 className="text-base mt-1.5 text-[#1a2e1f] font-medium leading-tight">
        {product?.name ?? "Produto"}
      </h4>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-[#1a2e1f]/70">
          {sale.pointsKwh > 0 ? KWH(sale.pointsKwh) : "—"}
        </div>
        <div className="text-xs font-semibold text-[#1a2e1f]">
          {sale.amount !== null ? BRL(sale.amount) : "—"}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-[#f5f0e8] flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${action.dot}`} />
        <span className="text-[10px] text-[#1a2e1f]/60">{action.label}</span>
      </div>
      {sale.notes && (
        <p className="mt-2 text-[10px] text-[#1a2e1f]/50 line-clamp-2 italic">{sale.notes}</p>
      )}
    </div>
  );
}
