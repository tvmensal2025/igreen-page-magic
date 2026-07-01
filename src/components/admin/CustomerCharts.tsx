import { PieChart, Pie, Cell, Legend } from "recharts";
import { TrendingUp, Users } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

interface CustomerMetrics {
  totalCustomers: number;
  totalKw: number;
  avgKw: number;
  customersByStatus: { status: string; count: number; label: string }[];
  weeklyNewCustomers: { week: string; count: number }[];
}

interface LicenciadoData {
  name: string;
  deals: number;
}

interface CustomerChartsProps {
  filteredMetrics: CustomerMetrics | null;
  topLicenciados?: LicenciadoData[];
}

const STATUS_COLORS: Record<string, string> = {
  approved: "hsl(130, 100%, 36%)", pending: "hsl(45, 100%, 50%)", rejected: "hsl(0, 80%, 45%)",
  devolutiva: "hsl(30, 100%, 50%)", lead: "hsl(200, 100%, 50%)", data_complete: "hsl(180, 70%, 45%)",
  registered_igreen: "hsl(260, 60%, 55%)", contract_sent: "hsl(30, 100%, 50%)",
};

const BADGE_COLORS: Record<string, string> = {
  approved: "bg-primary/20 text-primary dark:text-primary", pending: "bg-warning/20 text-warning dark:text-warning",
  rejected: "bg-destructive/15 text-destructive dark:bg-destructive/30 dark:text-destructive", devolutiva: "bg-warning/20 text-warning dark:text-warning",
  lead: "bg-info/20 text-info dark:text-info", data_complete: "bg-primary/20 text-primary dark:text-primary",
  registered_igreen: "bg-primary/20 text-primary dark:text-primary", contract_sent: "bg-warning/20 text-warning dark:text-warning",
};

// (config antigo do BarChart removido — ranking agora é lista rica)

const statusConfig = {
  value: { label: "Clientes" },
} satisfies ChartConfig;

export function CustomerCharts({ filteredMetrics, topLicenciados }: CustomerChartsProps) {
  const licenciadosData = topLicenciados ?? [];

  const maxDeals = licenciadosData.reduce((m, l) => Math.max(m, l.deals), 0) || 1;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Ranking de Licenciados — lista rica */}
      <div className="premium-card">
        <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> 🏆 Ranking de licenciados
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Top licenciados por contas cadastradas</p>
        {licenciadosData && licenciadosData.length > 0 ? (
          <ol className="space-y-2.5">
            {licenciadosData.slice(0, 10).map((b, idx) => {
              const pct = (b.deals / maxDeals) * 100;
              return (
                <li key={`${b.name}-${idx}`} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate max-w-[220px] sensitive-name" title={b.name}>
                      <span className="text-muted-foreground mr-1.5">{idx + 1}.</span>
                      {b.name}
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">{b.deals}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary/80" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum licenciado vinculado ainda</p>
        )}
      </div>

      {/* Customer Status Donut */}
      <div className="premium-card">
        <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> Status dos Clientes
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Distribuição por status</p>
        {filteredMetrics?.customersByStatus && filteredMetrics.customersByStatus.length > 0 ? (
          <>
            <ChartContainer config={statusConfig} className="h-52 w-full aspect-auto">
              <PieChart>
                <Pie data={filteredMetrics.customersByStatus.map((s) => ({ name: s.label, value: s.count }))} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" stroke="none">
                  {filteredMetrics.customersByStatus.map((s, i) => (
                    <Cell key={i} fill={STATUS_COLORS[s.status] || "hsl(260, 60%, 55%)"} />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Legend iconType="circle" iconSize={8} formatter={(value: string) => <span className="text-xs text-muted-foreground">{value}</span>} />
              </PieChart>
            </ChartContainer>
            <div className="flex flex-wrap gap-2 mt-3 justify-center">
              {filteredMetrics.customersByStatus.map((s) => (
                <span key={s.status} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${BADGE_COLORS[s.status] || "bg-primary/20 text-primary dark:text-primary"}`}>
                  {s.label}: {s.count}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">Sem clientes cadastrados</p>
        )}
      </div>
    </div>
  );
}
