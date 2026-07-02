// =============================================================================
// Acompanhamento — Painel de pontos e comissão
// =============================================================================
// Dashboard do consultor: vendas ativas, pontos kWh-equivalente acumulados,
// comissão estimada por produto e progresso no plano de carreira. Os pontos
// vêm de `sales` (Bloco B); a comissão é uma ESTIMATIVA local — o valor oficial
// é o do portal iGreen, deixado explícito na UI para não induzir erro.
// =============================================================================

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrendingUp, Zap, Wallet, Award, Repeat, Clock, Leaf, HandCoins, Hourglass, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useProducts } from "../catalogo/hooks";
import { PRODUCT_FAMILY_LABEL } from "../catalogo/types";
import { useProposals } from "../orcamento/hooks";
import { useSales } from "../vendas/hooks";
import {
  summarizeSales,
  computeFinancialMetrics,
  filterSalesByProduct,
  filterProposalsByProduct,
} from "./aggregate";
import { computeCareerProgress } from "./careerPlan";
import { useGreenSettings, useEntradaRules, useValidatedCustomers, useLastIgreenSync } from "./greenHooks";
import { computeGreenGains, graduacaoDisplay, careerBonusPercent } from "./greenCommission";
import { EntradaRulesDialog } from "./EntradaRulesDialog";
import { FaturasGreenPanel } from "./FaturasGreenPanel";
import { loadLocalGreenSettings } from "./greenData";
import { formatBRLFromCents } from "../lib/money";
import { VendasEmAndamentoPanel } from "./VendasEmAndamentoPanel";

// AutomacaoIgreenCard foi movido para a Central de Agendamentos.
import { CrossSellCard } from "./CrossSellCard";


interface AcompanhamentoPanelProps {
  consultantId: string;
  onOpenPosVenda?: (customerId: string) => void;
  onOpenSettings?: () => void;
}

// BRL: usado pelos ganhos Conexão Green e plano de carreira, que trabalham em
// reais (outro módulo). As métricas de venda usam formatBRLFromCents (centavos).
const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const KWH = (n: number) => `${n.toLocaleString("pt-BR")} kWh`;

export function AcompanhamentoPanel({
  consultantId,
  onOpenPosVenda,
  onOpenSettings,
}: AcompanhamentoPanelProps) {
  const [productFilter, setProductFilter] = useState<string>("all");
  const { data: products = [] } = useProducts();
  const { data: sales = [], isLoading: salesLoading } = useSales({ consultantId });
  const { data: proposals = [], isLoading: proposalsLoading } = useProposals(consultantId);

  const filteredSales = useMemo(
    () => filterSalesByProduct(sales, productFilter),
    [sales, productFilter],
  );
  const filteredProposals = useMemo(
    () => filterProposalsByProduct(proposals, productFilter),
    [proposals, productFilter],
  );

  // Comissão Green: graduação + regras de entrada + clientes validados
  const { data: greenSettings } = useGreenSettings(consultantId);
  const { data: entradaRules = [] } = useEntradaRules(consultantId);
  const { data: validated, isLoading: greenLoading } = useValidatedCustomers(consultantId);
  const { data: lastIgreenSync } = useLastIgreenSync();

  const isLoading = salesLoading || proposalsLoading || greenLoading;

  const localFallback = loadLocalGreenSettings(consultantId);
  const graduacaoKey = greenSettings?.graduacao ?? localFallback?.graduacao ?? "licenciado";
  const gradInfo = graduacaoDisplay(graduacaoKey);
  const bonusPct = careerBonusPercent(graduacaoKey);

  const greenGains = useMemo(() => {
    if (!validated) return null;
    const settings = validated.settings;
    const entrada = computeGreenGains(validated.thisMonth, entradaRules, settings);
    const recorrenteCrm = computeGreenGains(validated.allActiveCrm, entradaRules, settings);
    const recorrentePotencial = computeGreenGains(validated.potencialIgreen, entradaRules, settings);
    return {
      entradaImediata: entrada.entradaImediata,
      entradaDiferida: entrada.entradaDiferida,
      recorrenteMensal: recorrenteCrm.recorrenteMensal,
      recorrentePotencial: recorrentePotencial.recorrenteMensal,
      validadosMes: validated.thisMonth.filter((c) => c.isDirect).length,
      portfolio: validated.portfolio,
      semFatura: validated.semFaturaCount,
    };
  }, [validated, entradaRules]);

  /** Exemplo: bônus carreira em fatura média R$ 300 (4% base + bônus). */
  const exemploFatura = 300;
  const bonusExemploMensal = (exemploFatura * bonusPct) / 100;

  const summary = useMemo(() => summarizeSales(filteredSales, products), [filteredSales, products]);
  const financial = useMemo(
    () => computeFinancialMetrics(filteredSales, products, filteredProposals),
    [filteredSales, products, filteredProposals],
  );
  const career = useMemo(() => computeCareerProgress(summary.totalPointsKwh), [summary.totalPointsKwh]);

  const syncLabel = useMemo(() => {
    if (!lastIgreenSync) return "Sync iGreen: nunca registrada";
    const d = new Date(lastIgreenSync);
    if (Number.isNaN(d.getTime())) return "Sync iGreen: data inválida";
    const hours = (Date.now() - d.getTime()) / 3_600_000;
    const relative = formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
    if (hours > 48) return `Sync iGreen: ${relative} — dados podem estar desatualizados`;
    return `Sync iGreen: ${relative}`;
  }, [lastIgreenSync]);

  const needsGraduacaoSetup = graduacaoKey === "licenciado" && !greenSettings?.graduacao;
  const needsEntradaRules = entradaRules.length === 0;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-10 text-pv-ink">



      {/* Cross-sell manual: energia → telecom/seguros (consultor decide enviar) */}
      <CrossSellCard consultantId={consultantId} />

      {/* Automações iGreen agora moram na Central de Agendamentos (aba "Automações iGreen"). */}

      {/* Onboarding / alertas de configuração */}
      {(needsGraduacaoSetup || needsEntradaRules) && (
        <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-foreground">Complete seu painel de ganhos</p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
            {needsGraduacaoSetup && (
              <li>
                Configure sua graduação em{" "}
                {onOpenSettings ? (
                  <button type="button" className="text-primary underline" onClick={onOpenSettings}>
                    Dados → Plano de Carreira
                  </button>
                ) : (
                  "Dados → Plano de Carreira"
                )}
                .
              </li>
            )}
            {needsEntradaRules && (
              <li className="flex items-center gap-1 flex-wrap">
                Cadastre suas{" "}
                <EntradaRulesDialog
                  consultantId={consultantId}
                  trigger={
                    <button type="button" className="text-primary underline font-medium">
                      regras de entrada
                    </button>
                  }
                />{" "}
                por distribuidora.
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Hero magazine 7+5 */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        <div className="lg:col-span-7">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-pv-accent mb-3 block">
            Acompanhamento
          </span>
          <h1 className="text-5xl md:text-7xl text-pv-ink leading-[1.05] font-[DM_Serif_Display,Georgia,serif]">
            Sua performance<br />em movimento
          </h1>
          <p className="mt-5 text-base text-pv-ink/70 max-w-md leading-relaxed">
            {summary.totalClosed} negócio(s) fechado(s) acumulando {KWH(summary.totalPointsKwh)} no plano
            de carreira. Valor total fechado de <span className="font-semibold text-pv-accent">{formatBRLFromCents(financial.totalFechado)}</span>.
          </p>
          <div className="mt-4 max-w-xs">
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
        </div>
        <div className="lg:col-span-5 grid grid-cols-2 gap-3">
          {/* Topo: o total fechado é o número que o consultor quer ver primeiro —
              é o valor dos negócios que já bateram o martelo (venda única). */}
          <HeroKpi kicker="Total fechado" value={formatBRLFromCents(financial.totalFechado)} accent="gold" />
          <HeroKpi kicker="Negócios fechados" value={String(summary.totalClosed)} accent="accent" />
          <HeroKpi kicker="Pontos kWh" value={summary.totalPointsKwh.toLocaleString("pt-BR")} accent="accent" />
          <HeroKpi kicker="Nível" value={gradInfo.label} accent="ink" />
        </div>
      </section>

      {/* Cards de desempenho */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Negócios fechados"
          value={`${summary.totalClosed}`}
          hint={`${summary.totalSales} no total`}
        />
        <SummaryCard
          icon={<Zap className="h-4 w-4" />}
          label="Pontos acumulados"
          value={KWH(summary.totalPointsKwh)}
          hint="kWh-equivalente"
        />
        <SummaryCard
          icon={<Award className="h-4 w-4" />}
          label="Nível atual"
          value={gradInfo.label}
          hint="Graduação iGreen · sync da rede ou Dados"
        />
        <SummaryCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Propostas aceitas"
          value={`${financial.proposalsAccepted}`}
          hint="orçamentos convertidos em fechamento"
        />
      </div>

      {/* Cards financeiros — venda única (sem recorrência/MRR) */}
      <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-3">
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total fechado"
          value={formatBRLFromCents(financial.totalFechado)}
          hint="soma dos negócios já fechados"
        />
        <SummaryCard
          icon={<HandCoins className="h-4 w-4" />}
          label="Comissão estimada"
          value={formatBRLFromCents(financial.totalEstimatedCommission)}
          hint="estimativa local · oficial no portal iGreen"
        />
        <SummaryCard
          icon={<Clock className="h-4 w-4" />}
          label="Pipeline em aberto"
          value={formatBRLFromCents(financial.pipelineValue)}
          hint={`${financial.proposalsPending} orçamento(s) aguardando resposta`}
        />
      </div>

      <p className="text-[10px] text-muted-foreground -mt-2">
        Total fechado e comissão consideram apenas negócios com status Fechado (cliente aceitou). O
        pipeline soma os orçamentos que ainda aguardam resposta. A comissão é uma estimativa
        calculada localmente — o valor oficial é sempre o do portal iGreen.
      </p>

      {/* Vendas em andamento (Placas, Solar, Seguros, Telecom) */}
      <section className="rounded-xl border border-border/60 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-pv-accent">
            Vendas em Andamento
          </span>
          <span className="text-[10px] text-pv-ink/40">
            Placas · Solar · Seguros · Telecom
          </span>
        </div>
        <VendasEmAndamentoPanel consultantId={consultantId} />
      </section>

      {/* Ganhos Conexão Green migrou para /admin?tab=financeiro&sub=recebiveis */}
      <a
        href="/admin?tab=financeiro&sub=recebiveis"
        className="block rounded-xl border border-border/60 bg-primary/5 hover:bg-primary/10 transition-colors p-4"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Leaf className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Ganhos Conexão Green</p>
              <p className="text-[11px] text-muted-foreground">
                Entrada, recorrente e projeção 12 meses agora vivem em Financeiro → Recebíveis.
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="text-[10px] gap-1">
            <Award className="h-3 w-3" />
            {gradInfo.label} · +{bonusPct}% carreira
          </Badge>
          <span className="text-primary text-xs font-medium">Abrir Recebíveis →</span>
        </div>
      </a>


      {/* Faturas Green — acompanhamento de valor de conta (não é cobrança/NF) */}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/60">
          <h3 className="text-sm font-semibold text-foreground">Faturas Green</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Valor da conta de luz por cliente sync — base para o recorrente estimado.
          </p>
        </div>
        <div className="p-4">
          <FaturasGreenPanel
            clients={validated?.faturaClients ?? []}
            onOpenPosVenda={onOpenPosVenda}
          />
        </div>
      </div>

      {/* Progresso no plano de carreira */}
      <div className="rounded-xl border border-border/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Progresso no plano de carreira</h3>
          <Badge variant="secondary" className="text-[10px]">{gradInfo.label}</Badge>
        </div>
        <Progress value={career.ratioToNext * 100} className="h-2" />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{KWH(career.totalKwh)} · eixo kWh</span>
          {career.next ? (
            <span>
              Faltam {KWH(career.kwhToNext)} em pontos para {career.next.label} (eixo kWh)
            </span>
          ) : (
            <span>Topo do eixo kWh</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          O nível exibido no topo vem da graduação iGreen (sync da rede ou Dados). A barra abaixo
          mede só o eixo de kWh-equivalente das vendas ativas no CRM. Requisitos de licenciados e
          recrutamento são validados no portal oficial iGreen.
        </p>
      </div>

      {/* Detalhamento por produto */}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/60">
          <h3 className="text-sm font-semibold text-foreground">Desempenho por produto</h3>
        </div>
        {summary.byProduct.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            Nenhuma venda registrada ainda.
          </p>
        ) : (
          <div className="divide-y divide-border/40">
            {summary.byProduct.map((row) => (
              <div key={row.productId} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{row.productName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {row.closedCount} fechado(s) · {row.totalCount} no total
                  </p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Pontos</p>
                    <p className="text-xs font-medium text-success">{KWH(row.pointsKwh)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Comissão est.</p>
                    <p className="text-xs font-medium text-foreground">{formatBRLFromCents(row.estimatedCommission)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}

function SummaryCard({ icon, label, value, hint }: SummaryCardProps) {
  return (
    <div className="rounded-xl border border-border/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground mt-2">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function HeroKpi({
  kicker,
  value,
  accent,
}: {
  kicker: string;
  value: string;
  accent: "gold" | "accent" | "ink";
}) {
  const borderColor =
    accent === "gold" ? "border-pv-gold" : accent === "ink" ? "border-pv-ink" : "border-pv-accent";
  const bg = accent === "gold" ? "bg-pv-surface" : "bg-white/60";
  return (
    <div className={`${bg} p-5 border-l-4 ${borderColor} min-h-[110px] flex flex-col justify-between`}>
      <span className="text-[10px] uppercase tracking-[0.18em] text-pv-ink/60 font-semibold">
        {kicker}
      </span>
      <div className="text-2xl font-light text-pv-ink mt-1 font-[DM_Serif_Display,Georgia,serif]">
        {value}
      </div>
    </div>
  );
}

function StatPill({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-2 py-1.5 text-center ${highlight ? "border-primary/40 bg-primary/5" : "border-border/50 bg-background/60"}`}>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
