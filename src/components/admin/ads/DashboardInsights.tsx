import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdMetrics } from "@/hooks/useAdMetrics";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  AreaChart,
  Area,
  Legend,
} from "recharts";
import {
  Activity,
  ArrowUpRight,
  Flame,
  MapPin,
  MessageCircle,
  Target,
  Trophy,
  Wallet,
} from "lucide-react";
import { formatCampaignGeo } from "@/lib/campaignGeo";

const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtNum = (n: number) => n.toLocaleString("pt-BR");

type CampRow = {
  id: string;
  name: string;
  status: string;
  cities: unknown;
  daily_budget_cents: number;
  creative_format: string | null;
};

type CampAgg = CampRow & {
  spend_cents: number;
  conversations: number;
  impressions: number;
  clicks: number;
  cpl_cents: number | null;
  cityLabel: string;
};

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

function statusLabel(s: string) {
  const map: Record<string, string> = {
    active: "Ativa",
    paused: "Pausada",
    pending_review: "Em revisão",
    draft: "Rascunho",
    completed: "Concluída",
    rejected: "Rejeitada",
  };
  return map[s] || s;
}

export function DashboardInsights({
  consultantId,
  periodDays,
}: {
  consultantId: string;
  periodDays: number;
}) {
  const { data: metrics, isLoading: metricsLoading } = useAdMetrics(consultantId, periodDays);
  const [camps, setCamps] = useState<CampRow[]>([]);
  const [agg, setAgg] = useState<CampAgg[]>([]);
  const [walletCents, setWalletCents] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const until = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const [y, m, d] = until.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - (Math.max(1, periodDays) - 1));
      const since = dt.toISOString().slice(0, 10);

      const [{ data: campRows }, { data: wallet }] = await Promise.all([
        supabase
          .from("facebook_campaigns")
          .select("id,name,status,cities,daily_budget_cents,creative_format")
          .eq("consultant_id", consultantId)
          .order("created_at", { ascending: false })
          .limit(40),
        supabase
          .from("consultant_wallet")
          .select("balance_cents")
          .eq("consultant_id", consultantId)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      const list = (campRows || []) as CampRow[];
      setCamps(list);
      setWalletCents(
        typeof (wallet as any)?.balance_cents === "number" ? (wallet as any).balance_cents : null,
      );

      let metricRows: any[] = [];
      if (list.length) {
        const { data: ms } = await supabase
          .from("facebook_metrics_daily")
          .select("campaign_id,spend_cents,messaging_conversations_started,impressions,clicks")
          .in("campaign_id", list.map((c) => c.id))
          .gte("date", since)
          .lte("date", until);
        metricRows = ms || [];
      }

      const byCamp: Record<
        string,
        { spend_cents: number; conversations: number; impressions: number; clicks: number }
      > = {};
      for (const r of metricRows) {
        const id = String(r.campaign_id);
        if (!byCamp[id]) {
          byCamp[id] = { spend_cents: 0, conversations: 0, impressions: 0, clicks: 0 };
        }
        byCamp[id].spend_cents += Number(r.spend_cents || 0);
        byCamp[id].conversations += Number(r.messaging_conversations_started || 0);
        byCamp[id].impressions += Number(r.impressions || 0);
        byCamp[id].clicks += Number(r.clicks || 0);
      }

      const merged: CampAgg[] = list.map((c) => {
        const m = byCamp[c.id] || { spend_cents: 0, conversations: 0, impressions: 0, clicks: 0 };
        const geo = formatCampaignGeo(c.cities as any);
        return {
          ...c,
          ...m,
          cpl_cents: m.conversations > 0 ? Math.round(m.spend_cents / m.conversations) : null,
          cityLabel: geo.summary || "—",
        };
      });
      setAgg(merged);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [consultantId, periodDays]);

  const live = useMemo(
    () => agg.filter((c) => c.status === "active" || c.status === "pending_review"),
    [agg],
  );
  const dailyBurn = useMemo(
    () => live.reduce((s, c) => s + (c.daily_budget_cents || 0), 0),
    [live],
  );
  const topByConv = useMemo(
    () =>
      [...agg]
        .filter((c) => c.conversations > 0 || c.spend_cents > 0)
        .sort((a, b) => b.conversations - a.conversations || b.spend_cents - a.spend_cents)
        .slice(0, 8),
    [agg],
  );
  const rankingChart = useMemo(
    () =>
      topByConv.map((c) => ({
        name: c.cityLabel.length > 14 ? c.cityLabel.slice(0, 13) + "…" : c.cityLabel,
        full: c.name,
        conversas: c.conversations,
        gasto: Number((c.spend_cents / 100).toFixed(2)),
        cpl: c.cpl_cents != null ? Number((c.cpl_cents / 100).toFixed(2)) : 0,
      })),
    [topByConv],
  );

  const efficiencyDaily = useMemo(
    () =>
      (metrics?.daily || []).map((d) => ({
        date: d.date.slice(5).replace("-", "/"),
        impressoes: d.impressions,
        cliques: d.clicks,
        conversas: d.conversations,
        ctr: d.impressions > 0 ? Number(((d.clicks / d.impressions) * 100).toFixed(2)) : 0,
      })),
    [metrics?.daily],
  );

  const best = useMemo(() => {
    const withCpl = agg.filter((c) => c.cpl_cents != null && c.conversations >= 2);
    if (!withCpl.length) return null;
    return [...withCpl].sort((a, b) => (a.cpl_cents! - b.cpl_cents!))[0];
  }, [agg]);

  const insights = useMemo(() => {
    const out: string[] = [];
    if (live.length) {
      out.push(`${live.length} campanha(s) no ar · verba planejada ${fmtBRL(dailyBurn)}/dia`);
    }
    if (metrics?.conversations) {
      out.push(
        `${fmtNum(metrics.conversations)} conversas Meta no período` +
          (metrics.costPerConversationCents != null
            ? ` · custo médio ${fmtBRL(metrics.costPerConversationCents)}`
            : ""),
      );
    }
    if (best) {
      out.push(`Melhor custo/conversa: ${best.cityLabel} (${fmtBRL(best.cpl_cents!)} · ${best.conversations} conversas)`);
    }
    if (walletCents != null && dailyBurn > 0) {
      const runway = walletCents / Math.round(dailyBurn * 1.2);
      out.push(`Runway estimado ~${runway.toFixed(1)} dias (saldo ÷ queima c/ taxa)`);
    }
    const videoLive = live.filter((c) => c.creative_format === "video").length;
    if (videoLive) out.push(`${videoLive} criativo(s) em vídeo ativos (Reels/Stories)`);
    return out.slice(0, 5);
  }, [live, dailyBurn, metrics, best, walletCents]);

  if (loading || metricsLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 min-w-0 w-full">
      {/* Snapshot cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 min-w-0">
        <Card className="p-3 bg-card/60 border-border/40 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground">
            <Flame className="w-3.5 h-3.5 text-primary shrink-0" />
            No ar agora
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">{live.length}</div>
          <div className="text-[10px] text-muted-foreground">{camps.length} no total</div>
        </Card>
        <Card className="p-3 bg-card/60 border-border/40 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground">
            <Wallet className="w-3.5 h-3.5 text-primary shrink-0" />
            Verba / dia
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">{fmtBRL(dailyBurn)}</div>
          <div className="text-[10px] text-muted-foreground">
            ~{fmtBRL(Math.round(dailyBurn * 1.2))} c/ taxa
          </div>
        </Card>
        <Card className="p-3 bg-card/60 border-border/40 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground">
            <MessageCircle className="w-3.5 h-3.5 text-primary shrink-0" />
            Conversas
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">
            {fmtNum(metrics?.conversations ?? 0)}
          </div>
          <div className="text-[10px] text-muted-foreground">últimos {periodDays}d</div>
        </Card>
        <Card className="p-3 bg-card/60 border-border/40 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground">
            <Target className="w-3.5 h-3.5 text-warning shrink-0" />
            Custo / conversa
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-bold tabular-nums">
            {metrics?.costPerConversationCents != null
              ? fmtBRL(metrics.costPerConversationCents)
              : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">média do período</div>
        </Card>
      </div>

      {/* Insights bullets */}
      {insights.length > 0 && (
        <Card className="p-3 sm:p-4 border-primary/20 bg-primary/5 min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold mb-2">
            <Activity className="w-4 h-4 text-primary" />
            Leituras rápidas
          </div>
          <ul className="space-y-1.5">
            {insights.map((t) => (
              <li key={t} className="text-xs sm:text-[13px] text-muted-foreground flex gap-2 min-w-0">
                <ArrowUpRight className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <span className="break-words">{t}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0">
        {/* Ranking campanhas */}
        <Card className="p-3 sm:p-4 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold">Ranking por conversas</h4>
          </div>
          {rankingChart.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              Sem gasto/conversas no período ainda.
            </p>
          ) : (
            <div className="ads-chart-h">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rankingChart} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={78}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number, name: string) =>
                      name === "gasto"
                        ? [v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), "Gasto"]
                        : [v, name === "conversas" ? "Conversas" : "Custo/conversa"]
                    }
                    labelFormatter={(_, p) => p?.[0]?.payload?.full || ""}
                  />
                  <Bar dataKey="conversas" name="conversas" radius={[0, 4, 4, 0]}>
                    {rankingChart.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? "hsl(var(--primary))" : "hsl(160 50% 40%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* CTR / volume diário */}
        <Card className="p-3 sm:p-4 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-semibold">Volume diário (impr. · cliques · conversas)</h4>
          </div>
          {efficiencyDaily.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">Sem série diária ainda.</p>
          ) : (
            <div className="ads-chart-h">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={efficiencyDaily} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashImp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(199 89% 48%)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(199 89% 48%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={36} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="impressoes"
                    name="Impressões"
                    stroke="hsl(199 89% 48%)"
                    fill="url(#dashImp)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="cliques"
                    name="Cliques"
                    stroke="hsl(38 92% 50%)"
                    fill="transparent"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="conversas"
                    name="Conversas"
                    stroke="hsl(var(--primary))"
                    fill="transparent"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Campanhas no ar — lista responsiva */}
      <Card className="p-3 sm:p-4 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold">Campanhas no ar</h4>
          <Badge variant="secondary" className="text-[10px] ml-auto">
            {live.length} ativas
          </Badge>
        </div>
        {live.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            Nenhuma campanha ativa. Publique pela Galeria ou abra o Cérebro para rotação MG.
          </p>
        ) : (
          <div className="space-y-2">
            {live.map((c) => (
              <div
                key={c.id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5 min-w-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate max-w-full">{c.cityLabel}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {statusLabel(c.status)}
                    </Badge>
                    {c.creative_format === "video" && (
                      <Badge className="text-[10px] shrink-0 bg-primary/15 text-primary hover:bg-primary/15">
                        Vídeo
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{c.name}</p>
                </div>
                <div className="flex flex-wrap gap-3 text-[11px] tabular-nums text-muted-foreground sm:justify-end">
                  <span>
                    <strong className="text-foreground">{fmtBRL(c.daily_budget_cents)}</strong>/dia
                  </span>
                  <span>
                    Gasto <strong className="text-foreground">{fmtBRL(c.spend_cents)}</strong>
                  </span>
                  <span>
                    Conv. <strong className="text-foreground">{c.conversations}</strong>
                  </span>
                  <span>
                    CPL{" "}
                    <strong className="text-foreground">
                      {c.cpl_cents != null ? fmtBRL(c.cpl_cents) : "—"}
                    </strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
