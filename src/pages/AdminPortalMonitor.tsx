/**
 * /admin/portal-monitor — PR 4 (observabilidade do worker portal2)
 *
 * Mostra os últimos cadastros no Portal iGreen feitos pelo worker, com:
 *  - resumo de status (7 dias) e tempo médio
 *  - lista das últimas execuções (sucesso / needs_human / erro)
 *  - resolução de distribuidora (UI) × concessionária (portal) × fornecedora (bônus)
 *
 * Acessível por qualquer usuário autenticado que já tenha acesso ao /admin.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Trace = {
  id: string;
  customer_id: string | null;
  job_id: string | null;
  status: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  result: any;
  input_summary: any;
};

function fmtMs(ms: number | null) {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusBadge(status: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "success") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Sucesso</Badge>;
  if (s === "needs_human") return <Badge className="bg-amber-600 hover:bg-amber-600">Humano</Badge>;
  if (s === "validation_error") return <Badge variant="destructive">Validação</Badge>;
  if (s === "error" || s === "failed") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">{status || "—"}</Badge>;
}

export default function AdminPortalMonitor() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("portal2_audit_traces")
        .select("id, customer_id, job_id, status, error, duration_ms, created_at, result, input_summary")
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (error) console.error("[portal-monitor] load error", error);
      setTraces((data as Trace[]) || []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const stats = useMemo(() => {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = traces.filter((t) => new Date(t.created_at).getTime() >= since);
    const total = recent.length;
    const ok = recent.filter((t) => t.status === "success").length;
    const human = recent.filter((t) => t.status === "needs_human").length;
    const err = recent.filter((t) => t.status === "error" || t.status === "validation_error" || t.status === "failed").length;
    const avgMs = recent.length
      ? Math.round(
          recent.reduce((acc, t) => acc + (t.duration_ms || 0), 0) / Math.max(1, recent.filter((t) => t.duration_ms).length),
        )
      : 0;
    return { total, ok, human, err, avgMs };
  }, [traces]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">Monitor do Portal iGreen</h1>
              <p className="text-sm text-muted-foreground">
                Últimos cadastros executados pelo worker. <b>Distribuidora</b> (cliente/UI) → <b>Concessionária</b> (Portal) →{" "}
                <b>Fornecedora</b> (bônus).
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Execuções (7d)</div>
            <div className="mt-1 text-2xl font-semibold">{stats.total}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Sucesso
            </div>
            <div className="mt-1 text-2xl font-semibold text-emerald-600">{stats.ok}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Humano
            </div>
            <div className="mt-1 text-2xl font-semibold text-amber-600">{stats.human}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <XCircle className="h-3.5 w-3.5 text-destructive" /> Erros
            </div>
            <div className="mt-1 text-2xl font-semibold text-destructive">{stats.err}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Tempo médio
            </div>
            <div className="mt-1 text-2xl font-semibold">{fmtMs(stats.avgMs)}</div>
          </Card>
        </div>

        <Card className="p-0">
          <div className="border-b p-4">
            <h2 className="text-base font-semibold">Últimas 100 execuções</h2>
          </div>
          <div className="divide-y">
            {loading && <div className="p-6 text-sm text-muted-foreground">Carregando…</div>}
            {!loading && traces.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">Nenhuma execução registrada ainda.</div>
            )}
            {traces.map((t) => {
              const distrib =
                t.input_summary?.distribuidora ||
                t.input_summary?.concessionaria ||
                t.result?.concessionaria ||
                "—";
              const fornecedora = t.result?.fornecedora || t.input_summary?.fornecedora || "—";
              const cidadeUf = [t.input_summary?.cidade, t.input_summary?.uf].filter(Boolean).join("/");
              return (
                <div key={t.id} className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {statusBadge(t.status)}
                      <span className="font-mono text-xs text-muted-foreground">{t.job_id || t.id.slice(0, 8)}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleString("pt-BR")}
                      </span>
                      <span className="text-xs text-muted-foreground">• {fmtMs(t.duration_ms)}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Distribuidora:</span> <b>{distrib}</b>
                      {cidadeUf && <span className="text-muted-foreground"> · {cidadeUf}</span>}
                      <span className="text-muted-foreground"> · Fornecedora:</span> <b>{fornecedora}</b>
                    </div>
                    {t.error && (
                      <div className="truncate text-xs text-destructive" title={t.error}>
                        {t.error}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
