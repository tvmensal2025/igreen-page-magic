import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KpiData {
  current: number;
  previous: number;
  change: number;
  spark?: number[];
}

interface Props {
  kpis?: {
    views: KpiData;
    clicks: KpiData;
    leads: KpiData;
    periodDays?: number;
  };
}

function Delta({ change }: { change: number }) {
  const flat = Math.abs(change) < 1;
  const up = change >= 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const cls = flat
    ? "text-muted-foreground"
    : up
    ? "text-primary"
    : "text-destructive";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${cls}`}>
      <Icon className="w-3 h-3" strokeWidth={2} />
      {flat ? "0%" : `${up ? "+" : ""}${change.toFixed(1)}%`}
    </span>
  );
}

function Cell({
  label,
  data,
  accent,
}: {
  label: string;
  data?: KpiData;
  accent: string;
}) {
  return (
    <div className="flex-1 min-w-0 px-5 sm:px-6 py-4 flex flex-col gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-baseline gap-3">
        <span
          className="font-heading font-black tabular-nums leading-none"
          style={{ color: accent, fontSize: "clamp(1.75rem, 3.2vw, 2.5rem)" }}
        >
          {data?.current ?? 0}
        </span>
        <Delta change={data?.change ?? 0} />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        Anterior: {data?.previous ?? 0}
      </span>
    </div>
  );
}

export function TerminalTicker({ kpis }: Props) {
  const period = kpis?.periodDays ?? 30;
  return (
    <section className="rounded-xl border border-border/60 bg-card overflow-hidden">
      {/* Header strip */}
      <div className="flex items-center justify-between gap-4 px-5 py-2 border-b border-border/40 bg-muted/20">
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 text-primary">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Ao vivo
          </span>
          <span className="text-border">·</span>
          <span>
            Período{" "}
            <span className="text-foreground font-semibold">{period}d</span>
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {new Date().toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
          })}{" "}
          BRT
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/40">
        <Cell label="Visitas" data={kpis?.views} accent="hsl(var(--primary))" />
        <Cell label="Cliques nos botões" data={kpis?.clicks} accent="hsl(var(--warning))" />
        <Cell label="Novos clientes interessados" data={kpis?.leads} accent="hsl(var(--info))" />
      </div>
    </section>
  );
}
