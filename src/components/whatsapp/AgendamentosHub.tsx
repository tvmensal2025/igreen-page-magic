import { useState, lazy, Suspense } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAgendamentosHub } from "@/hooks/useAgendamentosHub";
import {
  dispatchAgendamentosNav,
  type AgendamentosHubTab,
  type AgendamentoTimelineItem,
} from "@/lib/agendamentosHub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar, Clock, Trash2, Plus, Send, CalendarClock, MessageSquare, Phone,
  CheckCircle2, XCircle, Loader2, AlertCircle, Sparkles, RefreshCw, Settings2,
  Flame, Megaphone, Bot, History, LayoutGrid, ExternalLink, Info,
} from "lucide-react";

const AutoMessageLog = lazy(() => import("./AutoMessageLog").then((m) => ({ default: m.AutoMessageLog })));

function formatScheduleDate(dateStr: string | Date) {
  try {
    const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    return format(d, "dd MMM yyyy 'às' HH:mm", { locale: ptBR });
  } catch {
    return String(dateStr);
  }
}

function timelineStatusBadge(status: AgendamentoTimelineItem["status"]) {
  switch (status) {
    case "overdue":
      return <Badge variant="outline" className="text-[9px] border-warning/40 text-warning">Pronto / atrasado</Badge>;
    case "running":
      return <Badge variant="outline" className="text-[9px] border-primary/40 text-primary">Em andamento</Badge>;
    case "failed":
      return <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive">Falhou</Badge>;
    default:
      return <Badge variant="outline" className="text-[9px] border-muted-foreground/30 text-muted-foreground">Agendado</Badge>;
  }
}

function kindIcon(kind: AgendamentoTimelineItem["kind"]) {
  switch (kind) {
    case "pos_venda_auto": return <Sparkles className="w-3.5 h-3.5 text-accent" />;
    case "bot_followup": return <Bot className="w-3.5 h-3.5 text-info" />;
    case "bulk_campaign": return <Megaphone className="w-3.5 h-3.5 text-warning" />;
    default: return <Clock className="w-3.5 h-3.5 text-primary" />;
  }
}

interface AgendamentosHubProps {
  consultantId: string;
  instanceName: string;
  defaultTab?: AgendamentosHubTab;
  /** Quando true, mostra atalho para abrir como aba principal do Admin */
  showAdminShortcut?: boolean;
}

export function AgendamentosHub({
  consultantId,
  instanceName,
  defaultTab = "overview",
  showAdminShortcut = false,
}: AgendamentosHubProps) {
  const [activeTab, setActiveTab] = useState<AgendamentosHubTab>(defaultTab);
  const [showForm, setShowForm] = useState(false);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const {
    loading,
    refresh,
    manual,
    posVenda,
    botFollowups,
    bulkCampaigns,
    reactivationSettings,
    autoReactivateTemplates,
    timeline,
    stats,
  } = useAgendamentosHub(consultantId);

  const handleCreateManual = async () => {
    if (!phone.trim() || !text.trim() || !scheduledAt) return;
    if (!instanceName) {
      toast({ title: "Conecte o WhatsApp para agendar envios manuais", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const remoteJid = phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
      const { error } = await supabase.from("scheduled_messages").insert({
        consultant_id: consultantId,
        instance_name: instanceName,
        remote_jid: remoteJid,
        message_text: text,
        scheduled_at: new Date(scheduledAt).toISOString(),
      });
      if (error) throw error;
      toast({ title: "Mensagem agendada com sucesso!" });
      setPhone("");
      setText("");
      setScheduledAt("");
      setShowForm(false);
      refresh();
    } catch {
      toast({ title: "Erro ao agendar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteManual = async (id: string) => {
    await supabase.from("scheduled_messages").delete().eq("id", id);
    refresh();
  };

  const statusConfig = (status: string) => {
    switch (status) {
      case "pending":
        return { icon: <Clock className="w-3 h-3" />, label: "Pendente", cls: "bg-warning/15 text-warning border-warning/25" };
      case "sent":
        return { icon: <CheckCircle2 className="w-3 h-3" />, label: "Enviada", cls: "bg-primary/15 text-primary border-primary/25" };
      case "failed":
        return { icon: <XCircle className="w-3 h-3" />, label: "Falhou", cls: "bg-destructive/15 text-destructive border-destructive/25" };
      default:
        return { icon: <AlertCircle className="w-3 h-3" />, label: status, cls: "bg-secondary text-muted-foreground border-border" };
    }
  };

  const systems = [
    {
      id: "fila" as const,
      title: "Fila com data fixa",
      motor: "send-scheduled-messages · 5 min",
      count: stats.pendingManual,
      desc: "Manuais, lembretes de reprovado e reaquecimento agendado",
      icon: CalendarClock,
      config: () => setActiveTab("fila"),
    },
    {
      id: "pos-venda" as const,
      title: "Pós-venda automático",
      motor: "pos-venda-auto-progress · horário",
      count: stats.posVendaUpcoming,
      desc: "Marcos 30/60/90/120 dias após aprovação no CRM",
      icon: Sparkles,
      config: () => dispatchAgendamentosNav({ tab: "crm-clientes" }),
    },
    {
      id: "conversao" as const,
      title: "Conversão & reaquecimento",
      motor: "reactivation-cron · 1 h + bot follow-up · 5 min",
      count: stats.botFollowups,
      desc: `Auto ${reactivationSettings.auto_enabled ? "ligado" : "desligado"} · ${autoReactivateTemplates} templates ativos`,
      icon: Flame,
      config: () => dispatchAgendamentosNav({ tab: "conversao", conversaoView: "config" }),
    },
    {
      id: "bulk" as const,
      title: "Disparo PRO",
      motor: "bulk-scheduler · 1 min",
      count: stats.bulkActive,
      desc: "Campanhas agendadas ou em andamento",
      icon: Megaphone,
      config: () => dispatchAgendamentosNav({ tab: "whatsapp", whatsappSub: "envio_massa" }),
    },
    {
      id: "crm" as const,
      title: "CRM — ao mover coluna",
      motor: "Imediato (sem fila)",
      count: null,
      desc: "Mensagens ao arrastar deal no Kanban de interessados",
      icon: LayoutGrid,
      config: () => dispatchAgendamentosNav({ tab: "crm" }),
    },
    {
      id: "historico" as const,
      title: "Histórico automático",
      motor: "Somente leitura",
      count: null,
      desc: "Pós-venda enviado + CRM leads",
      icon: History,
      config: () => setActiveTab("historico"),
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-info/10">
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-info/3 rounded-full blur-3xl" />

      <div className="relative p-5 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-info/20 to-info/10 flex items-center justify-center border border-info/20 shrink-0">
              <CalendarClock className="w-5 h-5 text-info" />
            </div>
            <div className="min-w-0">
              <h3 className="font-heading font-bold text-foreground text-lg">Central de Agendamentos</h3>
              <p className="text-xs text-muted-foreground">
                Todos os envios programados e motores automáticos em um só lugar
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {showAdminShortcut && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-xl text-xs"
                onClick={() => dispatchAgendamentosNav({ tab: "agendamentos" })}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir no menu
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={refresh} title="Atualizar">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
          <div className="rounded-xl border border-border/50 bg-muted/20 p-2.5 text-center">
            <p className="text-lg font-bold text-foreground">{stats.timelineUpcoming}</p>
            <p className="text-[10px] text-muted-foreground font-medium">Próximos envios</p>
          </div>
          <div className="rounded-xl border border-warning/15 bg-warning/5 p-2.5 text-center">
            <p className="text-lg font-bold text-warning">{stats.pendingManual}</p>
            <p className="text-[10px] text-warning/70 font-medium">Fila manual</p>
          </div>
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-2.5 text-center">
            <p className="text-lg font-bold text-accent">{stats.posVendaUpcoming}</p>
            <p className="text-[10px] text-accent/80 font-medium">Pós-venda</p>
          </div>
          <div className="rounded-xl border border-info/15 bg-info/5 p-2.5 text-center">
            <p className="text-lg font-bold text-info">{stats.botFollowups}</p>
            <p className="text-[10px] text-info/70 font-medium">Follow-up bot</p>
          </div>
          <div className="rounded-xl border border-primary/15 bg-primary/5 p-2.5 text-center col-span-2 sm:col-span-1">
            <p className="text-lg font-bold text-primary">{stats.bulkActive}</p>
            <p className="text-[10px] text-primary/70 font-medium">Disparo PRO</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AgendamentosHubTab)} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/40 p-1">
            <TabsTrigger value="overview" className="text-xs">Visão geral</TabsTrigger>
            <TabsTrigger value="fila" className="text-xs">Fila manual</TabsTrigger>
            <TabsTrigger value="pos-venda" className="text-xs">Pós-venda</TabsTrigger>
            <TabsTrigger value="conversao" className="text-xs">Conversão</TabsTrigger>
            <TabsTrigger value="bulk" className="text-xs">Disparo PRO</TabsTrigger>
            <TabsTrigger value="historico" className="text-xs">Histórico</TabsTrigger>
          </TabsList>

          {/* ── Visão geral ── */}
          <TabsContent value="overview" className="space-y-5 mt-0">
            <section>
              <h4 className="text-sm font-bold text-foreground mb-3">Próximos envios (unificado)</h4>
              {loading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
                </div>
              ) : timeline.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">Nenhum envio previsto nos sistemas monitorados</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[360px]">
                  <div className="space-y-2">
                    {timeline.slice(0, 30).map((item) => (
                      <div key={item.id} className="rounded-xl border border-border/40 bg-secondary/10 px-4 py-3">
                        <div className="flex items-start gap-2">
                          <div className="w-7 h-7 rounded-md bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
                            {kindIcon(item.kind)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-sm font-bold truncate">{item.title}</span>
                              <Badge variant="secondary" className="text-[9px]">{item.badge}</Badge>
                              {timelineStatusBadge(item.status)}
                            </div>
                            {item.preview && (
                              <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{item.preview}</p>
                            )}
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatScheduleDate(item.at)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </section>

            <section>
              <h4 className="text-sm font-bold text-foreground mb-3">Sistemas e configuração</h4>
              <div className="grid sm:grid-cols-2 gap-3">
                {systems.map((sys) => {
                  const Icon = sys.icon;
                  return (
                    <div key={sys.id} className="rounded-xl border border-border/50 bg-card/50 p-4 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-sm font-bold truncate">{sys.title}</span>
                        </div>
                        {sys.count !== null && (
                          <Badge variant="outline" className="text-[10px] shrink-0">{sys.count}</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{sys.desc}</p>
                      <p className="text-[10px] text-muted-foreground/70 font-mono">{sys.motor}</p>
                      <Button variant="outline" size="sm" className="mt-auto gap-1.5 text-xs rounded-lg w-fit" onClick={sys.config}>
                        <Settings2 className="w-3.5 h-3.5" />
                        Configurar
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="rounded-xl border border-info/20 bg-info/5 p-4 flex gap-3">
              <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
              <div className="text-[11px] text-muted-foreground space-y-1">
                <p>
                  <strong className="text-foreground">Resgate IA</strong> (bot-stuck-recovery · 5 min) e{" "}
                  <strong className="text-foreground">nudge FAQ</strong> (5 min) não têm fila com data — disparam por inatividade.
                </p>
                <p>Cada sistema usa tabela/motor próprio para não duplicar envios. Configurações abrem na tela original do módulo.</p>
              </div>
            </div>
          </TabsContent>

          {/* ── Fila manual ── */}
          <TabsContent value="fila" className="space-y-4 mt-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-bold">scheduled_messages</p>
                <p className="text-[11px] text-muted-foreground">Lembretes de reprovado, reaquecimento agendado e envios avulsos</p>
              </div>
              <Button
                onClick={() => setShowForm(!showForm)}
                className="gap-2 rounded-xl font-bold text-sm"
                style={{ background: "var(--gradient-green)" }}
                disabled={!instanceName}
                title={!instanceName ? "Conecte o WhatsApp para agendar" : undefined}
              >
                <Plus className="w-4 h-4" />
                Agendar manual
              </Button>
            </div>

            {!instanceName && (
              <p className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
                Conecte o WhatsApp na aba Conversas para criar novos agendamentos manuais. A visualização da fila continua disponível.
              </p>
            )}

            {showForm && (
              <div className="rounded-xl border border-info/15 bg-info/5 p-4 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Telefone</Label>
                  <Input placeholder="5511999999999" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving} className="rounded-xl" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Mensagem</Label>
                  <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} disabled={saving} className="rounded-xl resize-none" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Data e hora</Label>
                  <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} min={new Date().toISOString().slice(0, 16)} disabled={saving} className="rounded-xl" />
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleCreateManual} disabled={!phone.trim() || !text.trim() || !scheduledAt || saving} className="gap-2 rounded-xl">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Agendar
                  </Button>
                  <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                </div>
              </div>
            )}

            {manual.length === 0 ? (
              <EmptyState text="Nenhum item na fila manual" />
            ) : (
              <MessageList messages={manual} onDelete={handleDeleteManual} statusConfig={statusConfig} />
            )}
          </TabsContent>

          {/* ── Pós-venda ── */}
          <TabsContent value="pos-venda" className="space-y-4 mt-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-bold">Esteira 30 / 60 / 90 / 120 dias</p>
                <p className="text-[11px] text-muted-foreground">Previsto a partir de pos_venda_approved_at — envio via cron, não entra na fila manual</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "crm-clientes" })}>
                <Settings2 className="w-3.5 h-3.5" /> Configurar mensagens no CRM
              </Button>
            </div>
            {loading ? (
              <LoadingRow />
            ) : posVenda.length === 0 ? (
              <EmptyState text="Nenhum envio previsto — aprove clientes em Clientes ativos" />
            ) : (
              <PosVendaList items={posVenda} />
            )}
          </TabsContent>

          {/* ── Conversão ── */}
          <TabsContent value="conversao" className="space-y-4 mt-0">
            <div className="rounded-xl border border-border/50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-bold">Reaquecimento automático</p>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "conversao", conversaoView: "config" })}>
                  <Settings2 className="w-3.5 h-3.5" /> Editar configuração
                </Button>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
                <ConfigChip label="Automático" value={reactivationSettings.auto_enabled ? "Ligado" : "Desligado"} />
                <ConfigChip label="Templates auto" value={`${autoReactivateTemplates} ativos`} />
                <ConfigChip label="Primeiro envio" value={`${reactivationSettings.horas_ate_primeiro_followup}h após parar`} />
                <ConfigChip label="Janela" value={`${reactivationSettings.janela_inicio}h–${reactivationSettings.janela_fim}h`} />
                <ConfigChip label="Máx. envios" value={String(reactivationSettings.max_envios)} />
                <ConfigChip label="Intervalo" value={`${reactivationSettings.horas_entre_envios}h`} />
              </div>
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "conversao", conversaoView: "resultados" })}>
                Ver resultados de reaquecimento →
              </Button>
            </div>

            <div>
              <p className="text-sm font-bold mb-1">Follow-ups do bot (next_followup_at)</p>
              <p className="text-[11px] text-muted-foreground mb-3">Agendados pelo fluxo (ex.: “me chama amanhã”). Motor: process-followups · 5 min</p>
              {botFollowups.length === 0 ? (
                <EmptyState text="Nenhum follow-up do bot agendado" />
              ) : (
                <ScrollArea className="max-h-[280px]">
                  <div className="space-y-2">
                    {botFollowups.map((b) => (
                      <div key={b.id} className="rounded-xl border border-info/20 bg-info/5 px-4 py-3">
                        <p className="text-sm font-bold">{b.name || b.phone_whatsapp}</p>
                        {b.conversation_step && <p className="text-xs text-muted-foreground">Passo: {b.conversation_step}</p>}
                        <p className="text-[11px] text-info mt-1">{formatScheduleDate(b.next_followup_at)}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => dispatchAgendamentosNav({ tab: "conversao" })}>
              <Flame className="w-3.5 h-3.5" /> Abrir Cockpit de Conversão
            </Button>
          </TabsContent>

          {/* ── Bulk ── */}
          <TabsContent value="bulk" className="space-y-4 mt-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-bold">Campanhas Disparo PRO</p>
                <p className="text-[11px] text-muted-foreground">bulk_campaigns · motor bulk-scheduler</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "whatsapp", whatsappSub: "envio_massa" })}>
                <Megaphone className="w-3.5 h-3.5" /> Ir para Disparo PRO
              </Button>
            </div>
            {bulkCampaigns.length === 0 ? (
              <EmptyState text="Nenhuma campanha agendada ou em andamento" />
            ) : (
              <div className="space-y-2">
                {bulkCampaigns.map((c) => (
                  <div key={c.id} className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-bold">{c.name}</span>
                      <Badge variant="secondary" className="text-[9px]">{c.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{c.sent}/{c.total} enviados · {c.failed} falhas</p>
                    {c.scheduled_at && (
                      <p className="text-[11px] text-muted-foreground mt-1">Agendado: {formatScheduleDate(c.scheduled_at)}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Histórico ── */}
          <TabsContent value="historico" className="mt-0">
            <p className="text-[11px] text-muted-foreground mb-3">
              Envios já realizados — pós-venda (customer_auto_message_log) e CRM leads (crm_auto_message_log)
            </p>
            <Suspense fallback={<LoadingRow />}>
              <AutoMessageLog consultantId={consultantId} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ConfigChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
    </div>
  );
}

function PosVendaList({ items }: { items: import("@/lib/posVendaSchedule").UpcomingPosVendaItem[] }) {
  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className={`rounded-xl border px-4 py-3 ${item.isOverdue ? "border-warning/30 bg-warning/5" : "border-accent/20 bg-accent/5"}`}>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-bold">{item.customerName}</span>
              <Badge className="text-[9px] bg-accent/15 text-accent border-accent/30">{item.stageLabel}</Badge>
            </div>
            {item.messagePreview && <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{item.messagePreview}</p>}
            <p className="text-[11px] text-muted-foreground">{formatScheduleDate(item.scheduledAt)}</p>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function MessageList({
  messages,
  onDelete,
  statusConfig,
}: {
  messages: import("@/lib/agendamentosHub").ScheduledMessageRow[];
  onDelete: (id: string) => void;
  statusConfig: (s: string) => { icon: React.ReactNode; label: string; cls: string };
}) {
  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-2">
        {messages.map((msg) => {
          const sc = statusConfig(msg.status);
          const isPending = msg.status === "pending";
          return (
            <div key={msg.id} className="group rounded-xl border border-border/40 bg-secondary/20 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-bold">{msg.remote_jid.split("@")[0]}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border flex items-center gap-1 ${sc.cls}`}>
                      {sc.icon}{sc.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{msg.message_text}</p>
                  <p className="text-[11px] text-muted-foreground">{formatScheduleDate(msg.scheduled_at)}</p>
                </div>
                {isPending && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/60 hover:text-destructive shrink-0" onClick={() => onDelete(msg.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

/** Compat: WhatsApp sub-aba continua importando SchedulePanel */
export function SchedulePanel(props: { consultantId: string; instanceName: string }) {
  return <AgendamentosHub {...props} showAdminShortcut />;
}
