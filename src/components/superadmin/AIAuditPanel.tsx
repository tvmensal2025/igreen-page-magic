import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Activity, AlertTriangle, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface DecisionRow {
  id: string;
  created_at: string;
  customer_id: string | null;
  consultant_id: string | null;
  phase: string | null;
  intent_detected: string | null;
  confidence: number | null;
  suppressed: boolean | null;
  step_before: string | null;
  step_after: string | null;
  reply_sent: string | null;
  source: string | null;
  model: string | null;
  latency_ms: number | null;
  trace_id: string | null;
  user_input: string | null;
}

interface Stats {
  total: number;
  avgConfidence: number;
  lowConfidenceRate: number;
  handoffs: number;
  avgLatency: number;
}

const RANGES = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
];

export function AIAuditPanel() {
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [onlyLow, setOnlyLow] = useState(false);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    let q = supabase
      .from("ai_decisions")
      .select(
        "id,created_at,customer_id,consultant_id,phase,intent_detected,confidence,suppressed,step_before,step_after,reply_sent,source,model,latency_ms,trace_id,user_input"
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);
    if (onlyLow) q = q.lt("confidence", 0.75);
    const { data } = await q;
    const list = (data ?? []) as DecisionRow[];
    setRows(list);

    if (list.length > 0) {
      const withConf = list.filter((r) => r.confidence !== null);
      const avg =
        withConf.reduce((a, r) => a + Number(r.confidence ?? 0), 0) /
        Math.max(withConf.length, 1);
      const low = withConf.filter((r) => Number(r.confidence) < 0.75).length;
      const handoffs = list.filter(
        (r) => r.intent_detected === "handoff" || r.suppressed === true
      ).length;
      const lat =
        list.reduce((a, r) => a + (r.latency_ms ?? 0), 0) / list.length;
      setStats({
        total: list.length,
        avgConfidence: avg,
        lowConfidenceRate: withConf.length ? low / withConf.length : 0,
        handoffs,
        avgLatency: lat,
      });
    } else {
      setStats({ total: 0, avgConfidence: 0, lowConfidenceRate: 0, handoffs: 0, avgLatency: 0 });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, onlyLow]);

  const confBadge = (c: number | null) => {
    if (c === null) return <Badge variant="outline">—</Badge>;
    const n = Number(c);
    if (n >= 0.75) return <Badge className="bg-primary/20 text-primary border-primary/40">{n.toFixed(2)}</Badge>;
    if (n >= 0.5) return <Badge className="bg-warning/20 text-warning border-warning/40">{n.toFixed(2)}</Badge>;
    return <Badge className="bg-destructive/20 text-destructive border-destructive/40">{n.toFixed(2)}</Badge>;
  };

  return (
    <div className="bg-card/40 backdrop-blur border border-border/50 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h3 className="text-base font-semibold">Auditoria de Decisões da IA</h3>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <Button
              key={r.hours}
              size="sm"
              variant={hours === r.hours ? "default" : "outline"}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={onlyLow ? "default" : "outline"}
            onClick={() => setOnlyLow((v) => !v)}
          >
            <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Só baixa conf.
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Decisões" value={String(stats.total)} />
          <StatCard label="Conf. média" value={stats.avgConfidence.toFixed(2)} />
          <StatCard
            label="% baixa conf."
            value={`${(stats.lowConfidenceRate * 100).toFixed(0)}%`}
            tone={stats.lowConfidenceRate > 0.3 ? "warn" : "ok"}
          />
          <StatCard label="Handoffs" value={String(stats.handoffs)} tone={stats.handoffs > 0 ? "warn" : "ok"} />
          <StatCard label="Latência média" value={`${Math.round(stats.avgLatency)}ms`} />
        </div>
      )}

      <div className="border border-border/40 rounded-lg overflow-hidden">
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-secondary/30 text-muted-foreground sticky top-0">
              <tr>
                <th className="text-left p-2">Quando</th>
                <th className="text-left p-2">Fase</th>
                <th className="text-left p-2">Intent</th>
                <th className="text-left p-2">Conf.</th>
                <th className="text-left p-2">Step</th>
                <th className="text-left p-2">Input</th>
                <th className="text-left p-2">Reply</th>
                <th className="text-left p-2">Origem</th>
                <th className="text-left p-2">Lat</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Carregando…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    Sem decisões registradas no período.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/30 hover:bg-secondary/20">
                    <td className="p-2 whitespace-nowrap text-muted-foreground">
                      {formatDistanceToNow(new Date(r.created_at), { locale: ptBR, addSuffix: true })}
                    </td>
                    <td className="p-2">{r.phase ?? "—"}</td>
                    <td className="p-2">
                      <span className="font-mono">{r.intent_detected ?? "—"}</span>
                      {r.suppressed && <Badge className="ml-1 bg-destructive/20 text-destructive border-destructive/40">sup</Badge>}
                    </td>
                    <td className="p-2">{confBadge(r.confidence)}</td>
                    <td className="p-2 font-mono text-[10px]">
                      <div className="truncate max-w-[140px]" title={`${r.step_before ?? ""} → ${r.step_after ?? ""}`}>
                        {(r.step_before ?? "—").slice(0, 12)} → {(r.step_after ?? "—").slice(0, 12)}
                      </div>
                    </td>
                    <td className="p-2 max-w-[200px]">
                      <div className="truncate" title={r.user_input ?? ""}>{r.user_input ?? "—"}</div>
                    </td>
                    <td className="p-2 max-w-[220px]">
                      <div className="truncate" title={r.reply_sent ?? ""}>{r.reply_sent ?? "—"}</div>
                    </td>
                    <td className="p-2 text-muted-foreground">{r.source ?? r.model ?? "—"}</td>
                    <td className="p-2 text-muted-foreground">{r.latency_ms ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div
      className={`p-3 rounded-lg border ${
        tone === "warn"
          ? "border-warning/40 bg-warning/10"
          : "border-border/40 bg-secondary/20"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}
