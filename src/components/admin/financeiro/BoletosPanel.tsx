import { useMemo } from "react";
import { CalendarClock, AlertTriangle, Clock, CheckCircle2, Percent, Loader2 } from "lucide-react";
import { useBoletosAdmin } from "./hooks";
import { computeFinanceiroKpis } from "./kpi";
import { BoletosAdminTable } from "./BoletosAdminTable";
import { BoletosTrendChart } from "./BoletosTrendChart";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  userId: string;
  scope: "all" | "self";
  onOpenChat?: (phone: string) => void;
}

/** Bloco de boletos: KPIs + gráfico + tabela filtrável + export CSV + cobrança em lote. */
export function BoletosPanel({ userId, scope, onOpenChat }: Props) {
  const { data: rows = [], isLoading } = useBoletosAdmin({ userId, scope });
  const kpis = useMemo(() => computeFinanceiroKpis(rows), [rows]);

  // Ticket médio (aberto) e inadimplência do mês (vencidos do mês / emitidos do mês).
  const extra = useMemo(() => {
    const abertos = rows.filter((r) => !r.pagamento);
    const ticket = abertos.length ? abertos.reduce((s, r) => s + Number(r.total || 0), 0) / abertos.length : 0;
    const inadPct = kpis.emitidosMesTotal
      ? Math.round((kpis.vencidosMesTotal / kpis.emitidosMesTotal) * 100)
      : 0;
    return { ticket, inadPct };
  }, [rows, kpis]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 min-w-0">
        <KpiCard
          icon={<CalendarClock className="w-5 h-5" />}
          label="Vence hoje"
          value={kpis.venceHojeCount}
          money={BRL(kpis.venceHojeTotal)}
          tone="amber"
        />
        <KpiCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Vencidos"
          value={kpis.vencidosCount}
          money={BRL(kpis.vencidosTotal)}
          tone="red"
        />
        <KpiCard
          icon={<Clock className="w-5 h-5" />}
          label="Vence em 7d"
          value={kpis.vence7dCount}
          money={BRL(kpis.vence7dTotal)}
          tone="blue"
        />
        <KpiCard
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="Pagos no mês"
          value={kpis.pagosMesCount}
          money={BRL(kpis.pagosMesTotal)}
          tone="emerald"
        />
        <KpiCard
          icon={<Percent className="w-5 h-5" />}
          label="Inadimplência (mês)"
          value={extra.inadPct}
          money={`${kpis.vencidosMesCount} de ${kpis.emitidosMesCount} boletos`}
          tone="red"
          asPercent
          title="Vencidos do mês corrente ÷ emitidos do mês corrente"
        />
        <KpiCard
          icon={<CalendarClock className="w-5 h-5" />}
          label="Ticket médio"
          value={0}
          money={BRL(extra.ticket)}
          tone="blue"
          hideValue
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando boletos…
        </div>
      ) : (
        <>
          <BoletosTrendChart rows={rows} />
          <BoletosAdminTable rows={rows} currentUserId={userId} onOpenChat={onOpenChat} />
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        Dados sincronizados do escritório oficial iGreen. Atualizações vêm do worker em segundo plano —
        se um valor parecer defasado, aguarde o próximo ciclo de sincronização.
      </p>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  money,
  tone,
  asPercent,
  hideValue,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  money: string;
  tone: "amber" | "red" | "blue" | "emerald";
  asPercent?: boolean;
  hideValue?: boolean;
  title?: string;
}) {
  const toneMap = {
    amber: "bg-amber-500/10 text-amber-700 border-amber-500/20",
    red: "bg-red-500/10 text-red-600 border-red-500/20",
    blue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    emerald: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  } as const;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4" title={title}>
      <div className={`inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium border ${toneMap[tone]}`}>
        {icon}
        {label}
      </div>
      {!hideValue && (
        <p className="text-2xl font-bold mt-3">
          {value.toLocaleString("pt-BR")}
          {asPercent ? "%" : ""}
        </p>
      )}
      <p className={`text-xs text-muted-foreground ${hideValue ? "mt-3 text-lg font-bold text-foreground" : "mt-0.5"}`}>{money}</p>
    </div>
  );
}
