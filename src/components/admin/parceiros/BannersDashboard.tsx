import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CalendarDays,
  Clock,
  Eye,
  LayoutGrid,
  MapPin,
  QrCode,
  TrendingUp,
  UserPlus,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { BannerSpot } from "./ConsultantBannerDownloadModal";
import {
  BannerNamesTable,
  buildBannerNameRows,
} from "./BannerNamesTable";

interface Props {
  consultantId: string;
  spots: BannerSpot[];
}

type Period = 7 | 30 | 90 | "all";

const PERIOD_OPTS: { value: Period; label: string }[] = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
  { value: "all", label: "Todo período" },
];

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const FAIXAS_HORARIO = [
  { label: "Madrugada", sub: "0h-6h", min: 0, max: 5 },
  { label: "Manhã", sub: "6h-12h", min: 6, max: 11 },
  { label: "Tarde", sub: "12h-18h", min: 12, max: 17 },
  { label: "Noite", sub: "18h-24h", min: 18, max: 23 },
];
const PIE_COLORS = ["#16a34a", "#2563eb", "#f59e0b", "#a855f7", "#ef4444", "#0ea5e9", "#9ca3af"];

type ScanRow = {
  event_type: string;
  event_target: string | null;
  created_at: string;
};

type LeadRow = {
  referral_keyword_matched: string | null;
  created_at: string;
};

/** PostgREST pagina em 1000 — busca tudo. */
async function fetchAllRows<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { rows: out, error: error.message || "erro ao ler métricas" };
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return { rows: out, error: null };
}

function labelTarget(
  target: string | null | undefined,
  spots: BannerSpot[],
): string {
  const t = String(target || "").trim();
  if (!t || t === "banner_root" || t === "panfleto") return "Geral";
  if (t.startsWith("banner_spot:")) {
    const code = t.slice("banner_spot:".length);
    const spot = spots.find((s) => s.code === code);
    return spot?.keyword || code || "Local";
  }
  return t;
}

function isBannerScanTarget(target: string | null | undefined): boolean {
  const t = String(target || "").trim();
  return (
    t === "banner_root" ||
    t === "panfleto" ||
    t.startsWith("banner_spot:")
  );
}

/** Hora em BRT (America/Sao_Paulo) a partir de ISO UTC. */
function hourInBrt(iso: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date(iso));
    const h = parts.find((p) => p.type === "hour")?.value;
    return Number(h || 0) % 24;
  } catch {
    return new Date(iso).getHours();
  }
}

function weekdayInBrt(iso: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
    }).formatToParts(new Date(iso));
    const wd = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() || "";
    const map: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };
    return map[wd.slice(0, 3)] ?? new Date(iso).getDay();
  } catch {
    return new Date(iso).getDay();
  }
}

export function BannersDashboard({ consultantId, spots }: Props) {
  const [period, setPeriod] = useState<Period>("all");
  const [scans, setScans] = useState<ScanRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!consultantId) {
      setLoading(true);
      setScans([]);
      setLeads([]);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    let cancelled = false;

    const sinceIso =
      period === "all"
        ? null
        : (() => {
            const since = new Date();
            since.setDate(since.getDate() - period);
            return since.toISOString();
          })();

    (async () => {
      const [sRes, lRes] = await Promise.all([
        fetchAllRows<ScanRow>((from, to) => {
          let q = supabase
            .from("page_events")
            .select("event_type, event_target, created_at")
            .eq("consultant_id", consultantId)
            .in("event_type", ["qr_scan", "qr_broken"])
            .order("created_at", { ascending: true })
            .range(from, to);
          if (sinceIso) q = q.gte("created_at", sinceIso);
          return q;
        }),
        fetchAllRows<LeadRow>((from, to) => {
          let q = supabase
            .from("customers")
            .select("referral_keyword_matched, created_at")
            .eq("consultant_id", consultantId)
            .not("referral_keyword_matched", "is", null)
            .order("created_at", { ascending: true })
            .range(from, to);
          if (sinceIso) q = q.gte("created_at", sinceIso);
          return q;
        }),
      ]);
      if (cancelled) return;
      setLoadError(sRes.error || lRes.error);
      setScans(sRes.rows.filter((r) => isBannerScanTarget(r.event_target)));
      setLeads(lRes.rows);
      setLoading(false);
    })().catch((e) => {
      if (!cancelled) {
        setScans([]);
        setLeads([]);
        setLoadError(String((e as Error)?.message || e));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [consultantId, period]);

  const metrics = useMemo(() => {
    const okScans = scans.filter((s) => s.event_type === "qr_scan");
    const broken = scans.filter((s) => s.event_type === "qr_broken");
    const totalScans = okScans.length;
    const totalLeads = leads.length;
    const conversao =
      totalScans > 0 ? Math.round((totalLeads / totalScans) * 100) : 0;

    const dayMap: Record<string, number> = {};
    okScans.forEach((s) => {
      const d = s.created_at?.slice(0, 10);
      if (d) dayMap[d] = (dayMap[d] || 0) + 1;
    });
    const daily = Object.entries(dayMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, n]) => ({ date: date.slice(5), leituras: n }));

    const weekMap = [0, 0, 0, 0, 0, 0, 0];
    okScans.forEach((s) => {
      weekMap[weekdayInBrt(s.created_at)]++;
    });
    const byWeekday = DIAS_SEMANA.map((label, i) => ({
      dia: label,
      leituras: weekMap[i],
    }));
    const bestWeekday = weekMap.indexOf(Math.max(...weekMap));

    const hourBuckets = FAIXAS_HORARIO.map((f) => ({ ...f, leituras: 0 }));
    okScans.forEach((s) => {
      const h = hourInBrt(s.created_at);
      const bucket = hourBuckets.find((b) => h >= b.min && h <= b.max);
      if (bucket) bucket.leituras++;
    });
    const bestHourBucket = hourBuckets.reduce(
      (a, b) => (b.leituras > a.leituras ? b : a),
      hourBuckets[0],
    );

    const targetMap: Record<string, number> = {};
    okScans.forEach((s) => {
      const key = String(s.event_target || "banner_root");
      targetMap[key] = (targetMap[key] || 0) + 1;
    });
    const byLocal = Object.entries(targetMap)
      .sort((a, b) => b[1] - a[1])
      .map(([raw, value]) => ({
        name: labelTarget(raw, spots),
        value,
        raw,
      }));

    const kwMap: Record<string, number> = {};
    leads.forEach((l) => {
      const kw = String(l.referral_keyword_matched || "").trim();
      if (!kw) return;
      kwMap[kw] = (kwMap[kw] || 0) + 1;
    });
    const byKeyword = Object.entries(kwMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    const rootScans =
      (targetMap.banner_root || 0) + (targetMap.panfleto || 0);
    const spotScans = totalScans - rootScans;

    const scanByCode: Record<string, number> = {};
    Object.entries(targetMap).forEach(([raw, n]) => {
      if (raw.startsWith("banner_spot:")) {
        const code = raw.slice("banner_spot:".length);
        scanByCode[code] = (scanByCode[code] || 0) + n;
      }
    });

    const nameRows = buildBannerNameRows({
      rootScans,
      rootLeads: 0,
      spots,
      scanByCode,
      leadByKeyword: kwMap,
    });

    return {
      totalScans,
      broken: broken.length,
      totalLeads,
      conversao,
      daily,
      byWeekday,
      bestWeekday,
      hourBuckets,
      bestHourBucket,
      byLocal,
      byKeyword,
      rootScans,
      spotScans,
      nameRows,
    };
  }, [scans, leads, spots]);

  const periodLabel =
    period === "all"
      ? "todo o período"
      : period === 7
        ? "7 dias"
        : period === 30
          ? "30 dias"
          : "90 dias";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-heading font-bold text-foreground text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Resultados dos banners
        </h2>
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1 flex-wrap">
          {PERIOD_OPTS.map((p) => (
            <button
              key={String(p.value)}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                period === p.value
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground -mt-3">
        Leituras = alguém escaneou o QR. Leads = conversas no WhatsApp com o{" "}
        <strong className="font-medium text-foreground/80">nome do banner</strong>.
        Horários em Brasília. Sem nome de local, tudo cai em “Banner Geral”.
      </p>

      {loading || !consultantId ? (
        <div className="h-64 flex items-center justify-center text-muted-foreground">
          Carregando dados reais…
        </div>
      ) : loadError ? (
        <div className="bg-card rounded-2xl border border-destructive/30 p-8 text-center">
          <p className="font-heading font-bold text-foreground">
            Não consegui ler as leituras
          </p>
          <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
        </div>
      ) : metrics.totalScans === 0 && metrics.totalLeads === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-10 text-center">
          <QrCode className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-heading font-bold text-foreground">
            Ainda sem leituras neste período
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Imprima e divulgue seus banners — os gráficos aparecem aqui
            automaticamente.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <BigCard
              icon={<Eye />}
              value={metrics.totalScans}
              label="Leituras QR"
              sub={`em ${periodLabel}`}
              color="from-primary/20 to-primary/5"
              iconColor="text-primary"
            />
            <BigCard
              icon={<LayoutGrid />}
              value={metrics.rootScans}
              label="Banner Geral"
              sub="QR raiz"
              color="from-emerald-500/20 to-emerald-500/5"
              iconColor="text-emerald-600"
            />
            <BigCard
              icon={<MapPin />}
              value={metrics.spotScans}
              label="Com local"
              sub="pontos físicos"
              color="from-blue-500/20 to-blue-500/5"
              iconColor="text-blue-500"
            />
            <BigCard
              icon={<UserPlus />}
              value={metrics.totalLeads}
              label="Leads"
              sub="com keyword do banner"
              color="from-[#25D366]/20 to-[#25D366]/5"
              iconColor="text-[#25D366]"
            />
            <BigCard
              icon={<TrendingUp />}
              value={`${metrics.conversao}%`}
              label="Leitura → lead"
              sub="aprox. (mesmo período)"
              color="from-warning/20 to-warning/5"
              iconColor="text-warning"
            />
          </div>

          {metrics.broken > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {metrics.broken} leitura(s) com WhatsApp inválido no momento do
              scan — confira o número conectado.
            </div>
          )}

          <BannerNamesTable
            rows={metrics.nameRows}
            title="Nome | leituras | leads"
            emptyHint="Crie banners com nome (Com local) para separar cada ponto nesta tabela."
          />

          <ChartCard title="Leituras por dia" icon={<TrendingUp className="w-4 h-4" />}>
            {metrics.daily.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={metrics.daily}>
                  <defs>
                    <linearGradient id="gBannerScans" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="leituras"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#gBannerScans)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyMini />
            )}
          </ChartCard>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <HighlightCard
              icon={<CalendarDays className="w-5 h-5" />}
              title="Melhor dia da semana"
              value={
                ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][
                  metrics.bestWeekday
                ] || "—"
              }
              sub="Dia com mais leituras de QR"
            />
            <HighlightCard
              icon={<Clock className="w-5 h-5" />}
              title="Melhor horário"
              value={`${metrics.bestHourBucket.label} (${metrics.bestHourBucket.sub})`}
              sub="Faixa com mais leituras (BRT)"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard
              title="Leituras por dia da semana"
              icon={<CalendarDays className="w-4 h-4" />}
            >
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={metrics.byWeekday}>
                  <XAxis
                    dataKey="dia"
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                  />
                  <Bar dataKey="leituras" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Leituras por período do dia"
              icon={<Clock className="w-4 h-4" />}
            >
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={metrics.hourBuckets}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                  />
                  <Bar dataKey="leituras" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="Leituras por local" icon={<MapPin className="w-4 h-4" />}>
              {metrics.byLocal.length > 0 ? (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width={150} height={150}>
                    <PieChart>
                      <Pie
                        data={metrics.byLocal}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={38}
                        outerRadius={65}
                        strokeWidth={2}
                      >
                        {metrics.byLocal.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 flex-1 max-h-[160px] overflow-y-auto">
                    {metrics.byLocal.map((s, i) => (
                      <div key={s.raw} className="flex items-center gap-2 text-xs">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="text-foreground/80 flex-1 truncate">{s.name}</span>
                        <span className="font-bold text-foreground">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyMini />
              )}
            </ChartCard>

            <ChartCard title="Leads por palavra-chave" icon={<UserPlus className="w-4 h-4" />}>
              {metrics.byKeyword.length > 0 ? (
                <div className="space-y-2">
                  {metrics.byKeyword.map((p) => {
                    const pct =
                      metrics.totalLeads > 0
                        ? Math.round((p.value / metrics.totalLeads) * 100)
                        : 0;
                    return (
                      <div key={p.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs gap-2">
                          <span className="text-foreground/90 truncate">{p.name}</span>
                          <span className="font-bold text-foreground shrink-0">
                            {p.value} · {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyMini />
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

function BigCard({
  icon,
  value,
  label,
  sub,
  color,
  iconColor,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  sub: string;
  color: string;
  iconColor: string;
}) {
  return (
    <div className={`rounded-2xl border border-border p-4 bg-gradient-to-br ${color}`}>
      <div className={`mb-2 ${iconColor}`}>{icon}</div>
      <p className="font-heading font-black text-2xl text-foreground">
        {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
      </p>
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function ChartCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <p className="text-xs font-heading font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

function HighlightCard({
  icon,
  title,
  value,
  sub,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-gradient-to-br from-primary/10 to-transparent rounded-2xl border border-primary/20 p-5">
      <div className="flex items-center gap-2 text-primary mb-2">
        {icon}
        <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
      </div>
      <p className="font-heading font-black text-xl text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function EmptyMini() {
  return (
    <div className="h-[150px] flex items-center justify-center text-muted-foreground text-sm">
      Sem dados ainda
    </div>
  );
}
