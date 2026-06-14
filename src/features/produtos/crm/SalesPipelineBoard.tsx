// =============================================================================
// CRM Multiproduto — Pipeline de Vendas
// =============================================================================
// Board kanban das vendas (entidade `sales`), organizado pelas etapas de
// SaleStatus. Vive DENTRO do módulo de produtos: é a camada de acompanhamento
// das vendas, não um CRM paralelo. Filtra por produto e move o status via
// drag-and-drop, reaproveitando o padrão visual do KanbanBoard existente.
//
// Coexiste com o CRM de leads (crm_deals/customers): aqui o card é uma venda
// de um produto do catálogo, não um lead de energia.
// =============================================================================

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useProducts } from "../catalogo/hooks";
import { PRODUCT_FAMILY_LABEL } from "../catalogo/types";
import { useSales, useUpdateSaleStatus } from "../vendas/hooks";
import { SALE_STATUS_LABEL, SALE_STATUS_ORDER, type Sale, type SaleStatus } from "../vendas/types";

// Etapas exibidas como colunas (rejeitadas/canceladas ficam fora do fluxo ativo).
const PIPELINE_STAGES: SaleStatus[] = ["lead", "capturing", "submitted", "active"];

const STAGE_COLOR: Record<SaleStatus, string> = {
  lead: "bg-slate-500/15 text-slate-300",
  capturing: "bg-amber-500/15 text-amber-300",
  submitted: "bg-sky-500/15 text-sky-300",
  active: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-red-500/15 text-red-300",
  cancelled: "bg-zinc-500/15 text-zinc-300",
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
    const map = new Map<string, (typeof products)[number]>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const salesByStage = useMemo(() => {
    const grouped: Record<SaleStatus, Sale[]> = {
      lead: [], capturing: [], submitted: [], active: [], rejected: [], cancelled: [],
    };
    for (const sale of sales) grouped[sale.status].push(sale);
    return grouped;
  }, [sales]);

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
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* Header / filtro por produto */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Pipeline de vendas</h3>
          <Badge variant="secondary" className="text-[10px]">
            {sales.length} venda(s)
          </Badge>
        </div>
        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="h-8 text-xs w-[220px]">
            <SelectValue placeholder="Filtrar por produto" />
          </SelectTrigger>
          <SelectContent className="max-h-[320px]">
            <SelectItem value="all" className="text-xs">
              Todos os produtos
            </SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name} · {PRODUCT_FAMILY_LABEL[p.family]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Colunas do pipeline */}
      <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto pb-2 items-stretch">
        {PIPELINE_STAGES.map((stage) => {
          const items = salesByStage[stage];
          return (
            <div
              key={stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(stage)}
              className="flex flex-col w-[260px] shrink-0 rounded-xl bg-secondary/30 border border-border/50"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${STAGE_COLOR[stage]}`}>
                  {SALE_STATUS_LABEL[stage]}
                </span>
                <span className="text-[10px] text-muted-foreground">{items.length}</span>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                {isLoading && (
                  <p className="text-[10px] text-muted-foreground text-center py-4">Carregando...</p>
                )}
                {!isLoading && items.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-4">Sem vendas aqui</p>
                )}
                {items.map((sale) => {
                  const product = productById.get(sale.productId);
                  return (
                    <SaleCard
                      key={sale.id}
                      sale={sale}
                      productName={product?.name ?? "Produto"}
                      onDragStart={() => setDraggedId(sale.id)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SaleCardProps {
  sale: Sale;
  productName: string;
  onDragStart: () => void;
}

function SaleCard({ sale, productName, onDragStart }: SaleCardProps) {
  const amountLabel =
    sale.amount !== null
      ? sale.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : null;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="rounded-lg bg-background border border-border/60 p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors"
    >
      <p className="text-xs font-medium text-foreground truncate">{productName}</p>
      <div className="flex items-center justify-between mt-1.5">
        {amountLabel && <span className="text-[10px] text-muted-foreground">{amountLabel}</span>}
        {sale.pointsKwh > 0 && (
          <span className="text-[10px] text-emerald-400 font-medium">
            {sale.pointsKwh.toLocaleString("pt-BR")} kWh
          </span>
        )}
      </div>
      {sale.notes && (
        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{sale.notes}</p>
      )}
    </div>
  );
}
