import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { TrendingUp, Users } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

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

export function CustomerCharts({ filteredMetrics, topLicenciados }: CustomerChartsProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const gridColor = isDark ? "hsl(120, 8%, 18%)" : "hsl(220, 10%, 88%)";
  const textColor = isDark ? "hsl(120, 5%, 65%)" : "hsl(220, 10%, 45%)";
  const tooltipStyle = {
    background: isDark ? "hsl(120, 8%, 8%)" : "hsl(0, 0%, 100%)",
    border: `1px solid ${isDark ? "hsl(120, 8%, 18%)" : "hsl(220, 15%, 90%)"}`,
    borderRadius: "12px", fontSize: "13px",
    color: isDark ? "hsl(0, 0%, 95%)" : "hsl(220, 15%, 15%)",
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Top Licenciados */}
      <div className="premium-card">
        <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> 🏆 Licenciados — Cadastros
        </h3>
        <p className="text-xs text-muted-foreground mb-4">Top licenciados por contas cadastradas</p>
        {topLicenciados && topLicenciados.length > 0 ? (
          <div style={{ height: Math.max(200, topLicenciados.length * 36) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topLicenciados} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                <XAxis type="number" tick={{ fill: textColor, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={(props: any) => {
                    const { x, y, payload } = props;
                    return (
                      <text x={x} y={y} textAnchor="end" fill={textColor} fontSize={11} dominantBaseline="middle" className="sensitive-name">
                        {payload.value}
                      </text>
                    );
                  }} tickLine={false} axisLine={false} width={130} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value} cadastros`, "Contas"]} />
                <defs><linearGradient id="barGradientLic" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="hsl(130, 100%, 30%)" /><stop offset="100%" stopColor="hsl(130, 100%, 45%)" /></linearGradient></defs>
                <Bar dataKey="deals" name="Cadastros" fill="url(#barGradientLic)" radius={[0, 6, 6, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={filteredMetrics.customersByStatus.map((s) => ({ name: s.label, value: s.count }))} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" stroke="none">
                    {filteredMetrics.customersByStatus.map((s, i) => (
                      <Cell key={i} fill={STATUS_COLORS[s.status] || "hsl(260, 60%, 55%)"} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconType="circle" iconSize={8} formatter={(value: string) => <span className="text-xs text-muted-foreground">{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
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
