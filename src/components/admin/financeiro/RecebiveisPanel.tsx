import { useMemo } from "react";
import { HandCoins, Hourglass, Repeat, TrendingUp, Award, AlertTriangle, Loader2 } from "lucide-react";
import { useEntradaRules, useValidatedCustomers, useGreenSettings } from "@/features/produtos/acompanhamento/greenHooks";
import { computeGreenGains, graduacaoDisplay, careerBonusPercent } from "@/features/produtos/acompanhamento/greenCommission";
import { loadLocalGreenSettings } from "@/features/produtos/acompanhamento/greenData";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Recebíveis Conexão Green: entrada + recorrente + projeção 12m.
 * Migrado de AcompanhamentoPanel — o dado é do consultor logado.
 */
export function RecebiveisPanel({ consultantId }: { consultantId: string }) {
  const { data: greenSettings } = useGreenSettings(consultantId);
  const { data: entradaRules = [] } = useEntradaRules(consultantId);
  const { data: validated, isLoading } = useValidatedCustomers(consultantId);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando recebíveis…
      </div>
    );
  }

  const recorrente = greenGains?.recorrenteMensal ?? 0;
  const projecao12m = recorrente * 12 + (greenGains?.entradaImediata ?? 0) + (greenGains?.entradaDiferida ?? 0);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Award className="w-4 h-4 text-primary" />
          <span className="font-semibold text-foreground">Plano de carreira:</span>
          <span>{gradInfo.label}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-primary font-semibold">+{bonusPct}% bônus carreira</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Ex.: fatura {BRL(300)} → +{BRL((300 * bonusPct) / 100)}/mês só de carreira
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<HandCoins className="w-4 h-4" />}
          label="Entrada agora (mês)"
          value={BRL(greenGains?.entradaImediata ?? 0)}
          hint={`${greenGains?.validadosMes ?? 0} validados CRM seus no mês`}
        />
        <MetricCard
          icon={<Hourglass className="w-4 h-4" />}
          label="Entrada a receber"
          value={BRL(greenGains?.entradaDiferida ?? 0)}
          hint="2ª parcela (~90 dias)"
        />
        <MetricCard
          icon={<Repeat className="w-4 h-4" />}
          label="Recorrente CRM/mês"
          value={BRL(recorrente)}
          hint={`${greenGains?.portfolio?.validadosCrm ?? 0} validados no CRM · inclui bônus`}
          highlight
        />
        <MetricCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Potencial iGreen/mês"
          value={BRL(greenGains?.recorrentePotencial ?? 0)}
          hint={`${greenGains?.portfolio?.validadosIgreen ?? 0} validados iGreen · fatura estimada`}
        />
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <TrendingUp className="w-3.5 h-3.5" />
          Projeção 12 meses
        </div>
        <p className="text-3xl font-bold mt-2">{BRL(projecao12m)}</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Recorrente × 12 + entradas (imediata + diferida). Estimativa — o oficial é o portal iGreen.
        </p>
      </div>

      {(greenGains?.semFatura ?? 0) > 0 && (
        <p className="text-[11px] text-amber-700 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {greenGains?.semFatura} cliente(s) validado(s) sem valor de fatura — informe no Pós-Venda para melhorar a estimativa.
        </p>
      )}

      {entradaRules.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Cadastre suas regras de entrada em Produtos → Acompanhamento para calcular a entrada por distribuidora.
        </p>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-primary/40 bg-primary/5" : "border-border/60 bg-card"}`}>
      <div className="flex items-center gap-2 text-muted-foreground text-[11px] uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <p className="text-lg font-bold mt-2">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>
    </div>
  );
}
