import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { useAdMetrics } from "@/hooks/useAdMetrics";
import { useLeadsByConsultant } from "@/hooks/useLeadsByConsultant";
import { useLeadsByStage } from "@/hooks/useLeadsByStage";
import type { ManagedConsultant } from "@/hooks/useManagedConsultants";

const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(142 71% 45%)",
  "hsl(48 96% 53%)",
  "hsl(199 89% 48%)",
  "hsl(280 70% 60%)",
  "hsl(0 84% 60%)",
  "hsl(20 90% 55%)",
  "hsl(160 70% 50%)",
  "hsl(220 70% 60%)",
];

interface Props {
  consultantId: string;
  periodDays: number;
  managed: ManagedConsultant[];
}

function ChartCard({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`p-3 sm:p-4 bg-card/60 border-border/40 backdrop-blur min-w-0 overflow-hidden ${className}`}>
      <div className="mb-3 min-w-0">
        <h4 className="text-sm font-semibold text-foreground truncate">{title}</h4>
        {subtitle && <p className="text-[11px] text-muted-foreground break-words">{subtitle}</p>}
      </div>
      <div className="ads-chart-h">{children}</div>
    </Card>
  );
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export function AdMetricsCharts({ consultantId, periodDays, managed }: Props) {
  const { data, isLoading } = useAdMetrics(consultantId, periodDays);

  const consultantIds = useMemo(() => managed.map((m) => m.id), [managed]);
  const namesMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of managed) m[c.id] = c.name.replace(" (você)", "");
    return m;
  }, [managed]);

  const { data: byConsultant } = useLeadsByConsultant(consultantIds, namesMap, periodDays);
  const { data: byStage } = useLeadsByStage(consultantId, periodDays);

  const dailyChart = useMemo(
    () =>
      (data?.daily ?? []).map((d) => ({
        date: d.date.slice(5).replace("-", "/"),
        gasto: Number((d.spend_cents / 100).toFixed(2)),
        conversas: d.conversations,
        cpl: d.cpl_conversation_cents != null ? Number((d.cpl_conversation_cents / 100).toFixed(2)) : 0,
      })),
    [data?.daily],
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0 max-w-full">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
    );
  }

  const showByConsultant = consultantIds.length > 1 && (byConsultant?.length ?? 0) > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0 max-w-full">
      <ChartCard title="Gasto x Conversas no WhatsApp por dia" subtitle="Investimento em anúncios vs conversas abertas pelo anúncio">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dailyChart} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number, name: string) =>
                name === "gasto"
                  ? [value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), "Gasto"]
                  : [value, "Conversas Meta"]
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="left" type="monotone" dataKey="gasto" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} name="Gasto (R$)" />
            <Line yAxisId="right" type="monotone" dataKey="conversas" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Conversas Meta" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Custo por conversa no WhatsApp (diário)" subtitle="Gasto ÷ conversas do dia (não é contato do painel)">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dailyChart} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="cplGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(48 96% 53%)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="hsl(48 96% 53%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `R$${v}`} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: number) => [
                value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
                "Custo/conversa Meta",
              ]}
            />
            <Area type="monotone" dataKey="cpl" stroke="hsl(48 96% 53%)" fill="url(#cplGrad)" strokeWidth={2} name="Custo/conversa Meta" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {showByConsultant && (
        <ChartCard title="Clientes interessados por consultor" subtitle="Distribuição entre contas gerenciadas">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byConsultant} layout="vertical" margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, _name, item: any) => {
                  const cpl = item?.payload?.cplCents;
                  return [
                    `${value} leads Meta · ${fmtBRL(item?.payload?.spendCents ?? 0)} gasto · custo/lead ${cpl != null ? fmtBRL(cpl) : "—"}`,
                    "Resultado",
                  ];
                }}
              />
              <Bar dataKey="leads" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <ChartCard
        title="Clientes interessados por etapa do cadastro"
        subtitle="Onde estão os clientes interessados gerados no período"
        className={showByConsultant ? "" : "lg:col-span-2"}
      >
        {(byStage?.length ?? 0) === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Sem clientes interessados no período.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _n, item: any) => [`${v} leads`, item?.payload?.label]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Pie
                data={byStage}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={85}
                innerRadius={45}
                paddingAngle={2}
              >
                {(byStage ?? []).map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
