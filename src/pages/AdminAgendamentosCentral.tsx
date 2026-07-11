import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Play, RefreshCw, Clock, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import AutomationTogglesPanel from "@/components/admin/AutomationTogglesPanel";

type Job = { jobid: number; jobname: string; schedule: string; active: boolean; command: string };
type Run = { jobid: number; jobname: string; status: string; return_message: string | null; start_time: string; end_time: string | null };

function cronHumanize(expr: string): string {
  const map: Record<string, string> = {
    "*/2 * * * *": "a cada 2 min",
    "*/3 * * * *": "a cada 3 min",
    "*/5 * * * *": "a cada 5 min",
    "*/10 * * * *": "a cada 10 min",
    "*/15 * * * *": "a cada 15 min",
    "*/30 * * * *": "a cada 30 min",
    "0 * * * *": "de hora em hora",
    "0 */3 * * *": "a cada 3h",
    "0 */6 * * *": "a cada 6h",
    "* * * * *": "a cada minuto",
  };
  return map[expr] || expr;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
}

export default function AdminAgendamentosCentral() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runs, setRuns] = useState<Map<number, Run>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-cron-status", { method: "GET" });
    if (error) {
      toast.error("Falha ao carregar agendamentos: " + error.message);
    } else {
      setJobs(data?.jobs ?? []);
      const m = new Map<number, Run>();
      (data?.runs ?? []).forEach((r: Run) => m.set(r.jobid, r));
      setRuns(m);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  async function callAction(action: string, body: Record<string, unknown>, jobName: string) {
    setBusy(jobName + ":" + action);
    const { error } = await supabase.functions.invoke("admin-cron-status", { body: { action, ...body } });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Ok");
    load();
  }

  const filtered = jobs.filter(j => !filter || j.jobname.toLowerCase().includes(filter.toLowerCase()));
  const failing = jobs.filter(j => {
    const r = runs.get(j.jobid);
    return r && r.status && r.status !== "succeeded";
  }).length;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild><Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div>
            <h1 className="text-2xl font-bold">Central de Agendamentos</h1>
            <p className="text-sm text-muted-foreground">Todas as tarefas automáticas da plataforma em um só lugar.</p>
          </div>
        </div>

        <Tabs defaultValue="automacoes" className="w-full">
          <TabsList>
            <TabsTrigger value="automacoes">Automações (ligar/desligar)</TabsTrigger>
            <TabsTrigger value="jobs">Cron jobs</TabsTrigger>
          </TabsList>

          <TabsContent value="automacoes" className="mt-4">
            <AutomationTogglesPanel />
          </TabsContent>

          <TabsContent value="jobs" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Card><CardContent className="pt-6"><div className="text-2xl font-bold">{jobs.length}</div><div className="text-xs text-muted-foreground">Total de jobs</div></CardContent></Card>
              <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-emerald-600">{jobs.filter(j => j.active).length}</div><div className="text-xs text-muted-foreground">Ativos</div></CardContent></Card>
              <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-muted-foreground">{jobs.filter(j => !j.active).length}</div><div className="text-xs text-muted-foreground">Pausados</div></CardContent></Card>
              <Card><CardContent className="pt-6"><div className={`text-2xl font-bold ${failing ? "text-destructive" : "text-emerald-600"}`}>{failing}</div><div className="text-xs text-muted-foreground">Com falha na última execução</div></CardContent></Card>
            </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Jobs agendados</CardTitle>
            <div className="flex gap-2">
              <Input placeholder="Filtrar…" value={filter} onChange={e => setFilter(e.target.value)} className="w-48 h-8" />
              <Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">Job</th>
                    <th className="text-left p-3">Frequência</th>
                    <th className="text-left p-3">Última execução</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Ativo</th>
                    <th className="text-right p-3">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(j => {
                    const r = runs.get(j.jobid);
                    const ok = r?.status === "succeeded";
                    return (
                      <tr key={j.jobid} className="border-t hover:bg-muted/30">
                        <td className="p-3 font-mono text-xs">{j.jobname}</td>
                        <td className="p-3">
                          <ScheduleEditor jobName={j.jobname} value={j.schedule} onSave={s => callAction("reschedule", { schedule: s }, j.jobname)} />
                          <div className="text-xs text-muted-foreground mt-0.5">{cronHumanize(j.schedule)}</div>
                        </td>
                        <td className="p-3"><div className="flex items-center gap-1"><Clock className="h-3 w-3 text-muted-foreground" />{timeAgo(r?.start_time ?? null)}</div></td>
                        <td className="p-3">
                          {!r ? <Badge variant="outline">nunca rodou</Badge>
                            : ok ? <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>
                            : <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />{r.status}</Badge>}
                        </td>
                        <td className="p-3">
                          <Switch checked={j.active} onCheckedChange={v => callAction("toggle", { active: v }, j.jobname)} disabled={busy === j.jobname + ":toggle"} />
                        </td>
                        <td className="p-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => callAction("run", {}, j.jobname)} disabled={busy === j.jobname + ":run"}>
                            <Play className="h-3 w-3 mr-1" />Rodar agora
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && !loading && (
                    <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhum job encontrado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Atalhos</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild><Link to="/admin/motor">Motor de Cadência</Link></Button>
                <Button variant="outline" size="sm" asChild><Link to="/admin/reaquecimento">Reaquecimento</Link></Button>
                <Button variant="outline" size="sm" asChild><Link to="/admin/voz">Voz / Velip</Link></Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ScheduleEditor({ jobName: _jn, value, onSave }: { jobName: string; value: string; onSave: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!editing) return <code className="text-xs cursor-pointer hover:underline" onClick={() => setEditing(true)}>{value}</code>;
  return (
    <div className="flex gap-1">
      <Input value={v} onChange={e => setV(e.target.value)} className="h-7 text-xs w-28 font-mono" />
      <Button size="sm" className="h-7 px-2" onClick={() => { setEditing(false); if (v !== value) onSave(v); }}>OK</Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditing(false); setV(value); }}>×</Button>
    </div>
  );
}
