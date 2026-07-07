import { useState, lazy, Suspense, useEffect } from "react";
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
import { labelForStageKey } from "@/lib/posVendaSchedule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Calendar, Clock, Trash2, Plus, Send, CalendarClock, MessageSquare, Phone,
  CheckCircle2, XCircle, Loader2, AlertCircle, Sparkles, RefreshCw, Settings2,
  Flame, Megaphone, Bot, History, LayoutGrid, ExternalLink, ShieldCheck, Zap,
} from "lucide-react";

const AutoMessageLog = lazy(() => import("./AutoMessageLog").then((m) => ({ default: m.AutoMessageLog })));
const AutomacaoIgreenCard = lazy(() =>
  import("@/features/produtos/acompanhamento/AutomacaoIgreenCard").then((m) => ({ default: m.AutomacaoIgreenCard })),
);

/** Descreve onde o item da timeline está configurado + para onde levar o consultor. */
function describeSource(item: AgendamentoTimelineItem): {
  where: string;
  hint: string;
  targetTab: AgendamentosHubTab;
  ctaLabel: string;
} {
  switch (item.kind) {
    case "manual_scheduled":
      return {
        where: "Agenda manual",
        hint: "Você criou este envio manualmente. Pode editar o texto, remarcar ou apagar aqui mesmo.",
        targetTab: "manual",
        ctaLabel: "Abrir Agenda manual",
      };
    case "pos_venda_auto": {
      const stageKey = item.id.split("-").slice(-1)[0];
      const stageLabel = labelForStageKey(stageKey);
      return {
        where: `Pós-venda automático → ${stageLabel}`,
        hint: "O texto e a mídia desta mensagem estão em Pós-venda automático, no botão “Autoprogressão”. Ao abrir, edite a coluna correspondente.",
        targetTab: "pos-venda",
        ctaLabel: "Abrir Pós-venda automático",
      };
    }
    case "bot_followup":
      return {
        where: "Reaquecimento de leads",
        hint: "O bot marcou uma continuação para este lead. Ajuste janelas, intervalos e templates em Reaquecimento.",
        targetTab: "reaquecimento",
        ctaLabel: "Abrir Reaquecimento",
      };
    case "bulk_campaign":
      return {
        where: "Campanhas em massa",
        hint: "Este item faz parte de uma campanha em massa. Abra Campanhas para pausar, editar ou ver o progresso.",
        targetTab: "campanhas",
        ctaLabel: "Abrir Campanhas",
      };
  }
}

function formatScheduleDate(dateStr: string | Date) {
  try {
    const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    return format(d, "dd MMM yyyy 'às' HH:mm", { locale: ptBR });
  } catch {
    return String(dateStr);
  }
}

/** Selo de status com linguagem do consultor, não do sistema. */
function timelineStatusBadge(status: AgendamentoTimelineItem["status"]) {
  switch (status) {
    case "overdue":
      return <Badge variant="outline" className="text-[9px] border-warning/40 text-warning">Vai sair agora</Badge>;
    case "running":
      return <Badge variant="outline" className="text-[9px] border-primary/40 text-primary">Enviando</Badge>;
    case "failed":
      return <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive">Erro — clique para ver</Badge>;
    default:
      return <Badge variant="outline" className="text-[9px] border-muted-foreground/30 text-muted-foreground">Agendado</Badge>;
  }
}

function kindIcon(kind: AgendamentoTimelineItem["kind"]) {
  switch (kind) {
    case "pos_venda_auto": return <Sparkles className="w-3.5 h-3.5 text-accent" />;
    case "bot_followup": return <Flame className="w-3.5 h-3.5 text-info" />;
    case "bulk_campaign": return <Megaphone className="w-3.5 h-3.5 text-warning" />;
    default: return <Clock className="w-3.5 h-3.5 text-primary" />;
  }
}

/** Status de campanha em massa em PT claro (cobre todos os estados do bulk-scheduler). */
function campaignStatusLabel(status: string): string {
  switch (status) {
    case "running": return "Enviando";
    case "scheduled": return "Agendada";
    case "paused": return "Pausada";
    case "completed": return "Concluída";
    case "failed": return "Com erro";
    case "draft": return "Rascunho";
    case "cancelled": return "Cancelada";
    default: return status;
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

  // Item da timeline clicado — abre o diálogo "onde configurar / editar aqui".
  const [selected, setSelected] = useState<AgendamentoTimelineItem | null>(null);
  const [editText, setEditText] = useState("");
  const [editAt, setEditAt] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

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

  const statusConfig = (status: string, scheduledAtISO?: string) => {
    switch (status) {
      case "pending": {
        // Distingue "vai sair agora" (horário já passou e ainda não enviou)
        // de "aguardando hora" (ainda no futuro). Mesma linguagem do
        // selo da timeline na Visão Geral.
        const overdue = scheduledAtISO ? new Date(scheduledAtISO).getTime() <= Date.now() : false;
        return overdue
          ? { icon: <Clock className="w-3 h-3" />, label: "Vai sair agora", cls: "bg-warning/20 text-warning border-warning/40" }
          : { icon: <Clock className="w-3 h-3" />, label: "Aguardando hora", cls: "bg-warning/10 text-warning border-warning/20" };
      }
      case "sent":
        return { icon: <CheckCircle2 className="w-3 h-3" />, label: "Enviada", cls: "bg-primary/15 text-primary border-primary/25" };
      case "failed":
        return { icon: <XCircle className="w-3 h-3" />, label: "Erro — clique para ver", cls: "bg-destructive/15 text-destructive border-destructive/25" };
      default:
        return { icon: <AlertCircle className="w-3 h-3" />, label: status, cls: "bg-secondary text-muted-foreground border-border" };
    }
  };

  /**
   * Sistemas que aparecem na "Visão geral".
   * Linguagem do consultor: cada card explica o que faz, mostra um selo
   * Ligado/Desligado quando aplicável e leva direto pro lugar de configurar.
   */
  const sistemasAgendados = [
    {
      id: "manual" as const,
      title: "Agenda manual",
      desc: "Você escolhe o cliente, escreve a mensagem e marca a hora.",
      count: stats.pendingManual,
      icon: CalendarClock,
      action: () => setActiveTab("manual"),
    },
    {
      id: "pos-venda" as const,
      title: "Pós-venda automático",
      desc: "Mensagem de boas-vindas (aprovado) ou devolutiva (reprovado) e a esteira de 30, 60, 90 e 120 dias. Só roda depois que o consultor clica em Aprovado ou Reprovado.",
      count: stats.posVendaUpcoming,
      icon: Sparkles,
      action: () => setActiveTab("pos-venda"),
    },
    {
      id: "reaquecimento" as const,
      title: "Reaquecimento de leads",
      desc: "Volta a falar com leads que sumiram. Só age em leads do WhatsApp e cadastros manuais — nunca em cliente da carteira.",
      count: stats.botFollowups,
      countLabel: "continuações marcadas pelo bot",
      icon: Flame,
      badge: reactivationSettings.auto_enabled ? "Ligado" : "Desligado",
      badgeOn: reactivationSettings.auto_enabled,
      action: () => setActiveTab("reaquecimento"),
    },
    {
      id: "campanhas" as const,
      title: "Campanhas em massa",
      desc: "Disparos para várias pessoas de uma vez (antigo Disparo PRO).",
      count: stats.bulkActive,
      icon: Megaphone,
      action: () => setActiveTab("campanhas"),
    },
    {
      id: "igreen" as const,
      title: "Automações iGreen",
      desc: "Captura de boletos, devolutivas, telecom, seguros e cashback (sempre salvando). Alertas e envios proativos por WhatsApp.",
      icon: Bot,
      badge: "Sempre salvando",
      badgeOn: true,
      action: () => setActiveTab("igreen"),
    },
  ];

  /**
   * Coisas que não são agendadas — disparam na hora.
   * Cada uma leva o consultor para o lugar onde dá pra ver o que aconteceu
   * (histórico) ou configurar.
   */
  const disparoNaHora = [
    {
      title: "CRM: ao mover card no Kanban",
      desc: "Quando o consultor arrasta o card, a mensagem configurada para aquela coluna sai na hora. Não entra na fila de agendados, mas aparece no histórico.",
      icon: LayoutGrid,
      actionLabel: "Abrir Kanban",
      action: () => dispatchAgendamentosNav({ tab: "crm" }),
    },
    {
      title: "IA de resgate",
      desc: "Quando um lead trava no fluxo do bot, a IA tenta retomar a conversa. Roda automaticamente para leads — nunca toca cliente da carteira.",
      icon: ShieldCheck,
      badge: "Automático",
      actionLabel: "Ver o que já saiu",
      action: () => setActiveTab("historico"),
    },
    {
      title: "Cutucadinha pós-FAQ",
      desc: "Se o lead pergunta algo no FAQ e some por 20min, a IA dá uma cutucada. Só para leads.",
      icon: Zap,
      badge: "Automático",
      actionLabel: "Ver o que já saiu",
      action: () => setActiveTab("historico"),
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
                Tudo que vai sair sozinho da sua conta — em um lugar só, em português claro.
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

        {/* Aviso fixo: regra de ouro da carteira. Sempre visível. */}
        <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-3 flex gap-2.5">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-[12px] text-foreground leading-relaxed">
            <strong>Clientes da carteira iGreen nunca recebem nada automático.</strong>{" "}
            Reaquecimento, resgate e cutucada só rodam para leads do WhatsApp e cadastros manuais.
            A esteira 30/60/90/120 dias do pós-venda só começa quando o consultor (ou admin) clica em <em>Aprovado</em>.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
          <div className="rounded-xl border border-border/50 bg-muted/20 p-2.5 text-center">
            <p className="text-lg font-bold text-foreground">{stats.timelineUpcoming}</p>
            <p className="text-[10px] text-muted-foreground font-medium">Próximos envios</p>
          </div>
          <div className="rounded-xl border border-warning/15 bg-warning/5 p-2.5 text-center">
            <p className="text-lg font-bold text-warning">{stats.pendingManual}</p>
            <p className="text-[10px] text-warning/70 font-medium">Agenda manual</p>
          </div>
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-2.5 text-center">
            <p className="text-lg font-bold text-accent">{stats.posVendaUpcoming}</p>
            <p className="text-[10px] text-accent/80 font-medium">Pós-venda</p>
          </div>
          <div className="rounded-xl border border-primary/15 bg-primary/5 p-2.5 text-center">
            <p className="text-lg font-bold text-primary">{stats.bulkActive}</p>
            <p className="text-[10px] text-primary/70 font-medium">Campanhas</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AgendamentosHubTab)} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/40 p-1">
            <TabsTrigger value="overview" className="text-xs">Visão geral</TabsTrigger>
            <TabsTrigger value="manual" className="text-xs">Agenda manual</TabsTrigger>
            <TabsTrigger value="pos-venda" className="text-xs">Pós-venda</TabsTrigger>
            <TabsTrigger value="reaquecimento" className="text-xs">Reaquecimento</TabsTrigger>
            <TabsTrigger value="campanhas" className="text-xs">Campanhas</TabsTrigger>
            <TabsTrigger value="igreen" className="text-xs">Automações iGreen</TabsTrigger>
            <TabsTrigger value="historico" className="text-xs">Histórico</TabsTrigger>
          </TabsList>

          {/* ── Visão geral ── */}
          <TabsContent value="overview" className="space-y-5 mt-0">
            <section>
              <h4 className="text-sm font-bold text-foreground mb-3">Próximos envios</h4>
              {loading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
                </div>
              ) : timeline.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">Nada agendado no momento</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[360px]">
                  <div className="space-y-2">
                    {timeline.slice(0, 30).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelected(item);
                          if (item.kind === "manual_scheduled") {
                            setEditText(item.preview || "");
                            // datetime-local precisa de yyyy-MM-ddTHH:mm no fuso local
                            const d = item.at;
                            const pad = (n: number) => String(n).padStart(2, "0");
                            setEditAt(
                              `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                            );
                          }
                        }}
                        className="w-full text-left rounded-xl border border-border/40 bg-secondary/10 px-4 py-3 hover:border-primary/40 hover:bg-secondary/20 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div className="w-7 h-7 rounded-md bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
                            {kindIcon(item.kind)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-sm font-bold truncate">{item.title}</span>
                              <Badge variant="secondary" className="text-[9px]">{item.badge}</Badge>
                              {timelineStatusBadge(item.status)}
                              <span className="ml-auto text-[10px] text-muted-foreground opacity-70">clique para configurar</span>
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
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </section>

            <section>
              <h4 className="text-sm font-bold text-foreground mb-3">O que está ligado</h4>
              <div className="grid sm:grid-cols-2 gap-3">
                {sistemasAgendados.map((sys) => {
                  const Icon = sys.icon;
                  return (
                    <div key={sys.id} className="rounded-xl border border-border/50 bg-card/50 p-4 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className="w-4 h-4 text-primary shrink-0" />
                          <span className="text-sm font-bold truncate">{sys.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {sys.badge && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${sys.badgeOn ? "border-primary/40 text-primary" : "border-muted-foreground/30 text-muted-foreground"}`}
                            >
                              {sys.badge}
                            </Badge>
                          )}
                          {typeof sys.count === "number" && (
                            <Badge variant="outline" className="text-[10px]" title={sys.countLabel}>{sys.count}</Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{sys.desc}</p>
                      {sys.countLabel && typeof sys.count === "number" && (
                        <p className="text-[10px] text-muted-foreground/80 italic">{sys.count} {sys.countLabel}</p>
                      )}
                      <Button variant="outline" size="sm" className="mt-auto gap-1.5 text-xs rounded-lg w-fit" onClick={sys.action}>
                        <Settings2 className="w-3.5 h-3.5" />
                        Abrir e configurar
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <h4 className="text-sm font-bold text-foreground mb-1">Dispara na hora (sem fila)</h4>
              <p className="text-[11px] text-muted-foreground mb-3">
                Estes envios não aparecem na contagem de "Próximos envios" porque não esperam horário marcado.
                Eles aparecem no histórico depois que saem.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {disparoNaHora.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="rounded-xl border border-border/40 bg-muted/15 p-4 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon className="w-4 h-4 text-info shrink-0" />
                          <span className="text-sm font-bold truncate">{item.title}</span>
                        </div>
                        {item.badge && (
                          <Badge variant="outline" className="text-[10px] border-info/40 text-info shrink-0">{item.badge}</Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                      {item.action && (
                        <Button variant="outline" size="sm" className="mt-auto gap-1.5 text-xs rounded-lg w-fit" onClick={item.action}>
                          <Settings2 className="w-3.5 h-3.5" />
                          {item.actionLabel ?? "Abrir"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </TabsContent>

          {/* ── Agenda manual ── */}
          <TabsContent value="manual" className="space-y-4 mt-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-bold">Mensagens que você marcou para sair</p>
                <p className="text-[11px] text-muted-foreground">Avisos avulsos, lembretes, retomada de cliente reprovado.</p>
              </div>
              <Button
                onClick={() => setShowForm(!showForm)}
                className="gap-2 rounded-xl font-bold text-sm"
                style={{ background: "var(--gradient-green)" }}
                disabled={!instanceName}
                title={!instanceName ? "Conecte o WhatsApp para agendar" : undefined}
              >
                <Plus className="w-4 h-4" />
                Agendar nova
              </Button>
            </div>

            {!instanceName && (
              <p className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
                Conecte o WhatsApp na aba Conversas para criar novos agendamentos. A lista do que já está agendado continua aparecendo.
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
              <EmptyState text="Nada agendado manualmente ainda" />
            ) : (
              <MessageList messages={manual} onDelete={handleDeleteManual} statusConfig={statusConfig} />
            )}
          </TabsContent>

          {/* ── Pós-venda ── */}
          <TabsContent value="pos-venda" className="space-y-4 mt-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-bold">Esteira automática: 30, 60, 90 e 120 dias</p>
                <p className="text-[11px] text-muted-foreground">
                  Conta a partir da data em que o consultor clicou em <em>Aprovado</em>. Só clientes aprovados entram.
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "crm-clientes" })}>
                <Settings2 className="w-3.5 h-3.5" /> Editar mensagens
              </Button>
            </div>
            {loading ? (
              <LoadingRow />
            ) : posVenda.length === 0 ? (
              <EmptyState text="Nenhum envio previsto — aprove clientes em Clientes ativos para começar a esteira" />
            ) : (
              <PosVendaList items={posVenda} />
            )}
          </TabsContent>

          {/* ── Reaquecimento (junta antiga aba Conversão + Follow-up bot) ── */}
          <TabsContent value="reaquecimento" className="space-y-4 mt-0">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex gap-2">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-[11px] text-foreground">
                Só leads do WhatsApp e cadastros manuais. Cliente da carteira nunca recebe reaquecimento.
              </p>
            </div>

            <div className="rounded-xl border border-border/50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-bold">Reaquecimento automático</p>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "conversao", conversaoView: "config" })}>
                  <Settings2 className="w-3.5 h-3.5" /> Editar configuração
                </Button>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
                <ConfigChip label="Automático" value={reactivationSettings.auto_enabled ? "Ligado" : "Desligado"} />
                <ConfigChip label="Mensagens prontas ativas" value={`${autoReactivateTemplates}`} />
                <ConfigChip label="Primeira mensagem" value={`${reactivationSettings.horas_ate_primeiro_followup}h depois de parar`} />
                <ConfigChip label="Horário permitido" value={`${reactivationSettings.janela_inicio}h às ${reactivationSettings.janela_fim}h`} />
                <ConfigChip label="Máximo de tentativas" value={String(reactivationSettings.max_envios)} />
                <ConfigChip label="Espaço entre tentativas" value={`${reactivationSettings.horas_entre_envios}h`} />
              </div>
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "conversao", conversaoView: "resultados" })}>
                Ver resultados de reaquecimento →
              </Button>
            </div>

            <div>
              <p className="text-sm font-bold mb-1">Continuações marcadas pelo bot</p>
              <p className="text-[11px] text-muted-foreground mb-3">
                Quando o lead diz "me chama amanhã" ou "depois falo", o bot agenda aqui.
              </p>
              {botFollowups.length === 0 ? (
                <EmptyState text="Nenhuma continuação marcada pelo bot" />
              ) : (
                <ScrollArea className="max-h-[280px]">
                  <div className="space-y-2">
                    {botFollowups.map((b) => (
                      <div key={b.id} className="rounded-xl border border-info/20 bg-info/5 px-4 py-3">
                        <p className="text-sm font-bold">{b.name || b.phone_whatsapp}</p>
                        {b.conversation_step && <p className="text-xs text-muted-foreground">Etapa: {b.conversation_step}</p>}
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

          {/* ── Campanhas em massa ── */}
          <TabsContent value="campanhas" className="space-y-4 mt-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-bold">Campanhas em massa</p>
                <p className="text-[11px] text-muted-foreground">Disparos para várias pessoas de uma vez (antigo Disparo PRO).</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "whatsapp", whatsappSub: "envio_massa" })}>
                <Megaphone className="w-3.5 h-3.5" /> Criar campanha
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
                      <Badge variant="secondary" className="text-[9px]">{campaignStatusLabel(c.status)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{c.sent} de {c.total} enviados · {c.failed} com erro</p>
                    {c.scheduled_at && (
                      <p className="text-[11px] text-muted-foreground mt-1">Sai em: {formatScheduleDate(c.scheduled_at)}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Automações iGreen ── */}
          <TabsContent value="igreen" className="mt-0">
            <p className="text-[11px] text-muted-foreground mb-3">
              Captura de dados do escritório iGreen (boletos, devolutivas, telecom, seguros, cashback) é obrigatória e sempre salva.
              Automações que enviam mensagem ao cliente permanecem desligadas — ative com cuidado.
            </p>
            <Suspense fallback={<LoadingRow />}>
              <AutomacaoIgreenCard consultantId={consultantId} />
            </Suspense>
          </TabsContent>

          {/* ── Histórico ── */}
          <TabsContent value="historico" className="mt-0">
            <p className="text-[11px] text-muted-foreground mb-3">
              Mensagens que já saíram — pós-venda automático, CRM (ao mover card) e demais envios.
            </p>
            <Suspense fallback={<LoadingRow />}>
              <AutoMessageLog consultantId={consultantId} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>

      <TimelineItemDialog
        item={selected}
        onClose={() => setSelected(null)}
        onGoToConfig={(tab) => { setActiveTab(tab); setSelected(null); }}
        editText={editText}
        setEditText={setEditText}
        editAt={editAt}
        setEditAt={setEditAt}
        savingEdit={savingEdit}
        onSaveManual={async () => {
          if (!selected || selected.kind !== "manual_scheduled") return;
          setSavingEdit(true);
          try {
            const id = selected.id.replace(/^manual-/, "");
            const { error } = await supabase
              .from("scheduled_messages")
              .update({
                message_text: editText,
                scheduled_at: new Date(editAt).toISOString(),
              })
              .eq("id", id);
            if (error) throw error;
            toast({ title: "Agendamento atualizado" });
            setSelected(null);
            refresh();
          } catch {
            toast({ title: "Erro ao atualizar", variant: "destructive" });
          } finally {
            setSavingEdit(false);
          }
        }}
        onDeleteManual={async () => {
          if (!selected || selected.kind !== "manual_scheduled") return;
          const id = selected.id.replace(/^manual-/, "");
          await handleDeleteManual(id);
          setSelected(null);
        }}
      />
    </div>
  );
}

function TimelineItemDialog({
  item, onClose, onGoToConfig,
  editText, setEditText, editAt, setEditAt, savingEdit, onSaveManual, onDeleteManual,
}: {
  item: AgendamentoTimelineItem | null;
  onClose: () => void;
  onGoToConfig: (tab: AgendamentosHubTab) => void;
  editText: string;
  setEditText: (v: string) => void;
  editAt: string;
  setEditAt: (v: string) => void;
  savingEdit: boolean;
  onSaveManual: () => void;
  onDeleteManual: () => void;
}) {
  if (!item) return null;
  const src = describeSource(item);
  const isManual = item.kind === "manual_scheduled";
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            {item.title}
          </DialogTitle>
          <DialogDescription>
            {formatScheduleDate(item.at)} · {item.badge}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Onde está configurado</p>
            <p className="text-sm font-semibold">{src.where}</p>
            <p className="text-xs text-muted-foreground mt-1">{src.hint}</p>
          </div>

          {isManual ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Mensagem</Label>
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={4}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Enviar em</Label>
                <Input
                  type="datetime-local"
                  value={editAt}
                  onChange={(e) => setEditAt(e.target.value)}
                />
              </div>
            </div>
          ) : item.preview ? (
            <div className="rounded-xl border border-border/40 bg-secondary/10 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Prévia</p>
              <p className="text-sm whitespace-pre-wrap">{item.preview}</p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          {isManual && (
            <>
              <Button variant="ghost" className="text-destructive gap-1.5" onClick={onDeleteManual}>
                <Trash2 className="w-3.5 h-3.5" />
                Apagar
              </Button>
              <Button onClick={onSaveManual} disabled={savingEdit || !editText.trim() || !editAt} className="gap-1.5">
                {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Salvar mudanças
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => onGoToConfig(src.targetTab)} className="gap-1.5">
            <Settings2 className="w-3.5 h-3.5" />
            {src.ctaLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  statusConfig: (s: string, scheduledAtISO?: string) => { icon: React.ReactNode; label: string; cls: string };
}) {
  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-2">
        {messages.map((msg) => {
          const sc = statusConfig(msg.status, msg.scheduled_at);
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
