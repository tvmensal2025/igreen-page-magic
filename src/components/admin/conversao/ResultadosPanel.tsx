import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2, RefreshCw, TrendingUp, MessageCircleReply, ArrowUpRight,
  XCircle, Send, Hourglass,
} from "lucide-react";
import { toast } from "sonner";
import { stepLabel, loadFlowTitles } from "./stepLabels";

/**
 * Aba RESULTADOS — mostra o desfecho dos envios de reaquecimento
 * (reactivation_sends.outcome) usando as RPCs tenant-safe
 * reactivation_outcome_stats e reactivation_outcome_by_step.
 *
 * É read-only: os outcomes são populados por triggers + cron no backend.
 */

interface Stats {
  total: number;
  sent: number;
  failed: number;
  responded: number;
  advanced: number;
  abandoned: number;
  pending_outcome: number;
}

interface StepRow {
  conversation_step: string;
  total: number;
  responded: number;
  advanced: number;
  abandoned: number;
}

type Period = "7d" | "30d" | "all";

const PERIOD_LABEL: Record<Period, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  all: "Tudo",
};

function sinceFor(p: Period): string | null {
  if (p === "all") return null;
  const days = p === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

interface Props {
  consultantId: string;
}

export function ResultadosPanel({ consultantId }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("30d");
  const [flowTitles, setFlowTitles] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    const since = sinceFor(period);
    const [statsRes, stepsRes] = await Promise.all([
      (supabase as any).rpc("reactivation_outcome_stats", {
        p_consultant_id: consultantId,
        p_since: since,
      }),
      (supabase as any).rpc("reactivation_outcome_by_step", {
        p_consultant_id: consultantId,
        p_since: since,
      }),
    ]);

    if (statsRes.error) {
      toast.error("Falha ao carregar resultados", { description: statsRes.error.message });
      setLoading(false);
      return;
    }

    const row = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;
    setStats(
      row
        ? {
            total: Number(row.total ?? 0),
            sent: Number(row.sent ?? 0),
            failed: Number(row.failed ?? 0),
            responded: Number(row.responded ?? 0),
            advanced: Number(row.advanced ?? 0),
            abandoned: Number(row.abandoned ?? 0),
            pending_outcome: Number(row.pending_outcome ?? 0),
          }
        : { total: 0, sent: 0, failed: 0, responded: 0, advanced: 0, abandoned: 0, pending_outcome: 0 },
    );

    const stepRows: StepRow[] = (stepsRes.data ?? []).map((r: any) => ({
      conversation_step: r.conversation_step,
      total: Number(r.total ?? 0),
      responded: Number(r.responded ?? 0),
      advanced: Number(r.advanced ?? 0),
      abandoned: Number(r.abandoned ?? 0),
    }));
    setSteps(stepRows);
    loadFlowTitles(stepRows.map((s) => s.conversation_step)).then(setFlowTitles);
    setLoading(false);
  }, [consultantId, period]);

  useEffect(() => { load(); }, [load]);

  // Taxa de sucesso = (respondeu + avançou) / enviados com outcome fechado
  const successRate = useMemo(() => {
    if (!stats) return 0;
    const closed = stats.responded + stats.advanced + stats.abandoned;
    return pct(stats.responded + stats.advanced, closed);
  }, [stats]);

  if (loading) {
    return (
      <Card className="grid place-items-center p-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="space-y-4">
        <PeriodBar period={period} setPeriod={setPeriod} onReload={load} />
        <Card className="p-16 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/40 bg-muted/40">
            <Send className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            Nenhum envio de reaquecimento neste período.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Os resultados aparecem aqui depois que você reativar leads pela fila.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PeriodBar period={period} setPeriod={setPeriod} onReload={load} />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          label="Taxa de sucesso"
          value={`${successRate}%`}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          tone="success"
          sub="respondeu ou avançou"
        />
        <Kpi label="Enviados" value={String(stats.sent)} icon={<Send className="h-3.5 w-3.5" />} />
        <Kpi
          label="Aguardando desfecho"
          value={String(stats.pending_outcome)}
          icon={<Hourglass className="h-3.5 w-3.5" />}
          tone="muted"
        />
        <Kpi
          label="Falhas no envio"
          value={String(stats.failed)}
          icon={<XCircle className="h-3.5 w-3.5" />}
          tone={stats.failed > 0 ? "danger" : "muted"}
        />
      </div>

      {/* Desfechos */}
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Desfecho dos envios</h3>
        <div className="space-y-2.5">
          <OutcomeBar
            label="Avançaram no funil"
            icon={<ArrowUpRight className="h-3.5 w-3.5" />}
            count={stats.advanced}
            total={stats.total}
            cls="bg-success"
          />
          <OutcomeBar
            label="Responderam"
            icon={<MessageCircleReply className="h-3.5 w-3.5" />}
            count={stats.responded}
            total={stats.total}
            cls="bg-info"
          />
          <OutcomeBar
            label="Abandonaram (7d sem resposta)"
            icon={<XCircle className="h-3.5 w-3.5" />}
            count={stats.abandoned}
            total={stats.total}
            cls="bg-muted-foreground"
          />
          <OutcomeBar
            label="Aguardando desfecho"
            icon={<Hourglass className="h-3.5 w-3.5" />}
            count={stats.pending_outcome}
            total={stats.total}
            cls="bg-warning"
          />
        </div>
      </Card>

      {/* Por etapa */}
      {steps.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-border/40 bg-muted/30 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground">Resultado por etapa</h3>
            <p className="text-[11px] text-muted-foreground">
              Onde o reaquecimento converte melhor.
            </p>
          </div>
          <table className="w-full text-xs">
            <thead className="border-b border-border/40 text-left text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Etapa</th>
                <th className="px-3 py-2 text-right">Envios</th>
                <th className="px-3 py-2 text-right">Avançou</th>
                <th className="px-3 py-2 text-right">Respondeu</th>
                <th className="px-3 py-2 text-right">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => {
                const success = pct(s.responded + s.advanced, s.total);
                return (
                  <tr key={s.conversation_step} className="border-b border-border/30">
                    <td className="px-4 py-2 text-foreground">{stepLabel(s.conversation_step, flowTitles)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{s.total}</td>
                    <td className="px-3 py-2 text-right font-mono text-success">{s.advanced}</td>
                    <td className="px-3 py-2 text-right font-mono text-info">{s.responded}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`font-mono ${success >= 50 ? "text-success" : success >= 25 ? "text-warning" : "text-muted-foreground"}`}>
                        {success}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function PeriodBar({ period, setPeriod, onReload }: {
  period: Period; setPeriod: (p: Period) => void; onReload: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex gap-1">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
              period === p
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/40 bg-card text-muted-foreground hover:border-border"
            }`}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={onReload}>
        <RefreshCw className="mr-1 h-4 w-4" /> Recarregar
      </Button>
    </div>
  );
}

function Kpi({ label, value, sub, icon, tone = "default" }: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  tone?: "default" | "success" | "danger" | "muted";
}) {
  const toneCls = tone === "success" ? "text-success"
    : tone === "danger" ? "text-destructive"
    : tone === "muted" ? "text-muted-foreground"
    : "text-foreground";
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className={`mt-1 text-xl font-semibold ${toneCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function OutcomeBar({ label, icon, count, total, cls }: {
  label: string; icon: React.ReactNode; count: number; total: number; cls: string;
}) {
  const p = pct(count, total);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">{icon} {label}</span>
        <span className="font-mono text-foreground">{count} · {p}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
        <div className={`h-full ${cls} transition-all`} style={{ width: `${Math.max(2, p)}%` }} />
      </div>
    </div>
  );
}

export default ResultadosPanel;
