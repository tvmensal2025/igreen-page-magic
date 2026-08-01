import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { Loader2, PlayCircle, RefreshCw, RotateCw } from "lucide-react";

type Progress = { kind: string; status: string; count: number };
type Route = {
  id: string;
  route: string;
  final_path: string | null;
  kind: string | null;
  title: string | null;
  ai_summary: string | null;
  ai_fields: any;
  new_endpoints: any;
  elapsed_ms: number | null;
  error: string | null;
  created_at: string;
};

export default function AdminReconIgreen() {
  const [progress, setProgress] = useState<Progress[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const [p, r] = await Promise.all([
      supabase.from("igreen_recon_queue_progress").select("*"),
      supabase
        .from("igreen_recon_routes")
        .select("id, route, final_path, kind, title, ai_summary, ai_fields, new_endpoints, elapsed_ms, error, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (p.data) setProgress(p.data as any);
    if (r.data) setRoutes(r.data as any);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      const { data, error } = await supabase.functions.invoke("recon-igreen-seed", {
        body: { months_back: 24, reset_errors: true },
      });
      if (error) throw error;
      toast.success(`${data.inserted} jobs novos enfileirados`);
      load();
    } catch (e: any) {
      toast.error(e.message || "Falhou");
    } finally {
      setSeeding(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("recon-igreen-worker", {
        body: { trigger: "manual" },
      });
      if (error) throw error;
      toast.success(`Processou ${data.processed} jobs em ${data.elapsed_ms}ms`);
      load();
    } catch (e: any) {
      toast.error(e.message || "Falhou");
    } finally {
      setRunning(false);
    }
  };

  const totals = progress.reduce(
    (acc, p) => {
      acc.total += p.count;
      acc[p.status] = (acc[p.status] || 0) + p.count;
      return acc;
    },
    { total: 0, pending: 0, running: 0, done: 0, error: 0 } as Record<string, number>,
  );
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">Recon iGreen</h1>
          <p className="text-sm text-muted-foreground">
            Mapeamento automático de todos os endpoints e telas do portal iGreen (rafael.ids@icloud.com).
            Cron roda a cada 30s.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={seed} disabled={seeding} variant="outline">
            {seeding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCw className="w-4 h-4 mr-2" />}
            Enfileirar tudo
          </Button>
          <Button onClick={runNow} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
            Processar agora
          </Button>
          <Button onClick={load} variant="ghost" size="icon"><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <StatCard label="Total" value={totals.total} />
        <StatCard label="Pending" value={totals.pending} tone="yellow" />
        <StatCard label="Running" value={totals.running} tone="blue" />
        <StatCard label="Done" value={totals.done} tone="green" />
        <StatCard label="Error" value={totals.error} tone="red" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Progresso ({pct}%)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {progress.map((p, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {p.kind}/{p.status}: {p.count}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Últimas capturas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {routes.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma captura ainda. Clique em "Enfileirar tudo" e aguarde.</p>
          )}
          {routes.map((r) => (
            <div key={r.id} className="border rounded-md p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-xs">{r.kind || "?"}</Badge>
                <code className="text-xs">{r.route}</code>
                {r.elapsed_ms && <span className="text-xs text-muted-foreground">{r.elapsed_ms}ms</span>}
                {r.error && <Badge variant="destructive" className="text-xs">erro</Badge>}
              </div>
              {r.title && <div className="font-medium">{r.title}</div>}
              {r.ai_summary && <p className="text-xs text-muted-foreground mt-1">{r.ai_summary}</p>}
              {Array.isArray(r.new_endpoints) && r.new_endpoints.length > 0 && (
                <div className="mt-2 text-xs">
                  <span className="text-muted-foreground">Endpoints:</span>{" "}
                  {r.new_endpoints.slice(0, 5).map((e: any, i: number) => (
                    <code key={i} className="inline-block mr-2 px-1.5 py-0.5 bg-muted rounded">
                      {e.method || "GET"} {e.path_template}
                    </code>
                  ))}
                  {r.new_endpoints.length > 5 && <span>… +{r.new_endpoints.length - 5}</span>}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const toneClass =
    tone === "green" ? "text-green-600" :
    tone === "red" ? "text-red-600" :
    tone === "yellow" ? "text-yellow-600" :
    tone === "blue" ? "text-blue-600" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
