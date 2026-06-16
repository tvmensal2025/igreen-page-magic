// =============================================================================
// CRM Multiproduto — Pipeline de Vendas (Magazine 7+5 redesign)
// =============================================================================
// Board kanban Sage & Cream com hero editorial (manchete serif + KPIs) e
// colunas com cards ricos (kicker da família, tempo na etapa, valor, kWh,
// status-dot, próxima ação).
//
// Funil de venda única (Requisito 1): 4 etapas até o aceite —
// Interesse, Negociando, Fechado e Perdido. A coluna "destaque" (cartão
// escuro/gold) é a de FECHADO (cliente aceitou; fim do acompanhamento aqui).
// Sem MRR/recorrência. Valores sempre em centavos, exibidos via
// `formatBRLFromCents` (ver lib/money.ts).
//
// Ao mover um card para "Perdido", pedimos um motivo (texto livre, opcional)
// que é gravado em `sale_status_history.note` (ver vendas/api.ts).
// =============================================================================

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useProducts } from "../catalogo/hooks";
import { PRODUCT_FAMILY_LABEL, type Product } from "../catalogo/types";
import { useSales, useUpdateSaleStatus } from "../vendas/hooks";
import { SALE_STATUS_LABEL, type Sale, type SaleStatus } from "../vendas/types";
import { formatBRLFromCents } from "../lib/money";
import { RegistrarVendaDialog } from "./RegistrarVendaDialog";
import { pvSerif } from "../theme";

// Etapas exibidas no board, na ordem do funil (venda única, até o aceite).
const PIPELINE_STAGES: SaleStatus[] = ["interesse", "negociando", "fechado", "perdido"];

// Exibe valor em centavos como moeda. "—" quando não há valor.
const fmtCents = (cents: number | null) =>
  cents !== null && cents > 0 ? formatBRLFromCents(cents) : "—";

const KWH = (n: number) => `${n.toLocaleString("pt-BR")} kWh`;

// Próxima ação sugerida por etapa (texto + cor do status-dot).
const NEXT_ACTION: Record<SaleStatus, { label: string; dot: string }> = {
  interesse: { label: "Qualificar interesse", dot: "bg-orange-400" },
  negociando: { label: "Em negociação", dot: "bg-sky-400" },
  fechado: { label: "Cliente aceitou", dot: "bg-emerald-500" },
  perdido: { label: "Negócio perdido", dot: "bg-red-400" },
};

interface SalesPipelineBoardProps {
  consultantId: string;
}

export function SalesPipelineBoard({ consultantId }: SalesPipelineBoardProps) {
  const [productFilter, setProductFilter] = useState<string>("all");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // Estado do diálogo de motivo de perda: guarda a venda que está sendo movida
  // para "perdido" e o texto do motivo até o consultor confirmar.
  const [lossDialog, setLossDialog] = useState<{ sale: Sale } | null>(null);
  const [lossReason, setLossReason] = useState("");
  // Controla o diálogo de registro manual de venda (Requisito 3).
  const [registrarOpen, setRegistrarOpen] = useState(false);
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
      interesse: [], negociando: [], fechado: [], perdido: [],
    };
    for (const s of sales) grouped[s.status].push(s);
    return grouped;
  }, [sales]);

  // KPIs editoriais (venda única, sem MRR). Valores em centavos.
  const kpis = useMemo(() => {
    const fechadas = salesByStage.fechado;
    // Total fechado: soma do valor das vendas em "fechado" (em centavos).
    const totalFechadoCents = fechadas.reduce((acc, s) => acc + (s.amountCents ?? 0), 0);
    // Pipeline em aberto: interesse + negociando (ainda não aceito nem perdido).
    const emAberto = salesByStage.interesse.length + salesByStage.negociando.length;
    // Conversão: fechadas sobre o que teve desfecho (fechadas + perdidas).
    const comDesfecho = fechadas.length + salesByStage.perdido.length;
    const conversao = comDesfecho > 0
      ? Math.round((fechadas.length / comDesfecho) * 100)
      : 0;
    // Ciclo médio (dias) = closedAt - createdAt das fechadas.
    const cycles = fechadas
      .map((s) => {
        if (!s.closedAt) return null;
        return (new Date(s.closedAt).getTime() - new Date(s.createdAt).getTime()) / 86400000;
      })
      .filter((d): d is number => d !== null && d >= 0);
    const cicloMedio = cycles.length > 0
      ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
      : 0;
    return { totalFechadoCents, emAberto, conversao, cicloMedio };
  }, [salesByStage]);

  // Move uma venda para a etapa de destino (sem motivo). Usado pelo drop direto
  // e, internamente, como base do fluxo de perda.
  const moveSale = async (sale: Sale, stage: SaleStatus, note?: string) => {
    try {
      await updateStatus.mutateAsync({ saleId: sale.id, status: stage, note });
      toast({ title: `Venda movida para "${SALE_STATUS_LABEL[stage]}"` });
    } catch (err) {
      toast({
        title: "Erro ao mover venda",
        description: err instanceof Error ? err.message : "Falha desconhecida",
        variant: "destructive",
      });
    }
  };

  const handleDrop = (stage: SaleStatus) => {
    if (!draggedId) return;
    const sale = sales.find((s) => s.id === draggedId);
    setDraggedId(null);
    if (!sale || sale.status === stage) return;

    // Ao mover para "perdido", abrimos o diálogo para capturar o motivo
    // (texto livre, opcional) antes de efetivar a mudança.
    if (stage === "perdido") {
      setLossReason("");
      setLossDialog({ sale });
      return;
    }

    void moveSale(sale, stage);
  };

  // Confirma a perda gravando o motivo (se houver) no histórico.
  const confirmLoss = async () => {
    if (!lossDialog) return;
    const { sale } = lossDialog;
    setLossDialog(null);
    await moveSale(sale, "perdido", lossReason.trim() || undefined);
    setLossReason("");
  };

  return (
    <div className="space-y-10">
      {/* Hero magazine 7+5 */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        <div className="lg:col-span-7">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-pv-accent mb-3 block">
            Pipeline de Vendas
          </span>
          <h1 className={`text-5xl md:text-7xl text-pv-ink leading-[1.05] ${pvSerif}`}>
            Pipeline de <br />Performance
          </h1>
          <p className="mt-5 text-base text-pv-ink/70 max-w-md leading-relaxed">
            Acompanhe suas propostas até o aceite. {sales.length} negócio(s) no
            funil — {salesByStage.fechado.length} já fechado(s).
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="max-w-[260px] flex-1 min-w-[200px]">
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger className="h-9 text-xs rounded-none bg-white border-pv-mid/40">
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
            {/* Registro manual de venda (Requisito 3) */}
            <button
              type="button"
              onClick={() => setRegistrarOpen(true)}
              className="inline-flex items-center gap-1.5 bg-pv-ink hover:bg-pv-accent text-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Registrar venda
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 grid grid-cols-2 gap-3">
          <KpiBlock
            kicker="Total Fechado"
            value={fmtCents(kpis.totalFechadoCents)}
            accent="gold"
            bar={Math.min(1, kpis.totalFechadoCents / Math.max(kpis.totalFechadoCents, 5000000))}
          />
          <KpiBlock
            kicker="Ciclo Médio"
            value={kpis.cicloMedio > 0 ? `${kpis.cicloMedio} d` : "—"}
            accent="accent"
            sparkline
          />
          <KpiBlock
            kicker="Em Aberto"
            value={String(kpis.emAberto)}
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
          const totalColCents = items.reduce((acc, s) => acc + (s.amountCents ?? 0), 0);
          // "Fechado" é a coluna de destaque (cartão escuro/gold).
          const isHighlight = stage === "fechado";
          return (
            <div
              key={stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(stage)}
              className="space-y-3 min-h-[200px]"
            >
              <div className="flex items-center justify-between border-b border-pv-mid pb-2">
                <h3 className="uppercase text-[10px] tracking-[0.2em] font-bold text-pv-ink">
                  {SALE_STATUS_LABEL[stage]} ({items.length})
                </h3>
                <span className={`text-[10px] font-medium ${isHighlight ? "text-pv-gold" : "text-pv-accent"}`}>
                  {fmtCents(totalColCents)}
                </span>
              </div>

              {isLoading && (
                <p className="text-[10px] text-pv-ink/40 text-center py-6">Carregando...</p>
              )}
              {!isLoading && items.length === 0 && (
                <p className="text-[10px] text-pv-ink/40 text-center py-6 italic">
                  Arraste cards aqui
                </p>
              )}

              {items.map((sale) => (
                <SaleCard
                  key={sale.id}
                  sale={sale}
                  product={productById.get(sale.productId)}
                  dark={isHighlight}
                  onDragStart={() => setDraggedId(sale.id)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Diálogo de motivo de perda (texto livre, opcional) */}
      <Dialog open={lossDialog !== null} onOpenChange={(open) => !open && setLossDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como perdido</DialogTitle>
            <DialogDescription>
              Se quiser, registre o motivo da perda. É opcional e fica no
              histórico do negócio para consulta futura.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={lossReason}
            onChange={(e) => setLossReason(e.target.value)}
            placeholder="Ex.: cliente achou caro, fechou com concorrente, sem retorno..."
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLossDialog(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmLoss()} disabled={updateStatus.isPending}>
              Confirmar perda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de registro manual de venda (Requisito 3) */}
      <RegistrarVendaDialog
        consultantId={consultantId}
        open={registrarOpen}
        onOpenChange={setRegistrarOpen}
      />
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
    accent === "gold" ? "border-pv-gold" : accent === "ink" ? "border-pv-ink" : "border-pv-accent";
  const bg = accent === "gold" ? "bg-pv-surface" : "bg-white/60";
  return (
    <div className={`${bg} p-5 border-l-4 ${borderColor} min-h-[110px] flex flex-col justify-between`}>
      <span className="text-[10px] uppercase tracking-[0.18em] text-pv-ink/60 font-semibold">
        {kicker}
      </span>
      <div>
        <div className={`text-3xl font-light text-pv-ink mt-1 ${pvSerif}`}>{value}</div>
        {bar !== undefined && (
          <div className="mt-2 h-1 w-full bg-pv-mid/30 overflow-hidden">
            <div className="h-full bg-pv-gold" style={{ width: `${Math.round(bar * 100)}%` }} />
          </div>
        )}
        {sparkline && (
          <svg className="mt-2 w-full h-4" viewBox="0 0 100 20" preserveAspectRatio="none">
            <path
              d="M0,15 Q25,5 50,15 T100,5"
              fill="none"
              stroke="hsl(var(--pv-accent))"
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
        className="bg-pv-ink p-4 border border-pv-ink shadow-lg cursor-grab active:cursor-grabbing"
      >
        <div className="flex justify-between items-start">
          <span className="text-[10px] font-semibold text-pv-gold uppercase tracking-wider">
            {familyLabel}
          </span>
          <span className="text-[9px] text-white/40 italic">{timeLabel}</span>
        </div>
        <h4 className={`text-base mt-2 text-pv-bg font-medium leading-tight`}>
          {product?.name ?? "Produto"}
        </h4>
        <div className="mt-3 flex items-center justify-between">
          {sale.pointsKwh > 0 && (
            <span className="text-xs text-pv-bg/60">{KWH(sale.pointsKwh)}</span>
          )}
          {sale.amountCents !== null && (
            <span className="text-xs font-semibold text-pv-gold">{fmtCents(sale.amountCents)}</span>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-pv-accent" />
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
      className="group bg-white p-4 border border-pv-surface hover:border-pv-accent hover:shadow-sm transition-all cursor-grab active:cursor-grabbing"
    >
      <div className="flex justify-between items-start">
        <span className="text-[10px] font-semibold text-pv-accent uppercase tracking-wider">
          {familyLabel}
        </span>
        <span className="text-[9px] text-pv-ink/40">{timeLabel}</span>
      </div>
      <h4 className="text-base mt-1.5 text-pv-ink font-medium leading-tight">
        {product?.name ?? "Produto"}
      </h4>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-xs text-pv-ink/70">
          {sale.pointsKwh > 0 ? KWH(sale.pointsKwh) : "—"}
        </div>
        <div className="text-xs font-semibold text-pv-ink">
          {fmtCents(sale.amountCents)}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-pv-bg flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${action.dot}`} />
        <span className="text-[10px] text-pv-ink/60">{action.label}</span>
      </div>
      {sale.notes && (
        <p className="mt-2 text-[10px] text-pv-ink/50 line-clamp-2 italic">{sale.notes}</p>
      )}
    </div>
  );
}
