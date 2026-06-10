import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Loader2, Play, Pause, AlertTriangle, RotateCcw, CheckCircle2 } from "lucide-react";

type Flag = "off" | "dark" | "canary" | "on";

interface Cfg {
  autopilot_enabled: boolean;
  alert_consultant_id: string | null;
  canary_percent: number;
  dark_min_hours: number;
  canary_min_hours: number;
  green_max_paused_ratio: number;
  green_max_delegated_ratio: number;
  green_min_turns_24h: number;
}

interface Row {
  id: string;
  name: string;
  flow_engine_v3: Flag;
  turns_24h: number;
  paused_total: number;
  delegated_total: number;
}

interface Audit {
  id: string;
  consultant_id: string;
  from_state: string | null;
  to_state: string;
  reason: string | null;
  created_at: string;
}

interface Alert {
  id: string;
  consultant_id: string | null;
  level: string;
  title: string;
  body: string;
  acknowledged: boolean;
  created_at: string;
}

// Prontidão de avanço do Cérebro IA por estágio (somente leitura).
// Vem da view cerebro_prontidao_avanco, que cruza a taxa de coincidência
// com os limites configurados em rollout_config.
interface Prontidao {
  estagio: string;
  total_turnos: number;
  taxa_coincidencia_pct: number | null;
  limite_coincidencia_pct: number;
  turnos_minimos: number;
  turnos_faltantes: number;
  apto_avancar: boolean;
  motivo: string;
}

// Monitoramento do canário do Cérebro IA por consultor (somente leitura).
// Vem da view cerebro_monitor_canario: junta coincidência + conversão + volume.
interface MonitorCanario {
  estagio: string;
  consultant_id: string;
  consultant_name: string;
  coincidencia_turnos: number;
  coincidencia_pct: number | null;
  limite_coincidencia_pct: number;
  clientes_total: number;
  convertidos_total: number;
  convertidos_7d: number;
  taxa_conversao_pct: number | null;
  turnos_24h: number;
  delegados_total: number;
  coincidencia_abaixo_limite: boolean;
}

// Sinal (somente leitura) de queda de coincidência abaixo do limite.
// Vem da view cerebro_sinal_alerta_coincidencia.
interface SinalAlerta {
  estagio: string;
  total_turnos: number;
  taxa_coincidencia_pct: number | null;
  limite_coincidencia_pct: number;
  turnos_minimos: number;
  alerta_queda_coincidencia: boolean;
  mensagem: string;
}

const FLAG_STYLE: Record<Flag, string> = {
  off: "bg-muted text-muted-foreground",
  dark: "bg-slate-500/15 text-slate-400",
  canary: "bg-warning/15 text-warning",
  on: "bg-primary/15 text-primary",
};

export function RolloutPanel() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [prontidao, setProntidao] = useState<Prontidao[]>([]);
  const [monitor, setMonitor] = useState<MonitorCanario[]>([]);
  const [sinais, setSinais] = useState<SinalAlerta[]>([]);

  const load = async () => {
    setLoading(true);
    const [c, h, cs, a, al, pr, mc, sa] = await Promise.all([
      supabase.from("rollout_config").select("*").eq("id", true).maybeSingle(),
      supabase.from("v_flow_engine_health").select("consultant_id, turns_24h, paused_total, delegated_total"),
      supabase.from("consultants").select("id, name, flow_engine_v3").eq("approved", true).order("name"),
      supabase.from("rollout_audit").select("*").order("created_at", { ascending: false }).limit(30),
      supabase.from("rollout_alerts").select("*").eq("acknowledged", false).order("created_at", { ascending: false }).limit(20),
      supabase.from("cerebro_prontidao_avanco").select("*"),
      supabase.from("cerebro_monitor_canario").select("*"),
      supabase.from("cerebro_sinal_alerta_coincidencia").select("*"),
    ]);
    setCfg(c.data as Cfg | null);
    setProntidao((pr.data ?? []) as Prontidao[]);
    setMonitor((mc.data ?? []) as MonitorCanario[]);
    setSinais((sa.data ?? []) as SinalAlerta[]);
    const hMap = new Map((h.data ?? []).map((r: any) => [r.consultant_id, r]));
    setRows(
      (cs.data ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        flow_engine_v3: (c.flow_engine_v3 ?? "off") as Flag,
        turns_24h: hMap.get(c.id)?.turns_24h ?? 0,
        paused_total: hMap.get(c.id)?.paused_total ?? 0,
        delegated_total: hMap.get(c.id)?.delegated_total ?? 0,
      })),
    );
    setAudits((a.data ?? []) as Audit[]);
    setAlerts((al.data ?? []) as Alert[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleAutopilot = async (enabled: boolean) => {
    const { error } = await supabase.from("rollout_config").update({ autopilot_enabled: enabled }).eq("id", true);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    setCfg((c) => (c ? { ...c, autopilot_enabled: enabled } : c));
    toast({ title: enabled ? "Autopilot ligado" : "Autopilot pausado" });
  };

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("flow-engine-rollout-cron", { body: { source: "manual" } });
    setRunning(false);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Tick executado", description: `${(data as any)?.decisions?.length ?? 0} transição(ões)` });
    load();
  };

  const forceRollback = async () => {
    const ok = await confirm({ title: "Voltar TODOS os consultores para desligado?", description: "Isso desliga a automação de atendimento para todos.", confirmText: "Confirmar", tone: "danger" });
    if (!ok) return;
    const { error } = await supabase.from("consultants").update({ flow_engine_v3: "off", flow_reliability_v2: "off" }).eq("approved", true);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    await supabase.from("rollout_audit").insert(
      rows.filter((r) => r.flow_engine_v3 !== "off").map((r) => ({
        consultant_id: r.id,
        flag_kind: "flow_engine_v3",
        from_state: r.flow_engine_v3,
        to_state: "off",
        reason: "manual_global_rollback",
      })),
    );
    toast({ title: "Rollback global aplicado" });
    load();
  };

  const ackAlert = async (id: string) => {
    await supabase.from("rollout_alerts").update({ acknowledged: true }).eq("id", id);
    setAlerts((a) => a.filter((x) => x.id !== id));
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      {/* Controle do autopilot */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold">Automação de atendimento</h2>
            <p className="text-sm text-muted-foreground">
              Avalia gates a cada 6h e avança/recua flags por consultor automaticamente.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{cfg?.autopilot_enabled ? "Ligado" : "Pausado"}</span>
            <Switch checked={!!cfg?.autopilot_enabled} onCheckedChange={toggleAutopilot} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runNow} disabled={running} size="sm">
            {running ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
            Rodar agora
          </Button>
          <Button onClick={forceRollback} variant="destructive" size="sm">
            <RotateCcw className="w-4 h-4 mr-2" /> Rollback global
          </Button>
        </div>
        {cfg && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Pill label="Canary %" value={`${cfg.canary_percent}%`} />
            <Pill label="Dark mín." value={`${cfg.dark_min_hours}h`} />
            <Pill label="Canary mín." value={`${cfg.canary_min_hours}h`} />
            <Pill label="Mín. turnos/24h" value={cfg.green_min_turns_24h} />
            <Pill label="Máx. pausados" value={`${(cfg.green_max_paused_ratio * 100).toFixed(0)}%`} />
            <Pill label="Máx. delegados" value={`${(cfg.green_max_delegated_ratio * 100).toFixed(0)}%`} />
          </div>
        )}
      </Card>

      {/* Alertas abertos */}
      {alerts.length > 0 && (
        <Card className="p-5 space-y-3 border-warning/30">
          <h3 className="font-semibold flex items-center gap-2 text-warning">
            <AlertTriangle className="w-4 h-4" /> Alertas abertos ({alerts.length})
          </h3>
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-warning/5 border border-warning/20">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{a.title}</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{a.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{new Date(a.created_at).toLocaleString("pt-BR")}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => ackAlert(a.id)}>
                  <CheckCircle2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Sinal de queda de coincidência do Cérebro (somente leitura) */}
      {sinais.some((s) => s.alerta_queda_coincidencia) && (
        <Card className="p-5 space-y-3 border-warning/30">
          <h3 className="font-semibold flex items-center gap-2 text-warning">
            <AlertTriangle className="w-4 h-4" /> Cérebro IA — queda de coincidência
          </h3>
          <div className="space-y-2">
            {sinais
              .filter((s) => s.alerta_queda_coincidencia)
              .map((s) => (
                <div key={s.estagio} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-warning/5 border border-warning/20">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      Estágio {s.estagio}: {s.taxa_coincidencia_pct ?? "—"}% (limite {s.limite_coincidencia_pct}%)
                    </p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{s.mensagem}</p>
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Prontidão de avanço do Cérebro IA (somente leitura) */}
      <Card className="p-5 space-y-3">
        <div>
          <h3 className="font-semibold">Cérebro IA — prontidão de avanço</h3>
          <p className="text-sm text-muted-foreground">
            Taxa de coincidência das decisões do Cérebro por estágio. Um estágio fica apto a
            avançar quando a taxa atinge o limite e há turnos suficientes observados.
          </p>
        </div>
        {prontidao.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda não há decisões do Cérebro registradas para medir a coincidência.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2 px-2">Estágio</th>
                  <th className="text-right py-2 px-2">Coincidência</th>
                  <th className="text-right py-2 px-2">Limite</th>
                  <th className="text-right py-2 px-2">Turnos</th>
                  <th className="text-right py-2 px-2">Mínimo</th>
                  <th className="text-left py-2 px-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {prontidao.map((p) => (
                  <tr key={p.estagio} className="border-b border-border/30">
                    <td className="py-2 px-2">
                      <Badge className={`${FLAG_STYLE[(p.estagio as Flag)] ?? "bg-muted text-muted-foreground"} border-0`}>
                        {p.estagio}
                      </Badge>
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums">
                      {p.taxa_coincidencia_pct != null ? `${p.taxa_coincidencia_pct}%` : "—"}
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums">{p.limite_coincidencia_pct}%</td>
                    <td className="text-right py-2 px-2 tabular-nums">{p.total_turnos}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{p.turnos_minimos}</td>
                    <td className="py-2 px-2">
                      {p.apto_avancar ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <CheckCircle2 className="w-4 h-4" /> Apto a avançar
                        </span>
                      ) : (
                        <span className="text-muted-foreground" title={p.motivo}>Ainda não</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Monitoramento do canário do Cérebro IA (somente leitura) */}
      <Card className="p-5 space-y-3">
        <div>
          <h3 className="font-semibold">Cérebro IA — monitoramento do canário</h3>
          <p className="text-sm text-muted-foreground">
            Por consultor em rollout (dark/canary/on): coincidência das decisões, conversão
            de cadastros e volume de atendimento. Quem está fora do rollout segue na vendedora.
          </p>
        </div>
        {monitor.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum consultor em rollout do Cérebro ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="text-left py-2 px-2">Consultor</th>
                  <th className="text-left py-2 px-2">Estágio</th>
                  <th className="text-right py-2 px-2">Coincidência</th>
                  <th className="text-right py-2 px-2">Conversão</th>
                  <th className="text-right py-2 px-2">Convertidos (7d)</th>
                  <th className="text-right py-2 px-2">Turnos 24h</th>
                </tr>
              </thead>
              <tbody>
                {monitor.map((m) => (
                  <tr key={m.consultant_id} className="border-b border-border/30">
                    <td className="py-2 px-2">{m.consultant_name}</td>
                    <td className="py-2 px-2">
                      <Badge className={`${FLAG_STYLE[(m.estagio as Flag)] ?? "bg-muted text-muted-foreground"} border-0`}>
                        {m.estagio}
                      </Badge>
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums">
                      {m.coincidencia_pct != null ? (
                        <span className={m.coincidencia_abaixo_limite ? "text-warning" : undefined}>
                          {m.coincidencia_pct}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums">
                      {m.taxa_conversao_pct != null ? `${m.taxa_conversao_pct}%` : "—"}
                    </td>
                    <td className="text-right py-2 px-2 tabular-nums">{m.convertidos_7d}</td>
                    <td className="text-right py-2 px-2 tabular-nums">{m.turnos_24h}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Consultores */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Consultores ({rows.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border/50">
              <tr>
                <th className="text-left py-2 px-2">Consultor</th>
                <th className="text-left py-2 px-2">Flag V3</th>
                <th className="text-right py-2 px-2">Turnos 24h</th>
                <th className="text-right py-2 px-2">Pausados</th>
                <th className="text-right py-2 px-2">Delegados</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/30">
                  <td className="py-2 px-2">{r.name}</td>
                  <td className="py-2 px-2">
                    <Badge className={`${FLAG_STYLE[r.flow_engine_v3]} border-0`}>{r.flow_engine_v3}</Badge>
                  </td>
                  <td className="text-right py-2 px-2 tabular-nums">{r.turns_24h}</td>
                  <td className="text-right py-2 px-2 tabular-nums">{r.paused_total}</td>
                  <td className="text-right py-2 px-2 tabular-nums">{r.delegated_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Audit log */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Últimas transições</h3>
        {audits.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma transição registrada ainda.</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            {audits.map((a) => {
              const consultant = rows.find((r) => r.id === a.consultant_id);
              return (
                <div key={a.id} className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0">
                  <span className="text-muted-foreground tabular-nums w-32 shrink-0">{new Date(a.created_at).toLocaleString("pt-BR")}</span>
                  <span className="font-medium w-40 truncate">{consultant?.name ?? "—"}</span>
                  <Badge variant="outline" className="text-[10px]">{a.from_state ?? "?"} → {a.to_state}</Badge>
                  <span className="text-muted-foreground truncate flex-1">{a.reason}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
