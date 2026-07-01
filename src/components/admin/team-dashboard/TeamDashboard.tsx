import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { useTeamRegistrations, type TeamCustomer } from "@/hooks/useTeamRegistrations";

interface TeamDashboardProps {
  leaderConsultantId: string;
  customers: TeamCustomer[] | undefined;
  periodDays: number;
}

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(45 90% 55%)",
  "hsl(200 85% 55%)",
  "hsl(280 70% 60%)",
  "hsl(0 0% 55%)",
];

export function TeamDashboard({ leaderConsultantId, customers, periodDays }: TeamDashboardProps) {
  const data = useTeamRegistrations(leaderConsultantId, customers, periodDays);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.porDia.map((d) => {
      const row: Record<string, number | string> = { label: d.label };
      for (const name of data.topLicenciadoIds) row[name] = d.perTop[name] ?? 0;
      row["Outros"] = d.perTop["Outros"] ?? 0;
      return row;
    });
  }, [data]);

  if (!data) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/40 p-6 text-sm text-muted-foreground font-inter">
        Carregando cadastros da equipe…
      </div>
    );
  }

  const deltaPct = Math.round(data.totals.delta.cadastros * 100);

  return (
    <section className="space-y-3">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-inter">
            Cadastros da equipe
          </p>
          <h2 className="font-display text-lg md:text-xl font-semibold text-foreground leading-tight">
            Últimos {periodDays} dias · {data.totals.licenciadosAtivos} licenciados ativos
          </h2>
        </div>
        <Badge variant="outline" className="font-inter text-[11px] border-primary/30 text-primary bg-primary/5">
          {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct)}% vs período anterior
        </Badge>
      </header>

      <div className="rounded-xl border border-border/40 bg-card/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm font-semibold text-foreground">
            Cadastros por dia · top 5 licenciados
          </h3>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-inter">
            Área empilhada
          </span>
        </div>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                {[...data.topLicenciadoIds, "Outros"].map((name, idx) => (
                  <linearGradient key={name} id={`g-${idx}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[idx % CHART_COLORS.length]} stopOpacity={0.6} />
                    <stop offset="95%" stopColor={CHART_COLORS[idx % CHART_COLORS.length]} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {[...data.topLicenciadoIds, "Outros"].map((name, idx) => (
                <Area
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stackId="1"
                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                  fill={`url(#g-${idx})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
