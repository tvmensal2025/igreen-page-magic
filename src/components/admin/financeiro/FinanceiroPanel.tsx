import { useMemo } from "react";
import { CalendarClock, AlertTriangle, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { useBoletosAdmin } from "./hooks";
import { computeFinanceiroKpis } from "./kpi";
import { BoletosAdminTable } from "./BoletosAdminTable";
import { useUserRole } from "@/hooks/useUserRole";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Aba Financeiro do /admin. Super-admin vê boletos de toda a rede; consultor
 * comum vê apenas os próprios. Foco em vencimento, cobrança e recebimentos.
 */
export function FinanceiroPanel({ userId }: { userId: string }) {
  const { isSuperAdmin, isAdmin, loading: roleLoading } = useUserRole(userId);
  const scope: "all" | "self" = isSuperAdmin || isAdmin ? "all" : "self";
  const { data: rows = [], isLoading } = useBoletosAdmin({ userId, scope });
  const kpis = useMemo(() => computeFinanceiroKpis(rows), [rows]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
          label="A vencer em 7 dias"
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
      </div>

      {(isLoading || roleLoading) ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando boletos…
        </div>
      ) : (
        <BoletosAdminTable rows={rows} />
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
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  money: string;
  tone: "amber" | "red" | "blue" | "emerald";
}) {
  const toneMap = {
    amber: "bg-amber-500/10 text-amber-700 border-amber-500/20",
    red: "bg-red-500/10 text-red-600 border-red-500/20",
    blue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    emerald: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  } as const;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className={`inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium border ${toneMap[tone]}`}>
        {icon}
        {label}
      </div>
      <p className="text-2xl font-bold mt-3">{value.toLocaleString("pt-BR")}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{money}</p>
    </div>
  );
}
