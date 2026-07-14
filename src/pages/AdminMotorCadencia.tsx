import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Save, Zap, ZapOff, Clock, Activity, AlertTriangle, Play, Pause, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * Painel Admin do Motor "Zero Lead Perdido" (Fase 2).
 * - Liga/desliga o motor (kill-switch global).
 * - Edita janela útil (horários por dia).
 * - Edita mensagem e atraso de cada estágio (COLD_1..COLD_4).
 * - Mostra KPI: quantos leads em cada estágio + últimas 20 ações.
 */

const STAGES = ["COLD_1", "COLD_2", "CALL_1", "SMS_1", "COLD_3", "CALL_2", "SMS_2", "COLD_4", "CALL_3"] as const;
type StageKey = (typeof STAGES)[number];

const STAGE_META: Record<StageKey, { channel: "whatsapp" | "voice" | "sms"; label: string }> = {
  COLD_1: { channel: "whatsapp", label: "WhatsApp reaquecimento 1" },
  COLD_2: { channel: "whatsapp", label: "WhatsApp reaquecimento 2" },
  CALL_1: { channel: "voice",    label: "Ligação Velip 1 (TTS ou áudio)" },
  SMS_1:  { channel: "sms",      label: "SMS de resgate 1" },
  COLD_3: { channel: "whatsapp", label: "WhatsApp reaquecimento 3" },
  CALL_2: { channel: "voice",    label: "Ligação Velip 2" },
  SMS_2:  { channel: "sms",      label: "SMS de resgate 2" },
  COLD_4: { channel: "whatsapp", label: "WhatsApp reaquecimento 4" },
  CALL_3: { channel: "voice",    label: "Ligação Velip 3 (última chance)" },
};

interface StageRow {
  id?: string;
  stage: StageKey;
  enabled: boolean;
  delay_hours: number;
  message_text: string;
  media_url: string | null;
  media_type: string | null;
  velip_audio_id: string | null;
  max_per_lead: number;
  window_start_hour: number | null;
  window_end_hour: number | null;
  window_days: number[] | null;
}


interface Window {
  weekday_start: number;
  weekday_end: number;
  saturday_start: number;
  saturday_end: number;
  sunday_enabled: boolean;
  tz: string;
}

const DEFAULT_WINDOW: Window = {
  weekday_start: 8, weekday_end: 20,
  saturday_start: 8, saturday_end: 14,
  sunday_enabled: false, tz: "America/Sao_Paulo",
};

export default function AdminMotorCadencia() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [window, setWindow] = useState<Window>(DEFAULT_WINDOW);
  const [stages, setStages] = useState<Record<StageKey, StageRow>>({} as any);
  const [stats, setStats] = useState<{ stage: string; count: number }[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [dueLeads, setDueLeads] = useState<any[]>([]);
  const [slaCount, setSlaCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [metrics, setMetrics] = useState<Array<{ stage: string; channel: string; sent: number; failed: number; unique_leads: number; responded_leads: number }>>([]);


  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    const t2 = setInterval(() => void loadDue(), 30000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: settings }, { data: cfgs }, { data: leadStats }, { data: recentLogs }] = await Promise.all([
      supabase.from("app_settings").select("cadence_engine_enabled, cadence_window").eq("id", "global").maybeSingle(),
      supabase.from("cadence_stage_config").select("*").is("consultant_id", null).in("stage", STAGES as unknown as string[]),
      supabase.from("lead_cadence_state").select("stage").limit(5000),
      supabase.from("cadence_action_log").select("stage, channel, status, detail, created_at").order("created_at", { ascending: false }).limit(20),
    ]);

    setEnabled(!!settings?.cadence_engine_enabled);
    setWindow({ ...DEFAULT_WINDOW, ...((settings?.cadence_window as any) || {}) });

    const map = {} as Record<StageKey, StageRow>;
    for (const s of STAGES) {
      const found = (cfgs || []).find((c: any) => c.stage === s);
      map[s] = found
        ? {
            ...found, stage: s,
            message_text: found.message_text || "",
            max_per_lead: (found as any).max_per_lead ?? 0,
            window_start_hour: (found as any).window_start_hour ?? null,
            window_end_hour: (found as any).window_end_hour ?? null,
            window_days: (found as any).window_days ?? null,
          }
        : {
            stage: s, enabled: true, delay_hours: 24, message_text: "",
            media_url: null, media_type: "text", velip_audio_id: null,
            max_per_lead: 0, window_start_hour: null, window_end_hour: null, window_days: null,
          };
    }

    setStages(map);

    const grouped: Record<string, number> = {};
    for (const r of leadStats || []) grouped[r.stage] = (grouped[r.stage] || 0) + 1;
    setStats(Object.entries(grouped).map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count));

    setLogs(recentLogs || []);
    await loadDue();
    await loadMetrics();
    setLoading(false);
  }

  async function loadMetrics() {
    const { data } = await (supabase as any)
      .from("cadence_metrics_daily")
      .select("stage, channel, sent, failed, unique_leads, responded_leads")
      .order("day", { ascending: false })
      .limit(200);
    // Agrega últimos 7 dias por stage+channel
    const agg = new Map<string, any>();
    for (const r of (data || [])) {
      const k = `${r.stage}|${r.channel}`;
      const prev = agg.get(k) || { stage: r.stage, channel: r.channel, sent: 0, failed: 0, unique_leads: 0, responded_leads: 0 };
      prev.sent += r.sent || 0; prev.failed += r.failed || 0;
      prev.unique_leads += r.unique_leads || 0; prev.responded_leads += r.responded_leads || 0;
      agg.set(k, prev);
    }
    setMetrics(Array.from(agg.values()).sort((a,b) => b.sent - a.sent));
  }


  async function loadDue() {
    const soon = new Date(Date.now() + 60 * 60_000).toISOString(); // próxima 1h
    const { data } = await supabase
      .from("lead_cadence_state")
      .select("id, stage, next_action_at, customer_id, consultant_id, paused_until, customers:customer_id(name, phone_whatsapp), consultants:consultant_id(name)")
      .lte("next_action_at", soon)
      .not("stage", "in", "(WON,PAUSED,RETARGET_META)")
      .order("next_action_at", { ascending: true })
      .limit(50);
    const list = data || [];
    setDueLeads(list);
    const nowMs = Date.now();
    setSlaCount(list.filter((l: any) => l.next_action_at && new Date(l.next_action_at).getTime() < nowMs - 30 * 60_000).length);
  }

  async function forceNow(id: string) {
    const { error } = await supabase.from("lead_cadence_state").update({ next_action_at: new Date().toISOString(), paused_until: null, paused_reason: null }).eq("id", id);
    if (error) { toast.error("Falha ao forçar"); return; }
    toast.success("Próxima ação agendada agora");
    await loadDue();
  }

  async function pause24h(id: string) {
    const until = new Date(Date.now() + 24 * 3600_000).toISOString();
    const { error } = await supabase.from("lead_cadence_state").update({ paused_until: until, paused_reason: "manual_admin", next_action_at: until }).eq("id", id);
    if (error) { toast.error("Falha ao pausar"); return; }
    toast.success("Pausado por 24h");
    await loadDue();
  }

  async function runTickNow() {
    setTicking(true);
    try {
      const { error } = await supabase.functions.invoke("cadence-tick", { body: { manual: true } });
      if (error) throw error;
      toast.success("Tick executado");
      await loadDue();
    } catch (e: any) {
      toast.error("Falha no tick: " + (e?.message || e));
    } finally {
      setTicking(false);
    }
  }

  async function toggleEngine(v: boolean) {
    setEnabled(v);
    const { error } = await supabase.from("app_settings").update({ cadence_engine_enabled: v }).eq("id", "global");
    if (error) { toast.error("Falha ao alternar motor"); setEnabled(!v); return; }
    toast.success(v ? "Motor ligado" : "Motor pausado");
  }

  async function saveAll() {
    setSaving(true);
    try {
      const { error: e1 } = await supabase.from("app_settings").update({ cadence_window: window as any }).eq("id", "global");
      if (e1) throw e1;

      for (const s of STAGES) {
        const row = stages[s];
        const payload = {
          consultant_id: null,
          stage: s,
          enabled: row.enabled,
          delay_hours: row.delay_hours,
          message_text: row.message_text,
          media_url: row.media_url,
          media_type: row.media_type || "text",
          velip_audio_id: row.velip_audio_id,
          max_per_lead: row.max_per_lead || 0,
          window_start_hour: row.window_start_hour,
          window_end_hour: row.window_end_hour,
          window_days: row.window_days,
        } as any;

        if (row.id) {
          const { error } = await supabase.from("cadence_stage_config").update(payload).eq("id", row.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("cadence_stage_config").insert(payload);
          if (error) throw error;
        }
      }
      toast.success("Configuração salva");
      await load();
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <h1 className="text-base font-semibold flex items-center gap-2">
              {enabled ? <Zap className="h-4 w-4 text-green-500" /> : <ZapOff className="h-4 w-4 text-muted-foreground" />}
              Motor "Zero Lead Perdido"
            </h1>
            <p className="text-xs text-muted-foreground">Cadência automática multi-canal — WhatsApp, ligação, SMS e Meta.</p>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">{enabled ? "Ligado" : "Desligado"}</Label>
            <Switch checked={enabled} onCheckedChange={toggleEngine} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* KPIs */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-3"><Activity className="h-4 w-4" /> Leads no motor</h2>
          <div className="flex flex-wrap gap-2">
            {stats.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum lead no motor ainda.</p> :
              stats.map(s => (
                <Badge key={s.stage} variant="outline" className="gap-1">
                  <span className="font-semibold">{s.count}</span> {s.stage}
                </Badge>
              ))}
          </div>
        </Card>

        {/* Command Center — SLA tempo real */}
        <Card className="p-4 border-l-4" style={{ borderLeftColor: slaCount > 0 ? "hsl(var(--destructive))" : "hsl(var(--primary))" }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              {slaCount > 0 ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <Activity className="h-4 w-4 text-primary" />}
              Central de comando — próximas ações
              {slaCount > 0 && <Badge variant="destructive" className="ml-1">{slaCount} SLA violado</Badge>}
            </h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => loadDue()}><RefreshCw className="h-3 w-3 mr-1" /> Atualizar</Button>
              <Button size="sm" onClick={runTickNow} disabled={ticking}>
                {ticking ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Executar tick agora
              </Button>
            </div>
          </div>
          {dueLeads.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma ação pendente na próxima 1h.</p>
          ) : (
            <div className="space-y-1 text-xs max-h-96 overflow-auto">
              {dueLeads.map((l: any) => {
                const nextMs = l.next_action_at ? new Date(l.next_action_at).getTime() : 0;
                const diffMin = Math.round((nextMs - now) / 60000);
                const overdue = diffMin < -30;
                const due = diffMin <= 0;
                return (
                  <div key={l.id} className={`flex items-center gap-2 border-b py-2 ${overdue ? "bg-destructive/5" : ""}`}>
                    <Badge variant={overdue ? "destructive" : due ? "default" : "outline"} className="min-w-20 justify-center">
                      {overdue ? `${Math.abs(diffMin)}m atrasado` : due ? "agora" : `em ${diffMin}m`}
                    </Badge>
                    <Badge variant="secondary">{l.stage}</Badge>
                    <span className="flex-1 truncate">
                      <b>{l.customers?.name || "sem nome"}</b>
                      <span className="text-muted-foreground"> · {l.customers?.phone_whatsapp || "-"}</span>
                      <span className="text-muted-foreground"> · {l.consultants?.name || "-"}</span>
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => forceNow(l.id)} title="Forçar próxima ação agora">
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => pause24h(l.id)} title="Pausar 24h">
                      <Pause className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Janela útil */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-3"><Clock className="h-4 w-4" /> Janela de disparo</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><Label className="text-xs">Seg-Sex início</Label><Input type="number" min={0} max={23} value={window.weekday_start} onChange={e => setWindow({ ...window, weekday_start: +e.target.value })} /></div>
            <div><Label className="text-xs">Seg-Sex fim</Label><Input type="number" min={0} max={23} value={window.weekday_end} onChange={e => setWindow({ ...window, weekday_end: +e.target.value })} /></div>
            <div><Label className="text-xs">Sábado início</Label><Input type="number" min={0} max={23} value={window.saturday_start} onChange={e => setWindow({ ...window, saturday_start: +e.target.value })} /></div>
            <div><Label className="text-xs">Sábado fim</Label><Input type="number" min={0} max={23} value={window.saturday_end} onChange={e => setWindow({ ...window, saturday_end: +e.target.value })} /></div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Switch checked={window.sunday_enabled} onCheckedChange={v => setWindow({ ...window, sunday_enabled: v })} />
            <Label className="text-xs">Disparar aos domingos</Label>
          </div>
        </Card>

        {/* Estágios */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Cadência multi-canal (WhatsApp → Ligação → SMS)</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Variáveis: <code className="text-primary">{"{{nome}}"}</code>, <code className="text-primary">{"{{consultor}}"}</code>, <code className="text-primary">{"{{consultor_phone}}"}</code>.
            Ligações usam TTS por padrão; informe um <b>Velip audio_id</b> para tocar um áudio pré-gravado do consultor.
          </p>
          <div className="space-y-4">
            {STAGES.map(s => {
              const row = stages[s]; if (!row) return null;
              const meta = STAGE_META[s];
              const channelColor = meta.channel === "voice" ? "bg-blue-500/10 text-blue-600"
                : meta.channel === "sms" ? "bg-amber-500/10 text-amber-600"
                : "bg-green-500/10 text-green-600";
              return (
                <div key={s} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Badge>{s}</Badge>
                      <span className={`text-xs px-2 py-0.5 rounded ${channelColor}`}>{meta.label}</span>
                      <Switch checked={row.enabled} onCheckedChange={v => setStages({ ...stages, [s]: { ...row, enabled: v } })} />
                      <Label className="text-xs">{row.enabled ? "Ativo" : "Pausado"}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Disparar após</Label>
                      <Input type="number" min={1} max={720} className="w-20 h-8" value={row.delay_hours}
                        onChange={e => setStages({ ...stages, [s]: { ...row, delay_hours: +e.target.value } })} />
                      <span className="text-xs text-muted-foreground">horas</span>
                    </div>
                  </div>
                  <Textarea rows={3}
                    placeholder={meta.channel === "voice" ? "Texto que a locutora vai falar (TTS)..." : meta.channel === "sms" ? "Texto do SMS (até 160 caracteres)..." : "Texto da mensagem..."}
                    value={row.message_text}
                    onChange={e => setStages({ ...stages, [s]: { ...row, message_text: e.target.value } })} />

                  {meta.channel === "whatsapp" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="URL de mídia opcional (áudio/imagem/vídeo)" value={row.media_url || ""}
                        onChange={e => setStages({ ...stages, [s]: { ...row, media_url: e.target.value || null } })} />
                      <select className="h-10 rounded-md border bg-background px-3 text-sm"
                        value={row.media_type || "text"}
                        onChange={e => setStages({ ...stages, [s]: { ...row, media_type: e.target.value } })}>
                        <option value="text">Somente texto</option>
                        <option value="audio">Áudio</option>
                        <option value="image">Imagem</option>
                        <option value="video">Vídeo</option>
                      </select>
                    </div>
                  )}

                  {meta.channel === "voice" && (
                    <Input placeholder="Velip audio_id (opcional — se vazio usa TTS acima)" value={row.velip_audio_id || ""}
                      onChange={e => setStages({ ...stages, [s]: { ...row, velip_audio_id: e.target.value || null } })} />
                  )}

                  {/* Limites e janela específicos do estágio */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Máx. envios/lead (0 = ilimitado)</Label>
                      <Input type="number" min={0} max={20} className="h-8"
                        value={row.max_per_lead}
                        onChange={e => setStages({ ...stages, [s]: { ...row, max_per_lead: +e.target.value } })} />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Janela início (h, vazio=global)</Label>
                      <Input type="number" min={0} max={23} className="h-8"
                        value={row.window_start_hour ?? ""}
                        onChange={e => setStages({ ...stages, [s]: { ...row, window_start_hour: e.target.value === "" ? null : +e.target.value } })} />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Janela fim (h)</Label>
                      <Input type="number" min={0} max={23} className="h-8"
                        value={row.window_end_hour ?? ""}
                        onChange={e => setStages({ ...stages, [s]: { ...row, window_end_hour: e.target.value === "" ? null : +e.target.value } })} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>


          <div className="mt-4 flex justify-end">
            <Button onClick={saveAll} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Salvar configurações
            </Button>
          </div>
        </Card>

        {/* Métricas 7 dias */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">📊 Métricas dos últimos 7 dias</h2>
          {metrics.length === 0 ? <p className="text-xs text-muted-foreground">Sem dados ainda.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-1">Estágio</th>
                    <th className="text-left">Canal</th>
                    <th className="text-right">Enviados</th>
                    <th className="text-right">Falhas</th>
                    <th className="text-right">Leads únicos</th>
                    <th className="text-right">Respondidos</th>
                    <th className="text-right">Taxa resp.</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m, i) => {
                    const rate = m.unique_leads > 0 ? Math.round((m.responded_leads / m.unique_leads) * 100) : 0;
                    return (
                      <tr key={i} className="border-b">
                        <td className="py-1"><Badge variant="outline">{m.stage}</Badge></td>
                        <td><Badge variant="secondary">{m.channel}</Badge></td>
                        <td className="text-right font-mono">{m.sent}</td>
                        <td className="text-right font-mono text-destructive">{m.failed}</td>
                        <td className="text-right font-mono">{m.unique_leads}</td>
                        <td className="text-right font-mono text-emerald-600">{m.responded_leads}</td>
                        <td className="text-right font-mono">{rate}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Últimas ações */}

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Últimas 20 ações</h2>
          {logs.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma ação registrada ainda.</p> : (
            <div className="space-y-1 text-xs">
              {logs.map((l, i) => (
                <div key={i} className="flex items-center gap-2 border-b py-1">
                  <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")}</span>
                  <Badge variant="outline">{l.stage}</Badge>
                  <Badge variant="secondary">{l.channel}</Badge>
                  <Badge variant={l.status === "sent" ? "default" : l.status === "failed" ? "destructive" : "outline"}>{l.status}</Badge>
                  <span className="text-muted-foreground truncate">{JSON.stringify(l.detail)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
