import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ArrowLeft,
  Play,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CalendarClock,
  Settings2,
  BookOpen,
  FileText,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CentralAutomacoesControle } from "@/components/admin/CentralAutomacoesControle";
import { RetentionSettingsCard } from "@/components/admin/RetentionSettingsCard";
import { ColdCadenceCapCard } from "@/components/admin/ColdCadenceCapCard";
import { SistemaCapacidadesHelp } from "@/components/admin/SistemaCapacidadesHelp";
import { AgendamentosTextosDialog } from "@/components/whatsapp/AgendamentosTextosDialog";
import { cn } from "@/lib/utils";

type Job = { jobid: number; jobname: string; schedule: string; active: boolean; command: string };
type Run = {
  jobid: number;
  jobname: string;
  status: string;
  return_message: string | null;
  start_time: string;
  end_time: string | null;
};

const JOB_FRIENDLY: Record<string, { nome: string; paraQue: string }> = {
  "process-followups-tick": {
    nome: "Lembrete no dia combinado",
    paraQue: "Avisa quem pediu retorno (amanhã / segunda).",
  },
  "process-followups": {
    nome: "Lembrete no dia combinado",
    paraQue: "Avisa quem pediu retorno.",
  },
  "bot-followup-checker": {
    nome: "Lembrar quem sumiu",
    paraQue: "Cutuca leads parados há 6–48h.",
  },
  "faq-reengagement-nudge": {
    nome: "Toque pós-dúvida",
    paraQue: "Cutuca quem ficou quieto após FAQ.",
  },
  "send-scheduled-messages": {
    nome: "Mensagens agendadas",
    paraQue: "Envia o que o consultor marcou no calendário.",
  },
  "bulk-scheduler": {
    nome: "Campanha em lote",
    paraQue: "Dispara campanhas agendadas.",
  },
  "reactivation-cron-hourly": {
    nome: "Reativar leads frios",
    paraQue: "Reaquecimento automático.",
  },
  "cadence-tick-5min": {
    nome: "Sequência de etapas",
    paraQue: "Motor de cadência.",
  },
  "pos-venda-auto-progress-daily": {
    nome: "Pós-venda 30/60/90",
    paraQue: "Mensagens da carteira iGreen.",
  },
  "close-attendance-scheduled-5min": {
    nome: "Fechar atendimento agendado",
    paraQue: "Encerra atendimentos no horário marcado.",
  },
};

function friendlyJob(name: string) {
  const exact = JOB_FRIENDLY[name];
  if (exact) return exact;
  const hit = Object.entries(JOB_FRIENDLY).find(([k]) => name.includes(k) || k.includes(name));
  if (hit) return hit[1];
  return {
    nome: name.replace(/[-_]/g, " "),
    paraQue: "Tarefa automática do sistema.",
  };
}

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
    "0 8 * * *": "todo dia às 8h",
    "0 9 * * *": "todo dia às 9h",
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
  const [tab, setTab] = useState("controle");
  const [textosOpen, setTextosOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-cron-status", { method: "GET" });
    if (error) {
      toast.error("Falha ao carregar o relógio do sistema: " + error.message);
    } else {
      setJobs(data?.jobs ?? []);
      const m = new Map<number, Run>();
      (data?.runs ?? []).forEach((r: Run) => m.set(r.jobid, r));
      setRuns(m);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function callAction(action: string, body: Record<string, unknown>, jobName: string) {
    setBusy(jobName + ":" + action);
    const { error } = await supabase.functions.invoke("admin-cron-status", {
      body: { action, ...body },
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Atualizado");
    load();
  }

  const filtered = useMemo(
    () =>
      jobs.filter((j) => {
        if (!filter) return true;
        const f = friendlyJob(j.jobname);
        const blob = `${j.jobname} ${f.nome} ${f.paraQue}`.toLowerCase();
        return blob.includes(filter.toLowerCase());
      }),
    [jobs, filter],
  );

  const failing = jobs.filter((j) => {
    const r = runs.get(j.jobid);
    return r && r.status && r.status !== "succeeded";
  }).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/40 via-background to-background">
      <div className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-10 space-y-8">
        {/* Hero */}
        <header className="relative overflow-hidden rounded-3xl border bg-card/80 backdrop-blur-sm p-5 sm:p-8">
          <div className="absolute -top-24 -right-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <Button variant="ghost" size="icon" className="rounded-xl shrink-0 mt-0.5" asChild>
                <Link to="/admin" aria-label="Voltar">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0 space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Painel de controle · envios automáticos
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Central de Agendamentos
                </h1>
                <p className="text-sm sm:text-[15px] text-muted-foreground max-w-xl leading-relaxed">
                  Um lugar só para ligar, pausar e entender o que o sistema pode mandar sozinho.
                  Linguagem simples. Interruptores claros. Sem surpresa para o cliente.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0">
              {userId && (
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-xl gap-1.5"
                  onClick={() => setTextosOpen(true)}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Ajustar todos os textos
                </Button>
              )}
              <SistemaCapacidadesHelp label="Guia" />
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl gap-1.5"
                onClick={load}
                disabled={loading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Atualizar
              </Button>
            </div>
          </div>
        </header>

        {userId && (
          <AgendamentosTextosDialog
            open={textosOpen}
            onOpenChange={setTextosOpen}
            consultantId={userId}
          />
        )}

        <Tabs value={tab} onValueChange={setTab} className="w-full space-y-6">
          <TabsList className="h-auto w-full sm:w-auto flex flex-wrap justify-start gap-1 rounded-2xl border bg-muted/40 p-1.5">
            <TabsTrigger
              value="controle"
              className="rounded-xl px-4 py-2.5 data-[state=active]:shadow-sm gap-1.5"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Controle
            </TabsTrigger>
            <TabsTrigger
              value="relogio"
              className="rounded-xl px-4 py-2.5 data-[state=active]:shadow-sm gap-1.5"
            >
              <Clock className="h-3.5 w-3.5" />
              Relógio do sistema
              {failing > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">
                  {failing}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="guia"
              className="rounded-xl px-4 py-2.5 data-[state=active]:shadow-sm gap-1.5"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Guia
            </TabsTrigger>
          </TabsList>

          <TabsContent value="controle" className="mt-0 focus-visible:outline-none space-y-4">
            <RetentionSettingsCard canEdit />
            <ColdCadenceCapCard canEdit />
            <CentralAutomacoesControle canToggle />
          </TabsContent>

          <TabsContent value="guia" className="mt-0 focus-visible:outline-none">
            <CentralAutomacoesControle canToggle defaultSection="roteiro" />
          </TabsContent>

          <TabsContent value="relogio" className="mt-0 space-y-4 focus-visible:outline-none">
            <div className="rounded-2xl border bg-amber-500/5 border-amber-500/20 px-4 py-3 text-sm text-muted-foreground">
              <strong className="text-foreground">Importante:</strong> o relógio pode “acordar” e mesmo
              assim <strong className="text-foreground">não enviar</strong> se a função estiver
              desligada no Controle. Primeiro ligue no Controle; depois use esta aba só se precisar
              pausar ou forçar uma tarefa.
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Tarefas" value={jobs.length} />
              <Stat
                label="Ativas no relógio"
                value={jobs.filter((j) => j.active).length}
                tone="ok"
              />
              <Stat
                label="Pausadas"
                value={jobs.filter((j) => !j.active).length}
              />
              <Stat label="Com falha" value={failing} tone={failing ? "bad" : "ok"} />
            </div>

            <Card className="rounded-2xl overflow-hidden">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b bg-muted/20">
                <div>
                  <CardTitle className="text-base">Tarefas programadas</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Nomes em português. Detalhe técnico só se você expandir.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Buscar…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-44 h-9 rounded-xl"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={load}
                    disabled={loading}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {filtered.map((j) => {
                    const r = runs.get(j.jobid);
                    const ok = r?.status === "succeeded";
                    const f = friendlyJob(j.jobname);
                    return (
                      <div
                        key={j.jobid}
                        className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4 hover:bg-muted/20"
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-sm">{f.nome}</h3>
                            {!r ? (
                              <Badge variant="outline" className="text-[10px]">
                                nunca rodou
                              </Badge>
                            ) : ok ? (
                              <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 text-[10px]">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                OK
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">
                                <XCircle className="h-3 w-3 mr-1" />
                                {r.status}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{f.paraQue}</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-1">
                            <span>Frequência: {cronHumanize(j.schedule)}</span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Última: {timeAgo(r?.start_time ?? null)}
                            </span>
                            <details className="cursor-pointer">
                              <summary className="list-none underline-offset-2 hover:underline">
                                ID técnico
                              </summary>
                              <code className="block mt-1 text-[10px]">{j.jobname}</code>
                            </details>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {j.active ? "Ativo" : "Pausado"}
                            </span>
                            <Switch
                              checked={j.active}
                              onCheckedChange={(v) =>
                                callAction("toggle", { active: v }, j.jobname)
                              }
                              disabled={busy === j.jobname + ":toggle"}
                            />
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => callAction("run", {}, j.jobname)}
                            disabled={busy === j.jobname + ":run"}
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Rodar
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {filtered.length === 0 && !loading && (
                    <div className="p-10 text-center text-muted-foreground text-sm">
                      Nenhuma tarefa encontrada.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Atalhos
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="rounded-xl" asChild>
                  <Link to="/admin/motor">Motor de Cadência</Link>
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl" asChild>
                  <Link to="/admin/reaquecimento">Reaquecimento</Link>
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl" asChild>
                  <Link to="/admin/voz">Voz / Velip</Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "bad";
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="pt-5 pb-4">
        <div
          className={cn(
            "text-2xl font-bold tabular-nums",
            tone === "ok" && "text-emerald-600",
            tone === "bad" && "text-destructive",
          )}
        >
          {value}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}
