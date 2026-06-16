// =============================================================================
// Acompanhamento — Painel de pontos e comissão
// =============================================================================
// Dashboard do consultor: vendas ativas, pontos kWh-equivalente acumulados,
// comissão estimada por produto e progresso no plano de carreira. Os pontos
// vêm de `sales` (Bloco B); a comissão é uma ESTIMATIVA local — o valor oficial
// é o do portal iGreen, deixado explícito na UI para não induzir erro.
// =============================================================================

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Zap, Wallet, Award, Repeat, Clock, Leaf, HandCoins, Hourglass, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useProducts } from "../catalogo/hooks";
import { useProposals } from "../orcamento/hooks";
import { useSales } from "../vendas/hooks";
import { summarizeSales, computeFinancialMetrics } from "./aggregate";
import { computeCareerProgress } from "./careerPlan";
import { useGreenSettings, useEntradaRules, useValidatedCustomers } from "./greenHooks";
import { computeGreenGains, graduacaoDisplay, careerBonusPercent } from "./greenCommission";
import { EntradaRulesDialog } from "./EntradaRulesDialog";
import { loadLocalGreenSettings } from "./greenData";
import { formatBRLFromCents } from "../lib/money";

interface AcompanhamentoPanelProps {
  consultantId: string;
}

// BRL: usado pelos ganhos Conexão Green e plano de carreira, que trabalham em
// reais (outro módulo). As métricas de venda usam formatBRLFromCents (centavos).
const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const KWH = (n: number) => `${n.toLocaleString("pt-BR")} kWh`;

export function AcompanhamentoPanel({ consultantId }: AcompanhamentoPanelProps) {
  const { data: products = [] } = useProducts();
  const { data: sales = [], isLoading: salesLoading } = useSales({ consultantId });
  const { data: proposals = [], isLoading: proposalsLoading } = useProposals(consultantId);

  // Comissão Green: graduação + regras de entrada + clientes validados
  const { data: greenSettings } = useGreenSettings(consultantId);
  const { data: entradaRules = [] } = useEntradaRules(consultantId);
  const { data: validated, isLoading: greenLoading } = useValidatedCustomers(consultantId);

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

  const summary = useMemo(() => summarizeSales(sales, products), [sales, products]);
  const financial = useMemo(
    () => computeFinancialMetrics(sales, products, proposals),
    [sales, products, proposals],
  );
  const career = useMemo(() => computeCareerProgress(summary.totalPointsKwh), [summary.totalPointsKwh]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-10 text-[#1a2e1f]">
      {/* Hero magazine 7+5 */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
        <div className="lg:col-span-7">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#7d9b76] mb-3 block">
            Acompanhamento
          </span>
          <h1 className="text-5xl md:text-7xl text-[#1a2e1f] leading-[1.05] font-[DM_Serif_Display,Georgia,serif]">
            Sua performance<br />em movimento
          </h1>
          <p className="mt-5 text-base text-[#1a2e1f]/70 max-w-md leading-relaxed">
            {summary.totalClosed} negócio(s) fechado(s) acumulando {KWH(summary.totalPointsKwh)} no plano
            de carreira. Valor total fechado de <span className="font-semibold text-[#7d9b76]">{formatBRLFromCents(financial.totalFechado)}</span>.
          </p>
        </div>
        <div className="lg:col-span-5 grid grid-cols-2 gap-3">
          {/* Topo: o total fechado é o número que o consultor quer ver primeiro —
              é o valor dos negócios que já bateram o martelo (venda única). */}
          <HeroKpi kicker="Total fechado" value={formatBRLFromCents(financial.totalFechado)} accent="gold" />
          <HeroKpi kicker="Negócios fechados" value={String(summary.totalClosed)} accent="accent" />
          <HeroKpi kicker="Pontos kWh" value={summary.totalPointsKwh.toLocaleString("pt-BR")} accent="accent" />
          <HeroKpi kicker="Nível" value={career.current.label} accent="ink" />
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
          value={career.current.label}
          hint={career.next ? `Próximo: ${career.next.label}` : "Nível máximo"}
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

      {/* Ganhos Conexão Green — entrada + recorrente + carteira */}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Leaf className="h-4 w-4 text-primary" /> Ganhos Conexão Green
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-[10px] gap-1 font-semibold">
              <Award className="h-3 w-3" />
              {gradInfo.label} · +{bonusPct.toLocaleString("pt-BR")}% carreira
            </Badge>
            <EntradaRulesDialog consultantId={consultantId} />
          </div>
        </div>

        {/* Graduação + valor do bônus — sempre visível */}
        <div className="px-4 py-3 bg-primary/5 border-b border-border/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-foreground">
              Plano de carreira: {gradInfo.label}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Bônus somado ao recorrente: <span className="text-primary font-semibold">+{bonusPct.toLocaleString("pt-BR")}%</span>
              {" "}· ex.: fatura {BRL(exemploFatura)} → +{BRL(bonusExemploMensal)}/mês só de carreira
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Altere em Dados → Plano de Carreira
          </p>
        </div>

        {/* Breakdown carteira sync */}
        {greenGains?.portfolio && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 px-4 py-3 border-b border-border/40 bg-muted/20">
            <StatPill label="Total sync" value={greenGains.portfolio.totalSync} />
            <StatPill label="Diretos (CP)" value={greenGains.portfolio.diretosCp} highlight />
            <StatPill label="Validados iGreen" value={greenGains.portfolio.validadosIgreen} />
            <StatPill label="Validados CRM" value={greenGains.portfolio.validadosCrm} />
            <StatPill label="Falta assinatura" value={greenGains.portfolio.faltaAssinatura} />
            <StatPill label="Fatura informada" value={greenGains.portfolio.comFaturaReal} />
            <StatPill label="Fatura estimada" value={greenGains.portfolio.comFaturaEstimada} />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 p-4">
          <SummaryCard
            icon={<HandCoins className="h-4 w-4" />}
            label="Entrada agora (mês)"
            value={BRL(greenGains?.entradaImediata ?? 0)}
            hint={`${greenGains?.validadosMes ?? 0} validados CRM seus no mês`}
          />
          <SummaryCard
            icon={<Hourglass className="h-4 w-4" />}
            label="Entrada a receber"
            value={BRL(greenGains?.entradaDiferida ?? 0)}
            hint="2ª parcela (90 dias)"
          />
          <SummaryCard
            icon={<Repeat className="h-4 w-4" />}
            label="Recorrente CRM/mês"
            value={BRL(greenGains?.recorrenteMensal ?? 0)}
            hint={`${greenGains?.portfolio?.validadosCrm ?? 0} validados no CRM · inclui +${bonusPct}% carreira`}
          />
          <SummaryCard
            icon={<TrendingUp className="h-4 w-4" />}
            label="Potencial iGreen/mês"
            value={BRL(greenGains?.recorrentePotencial ?? 0)}
            hint={`${greenGains?.portfolio?.validadosIgreen ?? 0} Validados iGreen · fatura estimada por consumo`}
          />
        </div>
        {(greenGains?.semFatura ?? 0) > 0 && (
          <div className="px-4 pb-3 -mt-1">
            <p className="text-[11px] text-warning flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {greenGains?.semFatura} cliente(s) validado(s) sem valor de fatura — informe o valor no Pós-Venda para entrar no cálculo.
            </p>
          </div>
        )}
        {entradaRules.length === 0 && (
          <div className="px-4 pb-3 -mt-1">
            <p className="text-[11px] text-muted-foreground">
              Você ainda não cadastrou faixas de entrada. Clique em <span className="font-medium">Regras de entrada</span> para definir
              quantas pessoas valem cada % por distribuidora.
            </p>
          </div>
        )}
        <p className="px-4 pb-3 text-[10px] text-muted-foreground">
          Entrada paga uma vez por cliente (parcela agora + parcela depois). Recorrente se repete todo mês.
          Valores estimados — o oficial é o do portal iGreen.
        </p>
      </div>

      {/* Progresso no plano de carreira */}
      <div className="rounded-xl border border-border/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Progresso no plano de carreira</h3>
          <Badge variant="secondary" className="text-[10px]">{career.current.label}</Badge>
        </div>
        <Progress value={career.ratioToNext * 100} className="h-2" />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{KWH(career.totalKwh)}</span>
          {career.next ? (
            <span>
              Faltam {KWH(career.kwhToNext)} para {career.next.label}
            </span>
          ) : (
            <span>Nível máximo atingido</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          A progressão considera apenas o eixo de kWh-equivalente das vendas ativas. Requisitos de
          licenciados e recrutamento são validados no portal oficial iGreen.
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
    accent === "gold" ? "border-[#c9a84c]" : accent === "ink" ? "border-[#1a2e1f]" : "border-[#7d9b76]";
  const bg = accent === "gold" ? "bg-[#dce5d4]" : "bg-white/60";
  return (
    <div className={`${bg} p-5 border-l-4 ${borderColor} min-h-[110px] flex flex-col justify-between`}>
      <span className="text-[10px] uppercase tracking-[0.18em] text-[#1a2e1f]/60 font-semibold">
        {kicker}
      </span>
      <div className="text-2xl font-light text-[#1a2e1f] mt-1 font-[DM_Serif_Display,Georgia,serif]">
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
