import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { Clock, Smartphone, Globe, MousePointerClick, TrendingUp } from "lucide-react";
import { friendlyClickLabel } from "@/hooks/useAnalytics";
import { useTheme } from "@/contexts/ThemeContext";

interface AnalyticsChartsProps {
  chartData: any[];
  periodDays: number;
  analytics: any;
  weeklyNewCustomers?: { week: string; count: number }[];
}

function useChartColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return {
    grid: isDark ? "hsl(0, 0%, 16%)" : "hsl(220, 10%, 88%)",
    text: isDark ? "hsl(220, 13%, 84%)" : "hsl(220, 10%, 45%)",
    tooltipBg: isDark ? "hsl(0, 0%, 10%)" : "hsl(0, 0%, 100%)",
    tooltipBorder: isDark ? "hsl(0, 0%, 16%)" : "hsl(220, 15%, 90%)",
    tooltipText: isDark ? "hsl(0, 0%, 100%)" : "hsl(220, 15%, 15%)",
  };
}

export function AnalyticsCharts({ chartData, periodDays, analytics, weeklyNewCustomers }: AnalyticsChartsProps) {
  const colors = useChartColors();
  const TOOLTIP_STYLE = { background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: "12px", fontSize: "13px", color: colors.tooltipText };

  return (
    <>
      {/* Weekly New Customers */}
      {weeklyNewCustomers && weeklyNewCustomers.some((w) => w.count > 0) && (
        <div className="premium-card">
          <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Novos Clientes por Semana</h3>
          <p className="text-xs text-muted-foreground mb-4">Últimos {periodDays} dias</p>
          <div className="h-48 sm:h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyNewCustomers} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs><linearGradient id="colorNewCust" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(200, 100%, 50%)" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(200, 100%, 50%)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                <XAxis dataKey="week" tick={{ fill: colors.text, fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: colors.text, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="count" name="Novos Clientes" stroke="hsl(200, 100%, 50%)" strokeWidth={2} fill="url(#colorNewCust)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Views Area Chart */}
      <div className="premium-card">
        <h3 className="font-heading font-bold text-foreground mb-1">Visualizações — Últimos {periodDays} dias</h3>
        <p className="text-xs text-muted-foreground mb-4">Acompanhe o tráfego das suas landing pages</p>
        <div className="h-52 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorClient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(130, 100%, 36%)" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(130, 100%, 36%)" stopOpacity={0} /></linearGradient>
                <linearGradient id="colorLic" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(30, 100%, 50%)" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(30, 100%, 50%)" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="label" tick={{ fill: colors.text, fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: colors.text, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: colors.tooltipText, fontWeight: 600 }} />
              <Area type="monotone" dataKey="client" name="Cliente" stroke="hsl(130, 100%, 36%)" strokeWidth={2} fill="url(#colorClient)" />
              <Area type="monotone" dataKey="licenciada" name="Licenciado" stroke="hsl(30, 100%, 50%)" strokeWidth={2} fill="url(#colorLic)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-6 mt-3">
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ background: "hsl(130, 100%, 36%)" }} /><span className="text-xs text-muted-foreground">Cliente</span></div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ background: "hsl(30, 100%, 50%)" }} /><span className="text-xs text-muted-foreground">Licenciado</span></div>
        </div>
      </div>

      {/* Hourly + Device + UTM row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Hourly */}
        <div className="premium-card">
          <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Horários de Pico</h3>
          <p className="text-xs text-muted-foreground mb-4">Visitas por hora do dia</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics?.hourly || []} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                <XAxis dataKey="hour" tick={{ fill: colors.text, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(h) => `${h}h`} />
                <YAxis tick={{ fill: colors.text, fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(h) => `${h}:00`} />
                <Bar dataKey="views" name="Visitas" fill="hsl(130, 100%, 36%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Devices */}
        <div className="premium-card">
          <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2"><Smartphone className="w-4 h-4 text-primary" /> Dispositivos</h3>
          <p className="text-xs text-muted-foreground mb-4">De onde seus visitantes acessam</p>
          <div className="space-y-3">
            {(analytics?.devices || []).map((d: any) => {
              const total = analytics?.total || 1;
              const pct = Math.round((d.count / total) * 100);
              const labels: Record<string, string> = { mobile: "📱 Mobile", tablet: "📱 Tablet", desktop: "💻 Desktop", desconhecido: "❓ Outro" };
              return (
                <div key={d.device}>
                  <div className="flex justify-between text-sm mb-1"><span className="text-foreground">{labels[d.device] || d.device}</span><span className="text-muted-foreground">{d.count} ({pct}%)</span></div>
                  <div className="w-full bg-secondary rounded-full h-2.5 overflow-hidden"><div className="bg-primary h-2.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
            {(!analytics?.devices || analytics.devices.length === 0) && <p className="text-sm text-muted-foreground text-center py-4">Sem dados ainda</p>}
          </div>
        </div>

        {/* UTM Sources */}
        <div className="premium-card">
          <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2"><Globe className="w-4 h-4 text-primary" /> Origem do Tráfego</h3>
          <p className="text-xs text-muted-foreground mb-4">De onde vêm seus visitantes</p>
          {analytics?.utmSources && analytics.utmSources.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={analytics.utmSources.map((u: any) => ({ name: u.source, value: u.count }))} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value" stroke="none">
                    {analytics.utmSources.map((_: any, i: number) => <Cell key={i} fill={["hsl(130,100%,36%)", "hsl(30,100%,50%)", "hsl(200,100%,50%)", "hsl(280,80%,60%)", "hsl(0,80%,55%)"][i % 5]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number, name: string) => { const total = analytics?.total || 1; return [`${value} (${Math.round((value / total) * 100)}%)`, name]; }} />
                  <Legend iconType="circle" iconSize={8} formatter={(value: string) => <span className="text-xs text-muted-foreground capitalize">{value}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="text-sm text-muted-foreground text-center py-4">Sem dados ainda</p>}
        </div>
      </div>

      {/* Bar Chart */}
      <div className="premium-card">
        <h3 className="font-heading font-bold text-foreground mb-1">Comparativo diário</h3>
        <p className="text-xs text-muted-foreground mb-4">Visitas por tipo de página</p>
        <div className="h-48 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData.slice(-14)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="label" tick={{ fill: colors.text, fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: colors.text, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="client" name="Cliente" fill="hsl(130, 100%, 36%)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="licenciada" name="Licenciado" fill="hsl(30, 100%, 50%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Clicks by target */}
      {analytics?.clicksByTarget && Object.keys(analytics.clicksByTarget).length > 0 && (
        <div className="premium-card">
          <h3 className="font-heading font-bold text-foreground mb-1 flex items-center gap-2"><MousePointerClick className="w-4 h-4 text-primary" /> Cliques por Botão</h3>
          <p className="text-xs text-muted-foreground mb-4">Quais botões seus visitantes mais clicam</p>
          {analytics.clicksByPage?.client && Object.keys(analytics.clicksByPage.client).length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">📄 Página Cliente</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(analytics.clicksByPage.client).map(([target, count]) => (
                  <div key={target} className="bg-secondary/50 dark:bg-secondary rounded-xl p-4 text-center border border-border/50 hover:border-primary/20 transition-colors">
                    <p className="text-2xl font-bold font-heading text-foreground">{count as number}</p>
                    <p className="text-xs text-muted-foreground">{friendlyClickLabel(target)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {analytics.clicksByPage?.licenciada && Object.keys(analytics.clicksByPage.licenciada).length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">💼 Página Licenciado</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(analytics.clicksByPage.licenciada).map(([target, count]) => (
                  <div key={target} className="bg-secondary/50 dark:bg-secondary rounded-xl p-4 text-center border border-border/50 hover:border-primary/20 transition-colors">
                    <p className="text-2xl font-bold font-heading text-foreground">{count as number}</p>
                    <p className="text-xs text-muted-foreground">{friendlyClickLabel(target)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
