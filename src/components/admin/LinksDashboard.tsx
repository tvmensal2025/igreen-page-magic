import { useState, useEffect, useMemo } from "react";
import { Eye, Smartphone, Monitor, MousePointerClick, MessageCircle, UserPlus, TrendingUp, Clock, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

// ════════════════════════════════════════════════
// Dashboard de métricas das landing pages do consultor
// Lê page_views (visitas) e page_events (cliques) dos últimos N dias.
// ════════════════════════════════════════════════

interface LinksDashboardProps {
  consultantId?: string;
}

const PIE_COLORS = ["#25D366", "#E1306C", "#1877F2", "#69C9D0", "#FF0000", "#4285F4", "#9ca3af"];
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const FAIXAS_HORARIO = [
  { label: "Madrugada", sub: "0h-6h", min: 0, max: 5 },
  { label: "Manhã", sub: "6h-12h", min: 6, max: 11 },
  { label: "Tarde", sub: "12h-18h", min: 12, max: 17 },
  { label: "Noite", sub: "18h-24h", min: 18, max: 23 },
];

/** `all` = desde o primeiro registro (nada de fora). */
type Period = 7 | 30 | 90 | "all";

const PERIOD_OPTS: { value: Period; label: string }[] = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
  { value: "all", label: "Todo período" },
];

/** Busca todas as linhas (pagina além do limite default 1000 do PostgREST). */
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) break;
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return out;
}

export function LinksDashboard({ consultantId }: LinksDashboardProps) {
  const [period, setPeriod] = useState<Period>("all");
  const [views, setViews] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!consultantId) { setLoading(false); return; }
    setLoading(true);
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
      const [v, e] = await Promise.all([
        fetchAllRows((from, to) => {
          let q = supabase
            .from("page_views")
            .select("page_type, device_type, utm_source, created_at")
            .eq("consultant_id", consultantId)
            .order("created_at", { ascending: true })
            .range(from, to);
          if (sinceIso) q = q.gte("created_at", sinceIso);
          return q;
        }),
        fetchAllRows((from, to) => {
          let q = supabase
            .from("page_events")
            .select("event_target, page_type, device_type, utm_source, created_at")
            .eq("consultant_id", consultantId)
            .order("created_at", { ascending: true })
            .range(from, to);
          if (sinceIso) q = q.gte("created_at", sinceIso);
          return q;
        }),
      ]);
      if (cancelled) return;
      setViews(v);
      setEvents(e);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) {
        setViews([]);
        setEvents([]);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [consultantId, period]);

  // ─── Cálculos ───
  const metrics = useMemo(() => {
    const totalViews = views.length;
    const mobile = views.filter((v) => v.device_type === "mobile").length;
    const desktop = totalViews - mobile;

    // Cliques
    const whatsappClicks = events.filter((e) => e.event_target === "whatsapp").length;
    const cadastroClicks = events.filter((e) => e.event_target === "cadastro").length;
    const totalClicks = events.length;
    const conversao = totalViews > 0 ? Math.round((totalClicks / totalViews) * 100) : 0;

    // Por dia
    const dayMap: Record<string, number> = {};
    views.forEach((v) => {
      const d = v.created_at?.slice(0, 10);
      if (d) dayMap[d] = (dayMap[d] || 0) + 1;
    });
    const daily = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0])).map(([date, n]) => ({ date: date.slice(5), visitas: n }));

    // Por dia da semana
    const weekMap = [0, 0, 0, 0, 0, 0, 0];
    views.forEach((v) => {
      const wd = new Date(v.created_at).getDay();
      weekMap[wd]++;
    });
    const byWeekday = DIAS_SEMANA.map((label, i) => ({ dia: label, visitas: weekMap[i] }));
    const bestWeekday = weekMap.indexOf(Math.max(...weekMap));

    // Por faixa de horário
    const hourBuckets = FAIXAS_HORARIO.map((f) => ({ ...f, visitas: 0 }));
    views.forEach((v) => {
      const h = new Date(v.created_at).getHours();
      const bucket = hourBuckets.find((b) => h >= b.min && h <= b.max);
      if (bucket) bucket.visitas++;
    });
    const bestHourBucket = hourBuckets.reduce((a, b) => (b.visitas > a.visitas ? b : a), hourBuckets[0]);

    // Por hora exata (para heatmap simples)
    const hourMap = Array.from({ length: 24 }, (_, h) => ({ hora: `${h}h`, visitas: 0 }));
    views.forEach((v) => {
      const h = new Date(v.created_at).getHours();
      hourMap[h].visitas++;
    });

    // Fontes
    const srcMap: Record<string, number> = {};
    views.forEach((v) => {
      const s = v.utm_source || "direto";
      srcMap[s] = (srcMap[s] || 0) + 1;
    });
    const bySource = Object.entries(srcMap).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, value]) => ({ name, value }));

    // Páginas mais visitadas
    const pageMap: Record<string, number> = {};
    views.forEach((v) => {
      const p = v.page_type || "outro";
      pageMap[p] = (pageMap[p] || 0) + 1;
    });
    const byPage = Object.entries(pageMap).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));

    return {
      totalViews, mobile, desktop, whatsappClicks, cadastroClicks, totalClicks, conversao,
      daily, byWeekday, bestWeekday, hourBuckets, bestHourBucket, hourMap, bySource, byPage,
    };
  }, [views, events]);

  const periodLabel =
    period === "all" ? "todo o período" : period === 7 ? "7 dias" : period === 30 ? "30 dias" : "90 dias";

  return (
    <div className="space-y-6">
      {/* Cabeçalho + seletor de período */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-heading font-bold text-foreground text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Painel de Resultados
        </h2>
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1 flex-wrap">
          {PERIOD_OPTS.map((p) => (
            <button
              key={String(p.value)}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p.value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center text-muted-foreground">Carregando dados...</div>
      ) : metrics.totalViews === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-10 text-center">
          <Eye className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-heading font-bold text-foreground">Ainda sem visitas neste período</p>
          <p className="text-sm text-muted-foreground mt-1">Compartilhe seus links e os dados aparecem aqui automaticamente.</p>
        </div>
      ) : (
        <>
          {/* ─── Cards principais ─── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <BigCard icon={<Eye />} value={metrics.totalViews} label="Visitas" sub={`em ${periodLabel}`} color="from-primary/20 to-primary/5" iconColor="text-primary" />
            <BigCard icon={<MessageCircle />} value={metrics.whatsappClicks} label="Cliques WhatsApp" sub="quiseram falar" color="from-[#25D366]/20 to-[#25D366]/5" iconColor="text-[#25D366]" />
            <BigCard icon={<UserPlus />} value={metrics.cadastroClicks} label="Cliques Cadastro" sub="foram se cadastrar" color="from-blue-500/20 to-blue-500/5" iconColor="text-blue-500" />
            <BigCard icon={<MousePointerClick />} value={`${metrics.conversao}%`} label="Conversão" sub="visitas que agiram" color="from-warning/20 to-warning/5" iconColor="text-warning" />
          </div>

          {/* ─── Visitas por dia ─── */}
          <ChartCard title="Visitas por dia" icon={<TrendingUp className="w-4 h-4" />}>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={metrics.daily}>
                <defs>
                  <linearGradient id="gViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={28} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="visitas" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gViews)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* ─── Melhor dia + Melhor horário (destaques) ─── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <HighlightCard
              icon={<CalendarDays className="w-5 h-5" />}
              title="Melhor dia da semana"
              value={["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][metrics.bestWeekday]}
              sub="É quando você recebe mais visitas — poste nesse dia!"
            />
            <HighlightCard
              icon={<Clock className="w-5 h-5" />}
              title="Melhor horário"
              value={`${metrics.bestHourBucket.label} (${metrics.bestHourBucket.sub})`}
              sub="Período com mais acessos — divulgue nesse horário!"
            />
          </div>

          {/* ─── Dia da semana + Horário (gráficos) ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="Visitas por dia da semana" icon={<CalendarDays className="w-4 h-4" />}>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={metrics.byWeekday}>
                  <XAxis dataKey="dia" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={28} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                  <Bar dataKey="visitas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Visitas por período do dia" icon={<Clock className="w-4 h-4" />}>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={metrics.hourBuckets}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={28} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                  <Bar dataKey="visitas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* ─── Fontes + Dispositivo ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard title="De onde vêm as visitas" icon={<TrendingUp className="w-4 h-4" />}>
              {metrics.bySource.length > 0 ? (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width={150} height={150}>
                    <PieChart>
                      <Pie data={metrics.bySource} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={65} strokeWidth={2}>
                        {metrics.bySource.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 flex-1">
                    {metrics.bySource.map((s, i) => (
                      <div key={s.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-foreground/80 flex-1 capitalize">{s.name}</span>
                        <span className="font-bold text-foreground">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <EmptyMini />}
            </ChartCard>

            <ChartCard title="Celular vs Computador" icon={<Smartphone className="w-4 h-4" />}>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={150} height={150}>
                  <PieChart>
                    <Pie data={[{ name: "Celular", value: metrics.mobile }, { name: "Computador", value: metrics.desktop }]} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={65} strokeWidth={2}>
                      <Cell fill="#3b82f6" />
                      <Cell fill="#a855f7" />
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Smartphone className="w-4 h-4 text-blue-500" />
                    <span className="text-foreground/80 flex-1">Celular</span>
                    <span className="font-bold text-foreground">{metrics.mobile}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Monitor className="w-4 h-4 text-purple-500" />
                    <span className="text-foreground/80 flex-1">Computador</span>
                    <span className="font-bold text-foreground">{metrics.desktop}</span>
                  </div>
                </div>
              </div>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Componentes auxiliares ───
const tooltipStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" };

function BigCard({ icon, value, label, sub, color, iconColor }: { icon: React.ReactNode; value: number | string; label: string; sub: string; color: string; iconColor: string }) {
  return (
    <div className={`rounded-2xl border border-border p-4 bg-gradient-to-br ${color}`}>
      <div className={`mb-2 ${iconColor}`}>{icon}</div>
      <p className="font-heading font-black text-2xl text-foreground">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</p>
      <p className="text-xs font-medium text-foreground/80">{label}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function ChartCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <p className="text-xs font-heading font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

function HighlightCard({ icon, title, value, sub }: { icon: React.ReactNode; title: string; value: string; sub: string }) {
  return (
    <div className="bg-gradient-to-br from-primary/10 to-transparent rounded-2xl border border-primary/20 p-5">
      <div className="flex items-center gap-2 text-primary mb-2">{icon}<span className="text-xs font-bold uppercase tracking-wider">{title}</span></div>
      <p className="font-heading font-black text-xl text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

function EmptyMini() {
  return <div className="h-[150px] flex items-center justify-center text-muted-foreground text-sm">Sem dados ainda</div>;
}
