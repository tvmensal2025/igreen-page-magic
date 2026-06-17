// =============================================================================
// Vendas em Andamento — Painel de acompanhamento (Placas, Solar, Seguros, Telecom)
// =============================================================================
// Mostra ao consultor o fluxo real de cada negócio: propostas aguardando
// resposta (com destaque por valor/urgência), vendas fechadas com progresso
// da esteira e mini-timeline orçamento→venda.
//
// Foco: Conexão Placas, Conexão Solar, Conexão Seguros, Conexão Telecom.
// A Conexão Green tem acompanhamento em outra parte da plataforma.
// =============================================================================

import { useMemo } from "react";
import {
  Clock,
  Eye,
  Send,
  CheckCircle2,
  XCircle,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useProducts } from "../catalogo/hooks";
import { useProposals } from "../orcamento/hooks";
import { useSales } from "../vendas/hooks";
import { useSaleStages } from "../esteira/hooks";
import { computeProgress } from "../esteira/logic";
import { formatBRLFromCents } from "../lib/money";
import type { Product } from "../catalogo/types";
import type { Proposal, ProposalStatus } from "../orcamento/types";
import type { Sale } from "../vendas/types";
import { pvSerif } from "../theme";

// Slugs dos produtos de venda direta (exclui green/club/expansao).
const VENDA_DIRETA_SLUGS = new Set([
  "conexao-placas",
  "conexao-solar",
  "conexao-seguros",
  "conexao-telecom",
]);

const PENDING_STATUSES: ProposalStatus[] = ["sent", "viewed", "countered"];

const STATUS_ICON: Record<string, React.ReactNode> = {
  sent: <Send className="h-3.5 w-3.5 text-sky-500" />,
  viewed: <Eye className="h-3.5 w-3.5 text-amber-500" />,
  countered: <FileText className="h-3.5 w-3.5 text-orange-500" />,
  accepted: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
  rejected: <XCircle className="h-3.5 w-3.5 text-red-500" />,
};

const STATUS_LABEL_PT: Record<string, string> = {
  sent: "Enviado",
  viewed: "Visualizado",
  countered: "Contraproposta",
  accepted: "Aceito",
  rejected: "Recusado",
  expired: "Expirado",
  draft: "Rascunho",
};

interface VendasEmAndamentoPanelProps {
  consultantId: string;
}

export function VendasEmAndamentoPanel({ consultantId }: VendasEmAndamentoPanelProps) {
  const { data: products = [] } = useProducts();
  const { data: proposals = [], isLoading: proposalsLoading } = useProposals(consultantId);
  const { data: sales = [], isLoading: salesLoading } = useSales({ consultantId });

  const isLoading = proposalsLoading || salesLoading;

  // IDs de produtos de venda direta.
  const vendaDiretaProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of products) {
      if (VENDA_DIRETA_SLUGS.has(p.slug)) ids.add(p.id);
    }
    return ids;
  }, [products]);

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  // Propostas pendentes de venda direta (sent/viewed/countered).
  const pendingProposals = useMemo(() => {
    return proposals
      .filter(
        (p) =>
          vendaDiretaProductIds.has(p.productId) &&
          PENDING_STATUSES.includes(p.status),
      )
      .sort((a, b) => {
        // Priorizar as visualizadas (mais quentes), depois por valor decrescente.
        const statusOrder: Record<string, number> = { viewed: 0, countered: 1, sent: 2 };
        const oa = statusOrder[a.status] ?? 3;
        const ob = statusOrder[b.status] ?? 3;
        if (oa !== ob) return oa - ob;
        return (b.amountCents ?? 0) - (a.amountCents ?? 0);
      });
  }, [proposals, vendaDiretaProductIds]);

  // Vendas fechadas de venda direta (etapas em andamento).
  const closedSales = useMemo(() => {
    return sales.filter(
      (s) => vendaDiretaProductIds.has(s.productId) && s.status === "fechado",
    );
  }, [sales, vendaDiretaProductIds]);

  // Propostas aceitas recentes (confirmação de conversão).
  const recentAccepted = useMemo(() => {
    return proposals
      .filter(
        (p) =>
          vendaDiretaProductIds.has(p.productId) && p.status === "accepted",
      )
      .slice(0, 5);
  }, [proposals, vendaDiretaProductIds]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-pv-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  const hasContent =
    pendingProposals.length > 0 || closedSales.length > 0 || recentAccepted.length > 0;

  if (!hasContent) {
    return (
      <div className="text-center py-12 space-y-3">
        <FileText className="h-10 w-10 text-pv-ink/20 mx-auto" />
        <p className="text-sm text-pv-ink/60">
          Nenhum orçamento de Placas, Solar, Seguros ou Telecom foi enviado ainda.
        </p>
        <p className="text-xs text-pv-ink/40">
          Crie um orçamento no botão "Novo orçamento" acima para começar a acompanhar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Propostas aguardando resposta */}
      {pendingProposals.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-pv-accent" />
            <h3 className="text-sm font-semibold text-pv-ink uppercase tracking-wider">
              Aguardando resposta ({pendingProposals.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingProposals.map((p) => (
              <ProposalTrackingCard
                key={p.id}
                proposal={p}
                product={productById.get(p.productId)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Vendas fechadas com esteira */}
      {closedSales.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-pv-ink uppercase tracking-wider">
              Em pós-venda ({closedSales.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {closedSales.map((s) => (
              <SaleTrackingCard
                key={s.id}
                sale={s}
                product={productById.get(s.productId)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Conversões recentes */}
      {recentAccepted.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-pv-gold" />
            <h3 className="text-sm font-semibold text-pv-ink uppercase tracking-wider">
              Convertidos recentemente
            </h3>
          </div>
          <div className="space-y-2">
            {recentAccepted.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-white border border-pv-surface p-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {STATUS_ICON.accepted}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-pv-ink truncate">
                      {p.recipientName || "Cliente"}
                    </p>
                    <p className="text-[10px] text-pv-ink/50">
                      {productById.get(p.productId)?.name ?? "Produto"}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-pv-accent shrink-0 ml-2">
                  {p.amountCents ? formatBRLFromCents(p.amountCents) : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProposalTrackingCard({
  proposal,
  product,
}: {
  proposal: Proposal;
  product?: Product;
}) {
  const daysLeft = proposal.validUntil
    ? Math.ceil(
        (new Date(proposal.validUntil).getTime() - Date.now()) / 86400000,
      )
    : null;
  const isUrgent = daysLeft !== null && daysLeft > 0 && daysLeft <= 2;
  const isExpiring = daysLeft !== null && daysLeft <= 0;

  return (
    <div
      className={`bg-white border p-4 transition-colors ${
        proposal.status === "viewed"
          ? "border-amber-300 shadow-sm"
          : "border-pv-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {STATUS_ICON[proposal.status]}
            <span className="text-[10px] uppercase tracking-widest font-bold text-pv-ink/60">
              {STATUS_LABEL_PT[proposal.status] ?? proposal.status}
            </span>
            {isUrgent && (
              <span className="text-[9px] text-pv-gold font-semibold flex items-center gap-0.5">
                <AlertTriangle className="h-3 w-3" /> {daysLeft}d restante(s)
              </span>
            )}
            {isExpiring && (
              <span className="text-[9px] text-red-500 font-semibold">Expirada</span>
            )}
          </div>
          <h4 className={`text-base mt-1.5 text-pv-ink font-medium leading-tight`}>
            {proposal.recipientName || "Cliente"}
          </h4>
          <p className="text-[11px] text-pv-ink/60 mt-0.5">
            {product?.name ?? "Produto"}
            {proposal.recipientPhone && ` · ${proposal.recipientPhone}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-lg font-bold ${pvSerif} text-pv-ink`}>
            {proposal.amountCents ? formatBRLFromCents(proposal.amountCents) : "—"}
          </p>
          <p className="text-[10px] text-pv-ink/40">
            {proposal.amountPeriod === "month" ? "/mês" : "à vista"}
          </p>
        </div>
      </div>
      {/* Mini timeline */}
      <div className="mt-3 pt-3 border-t border-pv-bg flex items-center gap-3 text-[10px] text-pv-ink/50">
        <span>
          Criado{" "}
          {new Date(proposal.createdAt).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
          })}
        </span>
        {proposal.sentAt && (
          <>
            <span>→</span>
            <span>
              Enviado{" "}
              {new Date(proposal.sentAt).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
              })}
            </span>
          </>
        )}
        {proposal.status === "viewed" && (
          <>
            <span>→</span>
            <span className="text-amber-600 font-semibold">
              Visto (aguardando resposta)
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SaleTrackingCard({
  sale,
  product,
}: {
  sale: Sale;
  product?: Product;
}) {
  const { data: stages = [] } = useSaleStages(sale.id);
  const progress = computeProgress(stages);
  const currentStage = stages.find((s) => s.status === "pendente");

  return (
    <div className="bg-white border border-pv-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-pv-ink">
            {product?.name ?? "Produto"}
          </h4>
          <p className="text-[11px] text-pv-ink/60 mt-0.5">
            Fechado em{" "}
            {sale.closedAt
              ? new Date(sale.closedAt).toLocaleDateString("pt-BR")
              : new Date(sale.createdAt).toLocaleDateString("pt-BR")}
          </p>
        </div>
        <span className="text-sm font-bold text-pv-accent shrink-0">
          {sale.amountCents ? formatBRLFromCents(sale.amountCents) : "—"}
        </span>
      </div>

      {/* Barra de progresso da esteira */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-pv-ink/60">
          <span>
            {progress.done}/{progress.total} etapas
          </span>
          <span className="font-semibold">
            {Math.round(progress.ratio * 100)}%
          </span>
        </div>
        <Progress value={Math.round(progress.ratio * 100)} className="h-1.5" />
        {currentStage && (
          <p className="text-[10px] text-pv-ink/50 italic">
            Próxima: {currentStage.name}
          </p>
        )}
        {progress.total === 0 && (
          <p className="text-[10px] text-pv-ink/40 italic">
            Etapas ainda não instanciadas.
          </p>
        )}
      </div>
    </div>
  );
}
