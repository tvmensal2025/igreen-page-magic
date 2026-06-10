import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, BarChart3, RefreshCw, Flame } from "lucide-react";

interface ABRow {
  id: string;
  template_key: string;
  step_key: string;
  variant: string;
  consultant_id: string | null;
  sent_count: number;
  replied_count: number;
  advanced_count: number;
  last_sent_at: string | null;
}

interface Grouped {
  template_key: string;
  step_key: string;
  variants: Record<string, { sent: number; replied: number; advanced: number }>;
  totalSent: number;
  bestVariant: string | null;
}

const VARIANT_COLORS: Record<string, string> = {
  A: "bg-info/15 text-info border-info/30",
  B: "bg-primary/15 text-primary border-primary/30",
  C: "bg-warning/15 text-warning border-warning/30",
  default: "bg-muted text-muted-foreground border-border",
};

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function heatColor(rate: number) {
  // rate is advance_rate 0-100
  if (rate >= 70) return "bg-primary/40 text-primary";
  if (rate >= 50) return "bg-primary/25 text-primary";
  if (rate >= 30) return "bg-warning/25 text-warning";
  if (rate >= 15) return "bg-warning/25 text-warning";
  return "bg-destructive/30 text-destructive";
}

export function ABResultsPanel() {
  const [rows, setRows] = useState<ABRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [minSent, setMinSent] = useState(5);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("bot_message_ab_results")
      .select("id,template_key,step_key,variant,consultant_id,sent_count,replied_count,advanced_count,last_sent_at")
      .order("sent_count", { ascending: false })
      .limit(500);
    setRows((data ?? []) as ABRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo<Grouped[]>(() => {
    const map = new Map<string, Grouped>();
    for (const r of rows) {
      const key = `${r.template_key}::${r.step_key}`;
      let g = map.get(key);
      if (!g) {
        g = {
          template_key: r.template_key,
          step_key: r.step_key,
          variants: {},
          totalSent: 0,
          bestVariant: null,
        };
        map.set(key, g);
      }
      const v = g.variants[r.variant] ?? { sent: 0, replied: 0, advanced: 0 };
      v.sent += r.sent_count;
      v.replied += r.replied_count;
      v.advanced += r.advanced_count;
      g.variants[r.variant] = v;
      g.totalSent += r.sent_count;
    }
    for (const g of map.values()) {
      let best: string | null = null;
      let bestRate = -1;
      for (const [variant, v] of Object.entries(g.variants)) {
        if (v.sent < minSent) continue;
        const rate = pct(v.advanced, v.sent);
        if (rate > bestRate) {
          bestRate = rate;
          best = variant;
        }
      }
      g.bestVariant = best;
    }
    return Array.from(map.values())
      .filter((g) => g.totalSent >= minSent)
      .sort((a, b) => b.totalSent - a.totalSent);
  }, [rows, minSent]);

  const dropoffByStep = useMemo(() => {
    const map = new Map<string, { sent: number; advanced: number }>();
    for (const g of grouped) {
      const cur = map.get(g.step_key) ?? { sent: 0, advanced: 0 };
      for (const v of Object.values(g.variants)) {
        cur.sent += v.sent;
        cur.advanced += v.advanced;
      }
      map.set(g.step_key, cur);
    }
    return Array.from(map.entries())
      .map(([step_key, x]) => ({
        step_key,
        sent: x.sent,
        advanced: x.advanced,
        advanceRate: pct(x.advanced, x.sent),
        dropRate: 100 - pct(x.advanced, x.sent),
      }))
      .sort((a, b) => b.sent - a.sent);
  }, [grouped]);

  return (
    <div className="space-y-4 rounded-2xl border border-border/50 bg-card/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-5 text-primary" />
          <h2 className="text-base font-semibold">A/B/C Results</h2>
          <Badge variant="outline" className="text-xs">
            {grouped.length} step×template
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">
            min sent
            <input
              type="number"
              value={minSent}
              onChange={(e) => setMinSent(Math.max(0, Number(e.target.value) || 0))}
              className="ml-2 w-16 rounded border border-border bg-background px-2 py-1 text-xs"
            />
          </label>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          </Button>
        </div>
      </div>

      {/* Drop-off heatmap */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Flame className="size-3.5" /> Drop-off por step (advance rate %)
        </div>
        {dropoffByStep.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem dados suficientes.</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 lg:grid-cols-4">
            {dropoffByStep.map((s) => (
              <div
                key={s.step_key}
                className={`rounded-lg border border-border/40 px-2.5 py-2 ${heatColor(s.advanceRate)}`}
                title={`${s.advanced}/${s.sent} avançaram`}
              >
                <div className="truncate text-[11px] font-medium" title={s.step_key}>
                  {s.step_key}
                </div>
                <div className="mt-0.5 flex items-baseline justify-between">
                  <span className="text-lg font-bold tabular-nums">{s.advanceRate}%</span>
                  <span className="text-[10px] opacity-70">{s.sent} env</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* A/B/C table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border/50">
              <th className="px-2 py-1.5 text-left">Step</th>
              <th className="px-2 py-1.5 text-left">Template</th>
              <th className="px-2 py-1.5 text-right">Variant</th>
              <th className="px-2 py-1.5 text-right">Sent</th>
              <th className="px-2 py-1.5 text-right">Reply%</th>
              <th className="px-2 py-1.5 text-right">Advance%</th>
              <th className="px-2 py-1.5 text-center">Best</th>
            </tr>
          </thead>
          <tbody>
            {grouped.flatMap((g) =>
              Object.entries(g.variants)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([variant, v]) => {
                  const isBest = g.bestVariant === variant && Object.keys(g.variants).length > 1;
                  return (
                    <tr
                      key={`${g.template_key}-${g.step_key}-${variant}`}
                      className="border-b border-border/20 hover:bg-muted/30"
                    >
                      <td className="px-2 py-1.5 font-mono text-[11px]">{g.step_key}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{g.template_key}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Badge variant="outline" className={`text-[10px] ${VARIANT_COLORS[variant] ?? VARIANT_COLORS.default}`}>
                          {variant}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{v.sent}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{pct(v.replied, v.sent)}%</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                        {pct(v.advanced, v.sent)}%
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {isBest ? <span className="text-primary">★</span> : <span className="text-muted-foreground/40">·</span>}
                      </td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
        {grouped.length === 0 && !loading && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nenhum resultado com sent ≥ {minSent}.
          </p>
        )}
      </div>
    </div>
  );
}
