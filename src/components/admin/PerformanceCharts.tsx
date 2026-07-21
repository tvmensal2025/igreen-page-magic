import { Layers, Target, Clock, ChevronRight } from "lucide-react";

interface Props {
  analytics: any;
}

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function PerformanceCharts({ analytics }: Props) {
  if (!analytics) return null;
  const { funnel, topCampaigns, heatmap } = analytics;

  const funnelAccents = [
    "hsl(142 76% 48%)",
    "hsl(38 92% 55%)",
    "hsl(200 100% 60%)",
    "hsl(142 76% 48%)",
  ];

  // Heatmap normalization
  const heatMax = Math.max(1, ...(heatmap || []).map((h: any) => h.value));

  return (
    <div className="space-y-6">
      {/* ───────── FUNIL CASCATA ───────── */}
      {funnel && (
        <section className="rounded-2xl border border-border/60 bg-[hsl(0_0%_4%)] overflow-hidden">
          <header className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border/40">
            <div className="flex items-center gap-3">
              <Layers className="w-4 h-4 text-primary" />
              <div>
                <h3 className="font-heading font-black text-sm tracking-tight text-foreground">FUNIL DE CONVERSÃO</h3>
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Do visitante ao cliente aprovado</p>
              </div>
            </div>
          </header>

          <div className="p-5 sm:p-8 space-y-3">
            {funnel.map((step: any, i: number) => {
              const widthPct = funnel[0].count > 0 ? Math.max((step.count / funnel[0].count) * 100, 8) : 8;
              const conv = i > 0 && funnel[i - 1].count > 0 ? (step.count / funnel[i - 1].count) * 100 : null;
              return (
                <div key={step.stage}>
                  {i > 0 && (
                    <div className="flex items-center justify-center mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                      <span className="h-3 w-px bg-border" />
                      <span className="px-2">↓ {conv?.toFixed(1) ?? 0}% convertem</span>
                      <span className="h-3 w-px bg-border" />
                    </div>
                  )}
                  <div className="mx-auto" style={{ width: `${widthPct}%` }}>
                    <div
                      className="relative flex items-center justify-between px-5 py-4 rounded-lg border border-border/40"
                      style={{
                        background: `linear-gradient(90deg, ${funnelAccents[i]}22, transparent)`,
                        borderLeft: `3px solid ${funnelAccents[i]}`,
                      }}
                    >
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
                          {step.stage}
                        </p>
                        <p className="font-heading font-black text-2xl sm:text-3xl tabular-nums text-foreground leading-none mt-1">
                          {step.count}
                        </p>
                      </div>
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                        {step.pct.toFixed(1)}% do topo
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ───────── HEATMAP HORA × DIA ───────── */}
      {heatmap && (
        <section className="rounded-2xl border border-border/60 bg-[hsl(0_0%_4%)] overflow-hidden">
          <header className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-border/40">
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-primary" />
              <div>
                <h3 className="font-heading font-black text-sm tracking-tight text-foreground">HORÁRIOS QUENTES</h3>
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Quando seus visitantes acessam a página</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">menos</span>
              {[0.15, 0.3, 0.5, 0.75, 1].map((o) => (
                <span key={o} className="w-3 h-3 rounded-sm" style={{ background: `hsl(142 76% 48% / ${o})` }} />
              ))}
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">mais</span>
            </div>
          </header>

          <div className="p-4 sm:p-6 overflow-x-auto overscroll-x-contain min-w-0">
            <p className="mb-2 text-[10px] text-muted-foreground md:hidden">Deslize para ver as 24 horas →</p>
            <div className="min-w-[640px]">
              {/* Hour header */}
              <div className="grid gap-[3px] mb-[3px]" style={{ gridTemplateColumns: "40px repeat(24, minmax(0, 1fr))" }}>
                <span />
                {Array.from({ length: 24 }).map((_, h) => (
                  <span key={h} className="text-[9px] text-center text-muted-foreground tabular-nums">
                    {h % 3 === 0 ? h : ""}
                  </span>
                ))}
              </div>
              {DAYS.map((dayName, dy) => (
                <div key={dy} className="grid gap-[3px] mb-[3px]" style={{ gridTemplateColumns: "40px repeat(24, minmax(0, 1fr))" }}>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center">
                    {dayName}
                  </span>
                  {Array.from({ length: 24 }).map((_, hr) => {
                    const cell = heatmap.find((h: any) => h.day === dy && h.hour === hr);
                    const v = cell?.value || 0;
                    const intensity = v === 0 ? 0 : 0.15 + (v / heatMax) * 0.85;
                    return (
                      <div
                        key={hr}
                        title={`${dayName} ${hr}h — ${v} visita${v === 1 ? "" : "s"}`}
                        className="aspect-square rounded-sm border border-border/30 transition-transform hover:scale-125"
                        style={{
                          background: v === 0 ? "hsl(0 0% 8%)" : `hsl(142 76% 48% / ${intensity})`,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ───────── TOP ORIGENS ───────── */}
      {topCampaigns && topCampaigns.length > 0 && (
        <section className="rounded-2xl border border-border/60 bg-[hsl(0_0%_4%)] overflow-hidden">
          <header className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-border/40">
            <Target className="w-4 h-4 text-primary" />
            <div>
              <h3 className="font-heading font-black text-sm tracking-tight text-foreground">ORIGEM DO TRÁFEGO</h3>
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Quais canais trazem mais visitas</p>
            </div>
          </header>
          <ol className="divide-y divide-border/40">
            {topCampaigns.map((c: any, i: number) => {
              const maxViews = Math.max(...topCampaigns.map((x: any) => x.views));
              const widthPct = maxViews > 0 ? (c.views / maxViews) * 100 : 0;
              return (
                <li key={c.source} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-5 sm:px-6 py-3 hover:bg-[hsl(0_0%_7%)]">
                  <span className="font-heading font-black text-lg tabular-nums text-muted-foreground/50 w-6">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground capitalize truncate">{c.source}</p>
                    <div className="mt-1.5 h-[2px] w-full bg-border/30 rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all duration-700" style={{ width: `${widthPct}%` }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Visitas / Cliques</p>
                    <p className="text-sm font-bold tabular-nums text-foreground">{c.views} <ChevronRight className="w-3 h-3 inline -mx-0.5 text-muted-foreground" /> {c.clicks}</p>
                  </div>
                  <span className={`font-heading font-black text-lg tabular-nums ${c.conversionRate > 5 ? "text-primary" : "text-muted-foreground"}`}>
                    {c.conversionRate.toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
