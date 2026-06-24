import { ChevronRight } from "lucide-react";

interface Props {
  funnel?: Array<{ stage: string; count: number; pct: number }>;
}

// Cores da paleta iGreen para cada etapa do funil
const ACCENTS = [
  "hsl(var(--primary))",
  "hsl(var(--warning))",
  "hsl(var(--info))",
  "hsl(var(--primary))",
];

export function FunnelStrip({ funnel = [] }: Props) {
  if (!funnel.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Funil de conversão</h3>
        <span className="text-xs text-muted-foreground hidden lg:inline">
          Visita → Clique → Cliente interessado → Aprovado
        </span>
      </header>
      <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border">
        {funnel.map((s, i) => {
          const prev = i > 0 ? funnel[i - 1].count : null;
          const conv = prev != null ? (prev > 0 ? (s.count / prev) * 100 : 0) : null;
          const accent = ACCENTS[i] || "hsl(var(--primary))";
          return (
            <div key={s.stage} className="px-4 py-4 relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {String(i + 1).padStart(2, "0")} · {s.stage}
                </span>
                {conv != null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <ChevronRight className="inline w-3 h-3" />
                    {conv.toFixed(1)}%
                  </span>
                )}
              </div>
              <p
                className="font-bold tabular-nums leading-none"
                style={{ color: accent, fontSize: "clamp(1.5rem, 3vw, 2.25rem)" }}
              >
                {s.count}
              </p>
              <div className="mt-3 h-1.5 rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, s.pct)}%`, background: accent }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">{s.pct.toFixed(1)}% do topo</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
