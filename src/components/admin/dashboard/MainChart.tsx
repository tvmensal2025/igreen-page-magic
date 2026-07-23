import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface Props {
  data?: Array<{ date: string; label: string; visitas: number; cliques: number; leads: number }>;
}

// Cores da paleta iGreen
const COLOR_VISITAS = "hsl(152, 100%, 33%)"; // verde principal
const COLOR_CLIQUES = "hsl(38, 92%, 50%)"; // alerta/amarelo
const COLOR_LEADS = "hsl(221, 83%, 53%)"; // informativo/azul

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="text-muted-foreground mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 tabular-nums">
          <span className="flex items-center gap-2 text-foreground">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold text-foreground">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function MainChart({ data = [] }: Props) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Evolução diária</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: COLOR_VISITAS }} />Visitas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: COLOR_CLIQUES }} />Cliques
          </span>
          <span className="hidden lg:inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: COLOR_LEADS }} />Clientes interessados
          </span>
        </div>
      </header>
      <div className="p-2 pt-4">
        <div className="w-full min-w-0 h-[220px] sm:h-[280px] lg:h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gV" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_VISITAS} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLOR_VISITAS} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_CLIQUES} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLOR_CLIQUES} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gL" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_LEADS} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COLOR_LEADS} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                fontSize={11}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                fontSize={11}
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(var(--primary))", strokeDasharray: "2 4", strokeWidth: 1 }} />
              <Area type="monotone" dataKey="visitas" name="Visitas" stroke={COLOR_VISITAS} strokeWidth={2} fill="url(#gV)" />
              <Area type="monotone" dataKey="cliques" name="Cliques" stroke={COLOR_CLIQUES} strokeWidth={2} fill="url(#gC)" />
              <Area type="monotone" dataKey="leads" name="Clientes interessados" stroke={COLOR_LEADS} strokeWidth={2} fill="url(#gL)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
