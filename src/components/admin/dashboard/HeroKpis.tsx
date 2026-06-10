import { Eye, MousePointerClick, Users, Wallet, TrendingUp, TrendingDown, Minus, Lock } from "lucide-react";
import { Sparkline } from "./Sparkline";

interface KpiData {
  current: number;
  previous: number;
  change: number;
  spark: number[];
  isSnapshot?: boolean;
}

interface Props {
  kpis?: {
    views: KpiData;
    clicks: KpiData;
    leads: KpiData;
    approved: KpiData;
    periodDays?: number;
  };
  walletSnapshot?: { totalApproved: number; totalWallet: number; receitaPotencial: number };
}

function DeltaPill({ value }: { value: number }) {
  const flat = Math.abs(value) < 1;
  const up = value >= 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const cls = flat
    ? "border-border/40 text-muted-foreground"
    : up
    ? "border-primary/40 text-primary"
    : "border-destructive/40 text-destructive";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold tracking-wider ${cls}`}>
      <Icon className="w-3 h-3" />
      {flat ? "0%" : `${Math.abs(value).toFixed(0)}%`}
    </span>
  );
}

const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);

export function HeroKpis({ kpis, walletSnapshot }: Props) {
  const period = kpis?.periodDays ?? 30;
  const items = [
    { key: "views" as const, label: "Visitas", icon: Eye, accent: "hsl(142 76% 48%)", data: kpis?.views },
    { key: "clicks" as const, label: "Cliques CTA", icon: MousePointerClick, accent: "hsl(38 92% 55%)", data: kpis?.clicks },
    { key: "leads" as const, label: "Novos Clientes interessados", icon: Users, accent: "hsl(200 100% 60%)", data: kpis?.leads },
    {
      key: "approved" as const,
      label: "Carteira Ativa",
      icon: Wallet,
      accent: "hsl(142 76% 48%)",
      data: kpis?.approved,
      sublabel: walletSnapshot ? formatBRL(walletSnapshot.receitaPotencial) + " / mês" : undefined,
    },
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-[hsl(0_0%_4%)] dark:bg-[hsl(0_0%_4%)]">
      {/* header strip */}
      <div className="flex items-baseline justify-between gap-4 px-5 sm:px-7 pt-5 pb-3 border-b border-border/40">
        <div>
          <h2 className="font-heading font-black text-base sm:text-lg tracking-tight text-foreground">
            Painel de Performance
          </h2>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
            Últimos {period} dias <span className="text-border mx-1">·</span> vs. {period} anteriores
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Ao vivo
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-border/40">
        {items.map(({ key, label, icon: Icon, accent, data, sublabel }) => {
          const isSnap = data?.isSnapshot;
          return (
            <div key={key} className="relative px-5 sm:px-6 py-5 sm:py-6 group">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
                  <span className="text-[10px] uppercase tracking-[0.22em] font-bold">{label}</span>
                </div>
                {isSnap ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/40 text-[10px] text-muted-foreground">
                    <Lock className="w-2.5 h-2.5" /> total
                  </span>
                ) : data ? (
                  <DeltaPill value={data.change} />
                ) : null}
              </div>

              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="font-heading font-black tracking-tight text-foreground leading-[0.95]"
                    style={{ fontSize: "clamp(2.25rem, 5vw, 3.5rem)" }}
                  >
                    {data?.current ?? 0}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2 truncate">
                    {sublabel ?? (isSnap ? "Aprovados / Ativos" : `Antes: ${data?.previous ?? 0}`)}
                  </p>
                </div>
                {data?.spark && (
                  <Sparkline data={data.spark} color={accent} width={92} height={38} variant="line" />
                )}
              </div>

              {/* hover accent line */}
              <span
                className="absolute left-0 top-0 h-full w-px opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: accent }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
