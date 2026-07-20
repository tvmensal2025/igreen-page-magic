import { useState, lazy, Suspense, useEffect } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAgendamentosHub } from "@/hooks/useAgendamentosHub";
import {
  dispatchAgendamentosNav,
  type AgendamentosHubTab,
  type AgendamentoTimelineItem,
} from "@/lib/agendamentosHub";
import { labelForStageKey } from "@/lib/posVendaSchedule";
import {
  resolveScheduleChannel,
  scheduleChannelBlockedReason,
} from "@/lib/scheduleChannel";
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
  Calendar, Clock, Plus, Send, CalendarClock, MessageSquare, Phone,
  CheckCircle2, XCircle, Loader2, AlertCircle, Sparkles, RefreshCw, Settings2,
  Flame, Megaphone, Bot, History, LayoutGrid, ExternalLink, ShieldCheck, Zap, Bell, FileText, Trash2,
  Image as ImageIcon, Volume2,
} from "lucide-react";
import { AutomacoesAtivasBadge } from "@/features/produtos/acompanhamento/AutomacoesAtivasBadge";
import { SistemaCapacidadesHelp } from "@/components/admin/SistemaCapacidadesHelp";
import { AgendamentosTextosDialog } from "@/components/whatsapp/AgendamentosTextosDialog";

const AutoMessageLog = lazy(() => import("./AutoMessageLog").then((m) => ({ default: m.AutoMessageLog })));
const AutomacaoIgreenCard = lazy(() =>
  import("@/features/produtos/acompanhamento/AutomacaoIgreenCard").then((m) => ({ default: m.AutomacaoIgreenCard })),
);
const RodiziosBroadcastPanel = lazy(() =>
  import("./RodiziosBroadcastPanel").then((m) => ({ default: m.RodiziosBroadcastPanel })),
);
const AgendamentosZeroLeadPanel = lazy(() =>
  import("./AgendamentosZeroLeadPanel").then((m) => ({ default: m.AgendamentosZeroLeadPanel })),
);
const AgendamentosJornadaMap = lazy(() =>
  import("./AgendamentosJornadaMap").then((m) => ({ default: m.AgendamentosJornadaMap })),
);
const AgendamentosGrupoAPanel = lazy(() =>
  import("./AgendamentosGrupoAPanel").then((m) => ({ default: m.AgendamentosGrupoAPanel })),
);
const AgendamentosGrupoCPanel = lazy(() =>
  import("./AgendamentosGrupoCPanel").then((m) => ({ default: m.AgendamentosGrupoCPanel })),
);

/** Normaliza abas antigas para a nova estrutura */
function normalizeHubTab(tab: AgendamentosHubTab): AgendamentosHubTab {
  if (tab === "overview" || tab === "leads-frios") return tab === "leads-frios" ? "grupo-b" : "mapa";
  if (tab === "igreen") return "carteira";
  if (tab === "manual" || tab === "pos-venda" || tab === "reaquecimento" || tab === "campanhas" || tab === "rodizios") return "agenda";
  return tab;
}

/** Extrai customerId + stage_key de ids tipo `<uuid>-pv_aprovado`. */
function parsePosVendaTimelineId(id: string): { customerId: string; stageKey: string } | null {
  const m = id.match(/^(.+)-(pv_[a-z0-9]+)$/i);
  if (!m) return null;
  return { customerId: m[1], stageKey: m[2] };
}

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
        hint: "Você criou este envio manualmente. Pode editar o texto, remarcar ou excluir aqui mesmo (cancelado fica no histórico).",
        targetTab: "manual",
        ctaLabel: "Abrir Agenda manual",
      };
    case "pos_venda_auto": {
      const parsed = parsePosVendaTimelineId(item.id);
      const stageLabel = parsed ? labelForStageKey(parsed.stageKey) : item.badge;
      return {
        where: `Pós-venda automático → ${stageLabel}`,
        hint: "Pode excluir só este envio deste cliente (não manda a mensagem). O texto padrão da coluna continua em Pós-venda automático.",
        targetTab: "pos-venda",
        ctaLabel: "Abrir Pós-venda automático",
      };
    }
    case "bot_followup":
      return {
        where: "Reaquecimento de leads",
        hint: "Excluir remove o próximo follow-up deste lead. Para desligar o motor inteiro, use Reaquecimento.",
        targetTab: "reaquecimento",
        ctaLabel: "Abrir Reaquecimento",
      };
    case "bulk_campaign":
      return {
        where: "Campanhas em massa",
        hint: "Excluir cancela a campanha agendada/em andamento. Para editar o conteúdo, abra Campanhas.",
        targetTab: "campanhas",
        ctaLabel: "Abrir Campanhas",
      };
    case "voice_campaign":
      return {
        where: "Ligação (Velip)",
        hint: "Excluir cancela a campanha de ligação. Para acompanhar o progresso, abra a aba Ligação.",
        targetTab: "campanhas",
        ctaLabel: "Ver campanhas",
      };
    case "cadence_send":
      return {
        where: "Motor A→B→C (cadência automática)",
        hint: "Envio programado pelo motor de reengajamento. Para pausar/editar textos, abra Grupo B ou o Motor de Cadência.",
        targetTab: "grupo-b",
        ctaLabel: "Abrir Grupo B",
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

/**
 * Valor "agora" para o atributo min de <input type="datetime-local">, no fuso
 * LOCAL do usuário. (toISOString().slice(0,16) puro devolvia UTC → o min
 * ficava 3h no futuro para quem está em Brasília.)
 */
function nowLocalInputValue(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
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
    case "pos_venda_auto": return <Sparkles className="w-3.5 h-3.5 text-primary" />;
    case "bot_followup": return <Flame className="w-3.5 h-3.5 text-info" />;
    case "bulk_campaign": return <Megaphone className="w-3.5 h-3.5 text-warning" />;
    case "voice_campaign": return <Phone className="w-3.5 h-3.5 text-info" />;
    case "cadence_send": return <Flame className="w-3.5 h-3.5 text-primary" />;
    default: return <Clock className="w-3.5 h-3.5 text-primary" />;
  }
}

/** Status de campanha em massa / ligação em PT claro. */
function campaignStatusLabel(status: string): string {
  switch (status) {
    case "running": return "Em andamento";
    case "scheduled": return "Agendada";
    case "paused": return "Pausada";
    case "completed":
    case "finished":
    case "done": return "Concluída";
    case "failed": return "Com erro";
    case "draft": return "Rascunho";
    case "cancelled":
    case "canceled": return "Cancelada";
    default: return status;
  }
}

interface AgendamentosHubProps {
  consultantId: string;
  instanceName: string;
  /** true = consultor no Whapi; agenda dispara via Whapi no cron. */
  isWhapi?: boolean;
  /** false = desconectado — bloqueia criar agendamento. */
  isConnected?: boolean;
  defaultTab?: AgendamentosHubTab;
  /** Quando true, mostra atalho para abrir como aba principal do Admin */
  showAdminShortcut?: boolean;
  onOpenChat?: (phone: string) => void;
}

export function AgendamentosHub({
  consultantId,
  instanceName,
  isWhapi = false,
  isConnected,
  defaultTab = "mapa",
  showAdminShortcut = false,
  onOpenChat,
}: AgendamentosHubProps) {
  const [activeTab, setActiveTab] = useState<AgendamentosHubTab>(() => normalizeHubTab(defaultTab));
  const [agendaSub, setAgendaSub] = useState<"manual" | "pos-venda" | "reaquecimento" | "campanhas" | "rodizios">("manual");
  const [textosOpen, setTextosOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);
  const { toast } = useToast();
  const confirm = useConfirm();

  // Item da timeline clicado — abre o diálogo "onde configurar / editar aqui".
  const [selected, setSelected] = useState<AgendamentoTimelineItem | null>(null);
  const [editText, setEditText] = useState("");
  const [editAt, setEditAt] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // Filtro visual dos "Próximos envios" (client-side, não altera dados)
  const [timelineFilter, setTimelineFilter] = useState<"all" | AgendamentoTimelineItem["kind"]>("all");

  const goTab = (tab: AgendamentosHubTab) => setActiveTab(normalizeHubTab(tab));

  const {
    loading,
    refresh,
    manual,
    posVenda,
    botFollowups,
    bulkCampaigns,
    voiceCampaigns,
    reactivationSettings,
    autoReactivateTemplates,
    timeline,
    stats,
  } = useAgendamentosHub(consultantId);

  const channelReady = resolveScheduleChannel({
    isWhapi,
    instanceName,
    isConnected: isConnected ?? (isWhapi ? true : undefined),
  });
  const channelBlockedReason = scheduleChannelBlockedReason(channelReady);

  const handleCreateManual = async () => {
    if (!phone.trim() || !text.trim() || !scheduledAt) return;
    if (!channelReady.ok) {
      toast({
        title: "WhatsApp não conectado",
        description: channelBlockedReason || "Conecte o WhatsApp para agendar.",
        variant: "destructive",
      });
      return;
    }
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      toast({ title: "Escolha um horário no futuro", description: "A data informada já passou.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const remoteJid = phone.includes("@") ? phone : `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("scheduled_messages").insert({
        consultant_id: consultantId,
        instance_name: channelReady.instanceName,
        remote_jid: remoteJid,
        message_text: text,
        scheduled_at: new Date(scheduledAt).toISOString(),
        // Autoria: quem criou o agendamento (a execução futura é automática).
        created_by: auth?.user?.id ?? consultantId,
      });
      if (error) throw error;
      toast({
        title: "Mensagem agendada com sucesso!",
        description: channelReady.channel === "whapi"
          ? "Saída via Whapi (canal conectado)."
          : "Saída via Evolution (canal conectado).",
      });
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

  // Cancelamento com trilha de auditoria: marca cancelled em vez de DELETE.
  // Só cancela se ainda estiver pending — se o robô já reivindicou (processing)
  // ou já enviou, o update não afeta nenhuma linha e avisamos o usuário.
  const handleCancelManual = async (id: string) => {
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("scheduled_messages")
      .update({
        status: "cancelled",
        canceled_at: new Date().toISOString(),
        canceled_by: auth?.user?.id ?? consultantId,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error) {
      toast({ title: "Erro ao cancelar", description: error.message, variant: "destructive" });
      return false;
    }
    if (!data || data.length === 0) {
      toast({ title: "Não foi possível cancelar", description: "Esta mensagem já foi enviada ou está saindo agora.", variant: "destructive" });
      return false;
    }
    toast({ title: "Agendamento cancelado" });
    refresh();
    return true;
  };

  /** Exclui/cancela o item clicado em "Próximos envios → configurar". */
  const handleDeleteTimelineItem = async (item: AgendamentoTimelineItem) => {
    const ok = await confirm({
      title: "Excluir este agendamento?",
      description:
        item.kind === "pos_venda_auto"
          ? `“${item.title}” · ${item.badge}\n\nEste cliente não receberá esta mensagem automática. O texto da coluna continua igual para os outros.`
          : item.kind === "bulk_campaign" || item.kind === "voice_campaign"
            ? `Campanha “${item.title}” será cancelada e some da fila.`
            : item.kind === "bot_followup"
              ? `Remove o próximo reaquecimento de “${item.title}”.`
              : `Cancela o envio manual de “${item.title}” (fica no histórico como Cancelada).`,
      confirmText: "Excluir",
      cancelText: "Manter",
      tone: "danger",
    });
    if (!ok) return;

    setDeletingItem(true);
    try {
      if (item.kind === "manual_scheduled") {
        const id = item.id.replace(/^manual-/, "");
        const done = await handleCancelManual(id);
        if (done) setSelected(null);
        return;
      }

      if (item.kind === "pos_venda_auto") {
        const parsed = parsePosVendaTimelineId(item.id);
        if (!parsed) {
          toast({ title: "Não foi possível identificar o envio", variant: "destructive" });
          return;
        }
        const { error } = await supabase.from("customer_auto_message_log").insert({
          customer_id: parsed.customerId,
          consultant_id: consultantId,
          stage_key: parsed.stageKey,
          customer_name: item.title,
          message_preview: item.preview ?? null,
          status: "skipped_by_consultant",
        });
        if (error) {
          // Já pulado / já enviado
          if ((error as { code?: string }).code === "23505") {
            toast({ title: "Este envio já estava marcado como processado" });
            setSelected(null);
            refresh();
            return;
          }
          toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
          return;
        }
        toast({ title: "Envio removido da fila" });
        setSelected(null);
        refresh();
        return;
      }

      if (item.kind === "bot_followup") {
        const customerId = item.id.replace(/^followup-/, "");
        const { error } = await supabase
          .from("customers")
          .update({ next_followup_at: null })
          .eq("id", customerId)
          .eq("consultant_id", consultantId);
        if (error) {
          toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
          return;
        }
        toast({ title: "Follow-up removido" });
        setSelected(null);
        refresh();
        return;
      }

      if (item.kind === "bulk_campaign") {
        const campaignId = item.id.replace(/^bulk-/, "");
        const { data, error } = await (supabase as any)
          .from("bulk_campaigns")
          .update({ status: "canceled" })
          .eq("id", campaignId)
          .eq("consultant_id", consultantId)
          .in("status", ["scheduled", "running", "paused"])
          .select("id");
        if (error) {
          toast({ title: "Erro ao cancelar campanha", description: error.message, variant: "destructive" });
          return;
        }
        if (!data || data.length === 0) {
          toast({ title: "Campanha já finalizada", variant: "destructive" });
          return;
        }
        toast({ title: "Campanha cancelada" });
        setSelected(null);
        refresh();
        return;
      }

      if (item.kind === "voice_campaign") {
        const campaignId = item.id.replace(/^voice-/, "");
        const { data, error } = await supabase.functions.invoke("voice-campaign-control", {
          body: { campaign_id: campaignId, action: "cancel" },
        });
        if (error) {
          toast({ title: "Erro ao cancelar ligação", description: error.message, variant: "destructive" });
          return;
        }
        if (data?.error) {
          toast({ title: "Erro ao cancelar ligação", description: String(data.error), variant: "destructive" });
          return;
        }
        toast({ title: "Campanha de ligação cancelada" });
        setSelected(null);
        refresh();
        return;
      }
    } finally {
      setDeletingItem(false);
    }
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
      case "processing":
        return { icon: <Loader2 className="w-3 h-3 animate-spin" />, label: "Saindo agora", cls: "bg-info/15 text-info border-info/25" };
      case "failed":
        return { icon: <XCircle className="w-3 h-3" />, label: "Erro — clique para ver", cls: "bg-destructive/15 text-destructive border-destructive/25" };
      case "cancelled":
        return { icon: <XCircle className="w-3 h-3" />, label: "Cancelada", cls: "bg-secondary text-muted-foreground border-border" };
      case "skipped":
        return { icon: <AlertCircle className="w-3 h-3" />, label: "Pulada (humano assumiu)", cls: "bg-secondary text-muted-foreground border-border" };
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
      id: "mapa" as const,
      title: "Mapa do sistema",
      desc: "Visão A → B → C e status de cada parte.",
      icon: LayoutGrid,
      badge: "Comece aqui",
      badgeOn: true,
      action: () => goTab("mapa"),
    },
    {
      id: "grupo-b" as const,
      title: "Grupo B — Leads frios",
      desc: "Separar DDD, ligar envio dos 10 primeiros dias.",
      icon: Zap,
      badge: "Principal",
      badgeOn: true,
      action: () => goTab("grupo-b"),
    },
    {
      id: "manual" as const,
      title: "Agenda manual",
      desc: "Você escolhe o cliente, escreve a mensagem e marca a hora.",
      count: stats.pendingManual,
      icon: CalendarClock,
      action: () => { goTab("agenda"); setAgendaSub("manual"); },
    },
    {
      id: "pos-venda" as const,
      title: "Pós-venda automático",
      desc: "Mensagem de boas-vindas (aprovado) ou devolutiva (reprovado) e a esteira de 30, 60, 90 e 120 dias. Só roda depois que o consultor clica em Aprovado ou Reprovado.",
      count: stats.posVendaUpcoming,
      icon: Sparkles,
      action: () => { goTab("agenda"); setAgendaSub("pos-venda"); },
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
      action: () => { goTab("agenda"); setAgendaSub("reaquecimento"); },
    },
    {
      id: "campanhas" as const,
      title: "Campanhas em massa",
      desc: "Disparos para várias pessoas de uma vez (antigo Disparo PRO).",
      count: stats.bulkActive,
      icon: Megaphone,
      action: () => { goTab("agenda"); setAgendaSub("campanhas"); },
    },
    {
      id: "rodizios" as const,
      title: "Métricas para parceiros de rodízio",
      desc: "Enviamos automaticamente no WhatsApp de cada parceiro do rodízio: gasto, alcance, conversas e leads da campanha. Escolha o intervalo (10min, 30min, 1h, 2h ou 4h) por campanha.",
      icon: Bell,
      badge: "Configurável",
      badgeOn: true,
      action: () => { goTab("agenda"); setAgendaSub("rodizios"); },
    },
    {
      id: "carteira" as const,
      title: "Carteira iGreen",
      desc: "Captura de boletos, devolutivas, telecom, seguros e cashback (sempre salvando). Alertas e envios proativos por WhatsApp.",
      icon: Bot,
      badge: "Sempre salvando",
      badgeOn: true,
      action: () => goTab("carteira"),
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
      action: () => goTab("historico"),
    },
    {
      title: "Cutucadinha pós-FAQ",
      desc: "Se o lead pergunta algo no FAQ e some por 20min, a IA dá uma cutucada. Só para leads.",
      icon: Zap,
      badge: "Automático",
      actionLabel: "Ver o que já saiu",
      action: () => goTab("historico"),
    },
  ];

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-info/10 font-[Manrope,ui-sans-serif,system-ui,sans-serif]"
    >
      <div className="absolute -top-20 -right-20 w-56 h-56 bg-info/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-56 h-56 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative p-5 sm:p-7">
        {/* ── Cabeçalho ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-info/25 to-info/5 flex items-center justify-center border border-info/20 shrink-0 shadow-sm">
              <CalendarClock className="w-6 h-6 text-info" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80 font-[Sora,ui-sans-serif] font-medium">
                Painel iGreen
              </p>
              <h3 className="font-[Sora,ui-sans-serif,system-ui,sans-serif] font-bold text-foreground text-xl md:text-2xl leading-tight">
                Central de Automações
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Mapa A → B → C · ligue leads frios · agenda · carteira — tudo em português claro.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <Button
              variant="default"
              size="sm"
              className="gap-1.5 rounded-xl text-xs"
              onClick={() => setTextosOpen(true)}
            >
              <FileText className="w-3.5 h-3.5" />
              Ajustar todos os textos
            </Button>
            <SistemaCapacidadesHelp className="rounded-xl" />
            <AutomacoesAtivasBadge consultantId={consultantId} variant="chips" />
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
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl text-xs"
              onClick={refresh}
              title="Atualizar"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
          </div>
        </div>

        <AgendamentosTextosDialog
          open={textosOpen}
          onOpenChange={setTextosOpen}
          consultantId={consultantId}
        />

        {/* ── Regra de ouro da carteira ── */}
        <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-4 flex gap-3 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/60" />
          <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4.5 h-4.5 text-primary" />
          </div>
          <p className="text-[12.5px] text-foreground leading-relaxed">
            <strong className="font-[Sora,ui-sans-serif] font-semibold">
              Clientes da carteira iGreen nunca recebem nada automático.
            </strong>{" "}
            Reaquecimento, resgate e cutucada só rodam para leads do WhatsApp e cadastros manuais.
            A esteira 30/60/90/120 dias do pós-venda só começa quando o consultor (ou admin) clica em <em>Aprovado</em>.
          </p>
        </div>

        {/* ── CTA de validação pendente ── */}
        {stats.pendingValidation > 0 && (
          <button
            type="button"
            onClick={() => dispatchAgendamentosNav({ tab: "crm-clientes" })}
            className="group w-full text-left mb-5 rounded-2xl border border-warning/40 bg-gradient-to-r from-warning/15 via-warning/10 to-transparent p-4 flex items-center gap-4 hover:border-warning/60 hover:shadow-sm transition-all"
          >
            <div className="shrink-0 min-w-[64px] text-center">
              <div className="font-[Sora,ui-sans-serif] font-bold text-3xl md:text-4xl text-warning leading-none tabular-nums">
                {stats.pendingValidation}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-warning/80 font-medium mt-1">
                aguardando
              </div>
            </div>
            <div className="flex-1 min-w-0 border-l border-warning/20 pl-4">
              <p className="text-sm font-[Sora,ui-sans-serif] font-semibold text-foreground">
                {stats.pendingValidation === 1
                  ? "1 cliente aguardando sua validação"
                  : `${stats.pendingValidation} clientes aguardando sua validação`}
              </p>
              <p className="text-[11.5px] text-muted-foreground mt-1 leading-relaxed">
                Nenhuma mensagem sai para esses clientes até você abrir “Validar novos clientes” e confirmar aprovado ou reprovado.
              </p>
            </div>
            <ExternalLink className="w-4 h-4 text-warning shrink-0 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}

        {/* ── KPI strip ── */}
        <div className="mb-6 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border/40">
            {[
              { n: stats.timelineUpcoming, label: "Próximos envios", icon: Clock, tone: "text-primary", bg: "bg-primary/10" },
              { n: stats.pendingManual, label: "Agenda manual", icon: CalendarClock, tone: "text-warning", bg: "bg-warning/10" },
              { n: stats.posVendaUpcoming, label: "Pós-venda", icon: Sparkles, tone: "text-primary", bg: "bg-accent/10" },
              { n: stats.bulkActive, label: "Campanhas", icon: Megaphone, tone: "text-info", bg: "bg-info/10" },
            ].map((k) => {
              const Icon = k.icon;
              return (
                <div key={k.label} className="flex items-center gap-3 p-4">
                  <div className={`w-10 h-10 rounded-xl ${k.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4.5 h-4.5 ${k.tone}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-[Sora,ui-sans-serif] font-bold text-2xl text-foreground leading-none tabular-nums">
                      {k.n}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mt-1 truncate">
                      {k.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>


        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(normalizeHubTab(v as AgendamentosHubTab))} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/40 p-1">
            <TabsTrigger value="mapa" className="text-xs font-semibold">Mapa</TabsTrigger>
            <TabsTrigger value="grupo-a" className="text-xs">Grupo A</TabsTrigger>
            <TabsTrigger value="grupo-b" className="text-xs font-semibold">Grupo B</TabsTrigger>
            <TabsTrigger value="grupo-c" className="text-xs">Grupo C</TabsTrigger>
            <TabsTrigger value="agenda" className="text-xs">Agenda</TabsTrigger>
            <TabsTrigger value="carteira" className="text-xs">Carteira</TabsTrigger>
            <TabsTrigger value="historico" className="text-xs">Histórico</TabsTrigger>
          </TabsList>

          {/* ── Mapa A→B→C + fila ── */}
          <TabsContent value="mapa" className="space-y-6 mt-0">
            <Suspense fallback={<LoadingRow />}>
              <AgendamentosJornadaMap onGoTab={goTab} stats={stats} />
            </Suspense>
            <section className="border-t pt-6">
              {(() => {
                const filtered = timelineFilter === "all" ? timeline : timeline.filter((i) => i.kind === timelineFilter);
                const chips: Array<{ id: "all" | AgendamentoTimelineItem["kind"]; label: string }> = [
                  { id: "all", label: "Todos" },
                  { id: "cadence_send", label: "Motor A→B→C" },
                  { id: "manual_scheduled", label: "Manual" },
                  { id: "pos_venda_auto", label: "Pós-venda" },
                  { id: "bulk_campaign", label: "WA" },
                  { id: "voice_campaign", label: "Ligação" },
                  { id: "bot_followup", label: "Reaquecer" },
                ];
                return (
                  <>
                    <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
                      <div>
                        <h4 className="font-[Sora,ui-sans-serif] font-semibold text-foreground text-base">
                          Próximos envios
                        </h4>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {filtered.length === 0
                            ? "Nada na fila com esse filtro"
                            : `${filtered.length} ${filtered.length === 1 ? "envio programado" : "envios programados"}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {chips.map((c) => {
                          const active = timelineFilter === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setTimelineFilter(c.id)}
                              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium ${
                                active
                                  ? "bg-primary/15 border-primary/40 text-primary"
                                  : "bg-transparent border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                              }`}
                            >
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {loading ? (
                      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 px-6 py-12 text-center flex flex-col items-center gap-3">
                        <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center">
                          <CalendarClock className="w-7 h-7 text-muted-foreground/50" />
                        </div>
                        <div>
                          <p className="text-sm font-[Sora,ui-sans-serif] font-semibold text-foreground">
                            Fila limpa por aqui
                          </p>
                          <p className="text-[11.5px] text-muted-foreground mt-1 max-w-xs mx-auto">
                            Assim que algo for agendado — manual, pós-venda ou campanha — aparece nesta lista.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <ScrollArea className="max-h-[420px] pr-1">
                        <div className="relative">
                          {/* Linha vertical da timeline */}
                          <div className="absolute left-[46px] top-2 bottom-2 w-px bg-gradient-to-b from-border/60 via-border/40 to-transparent" />
                          <div className="space-y-1.5">
                            {filtered.slice(0, 30).map((item) => {
                              const d = item.at;
                              const pad = (n: number) => String(n).padStart(2, "0");
                              const dayLabel = format(d, "dd MMM", { locale: ptBR });
                              const timeLabel = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                              const dotColor =
                                item.kind === "pos_venda_auto"
                                  ? "bg-accent"
                                  : item.kind === "bot_followup"
                                  ? "bg-info"
                                  : item.kind === "bulk_campaign"
                                  ? "bg-warning"
                                  : item.kind === "voice_campaign"
                                  ? "bg-info"
                                  : "bg-primary";
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => {
                                    setSelected(item);
                                    if (item.kind === "manual_scheduled") {
                                      setEditText(item.preview || "");
                                      setEditAt(
                                        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                                      );
                                    }
                                  }}
                                  className="group relative w-full text-left rounded-xl border border-transparent hover:border-border/60 hover:bg-secondary/15 px-3 py-2.5 transition-colors flex items-start gap-3"
                                >
                                  {/* Horário */}
                                  <div className="w-[52px] shrink-0 text-right leading-tight pt-0.5">
                                    <div className="font-[Sora,ui-sans-serif] font-semibold text-xs text-foreground tabular-nums">
                                      {timeLabel}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide tabular-nums">
                                      {dayLabel}
                                    </div>
                                  </div>
                                  {/* Bolinha da timeline + ícone */}
                                  <div className="relative z-10 shrink-0 mt-1">
                                    <div className={`w-2.5 h-2.5 rounded-full ${dotColor} ring-4 ring-card`} />
                                  </div>
                                  {/* Conteúdo */}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-muted/40">
                                        {kindIcon(item.kind)}
                                      </span>
                                      <span className="text-[13px] font-[Sora,ui-sans-serif] font-semibold text-foreground truncate">
                                        {item.title}
                                      </span>
                                      <Badge variant="outline" className="text-[9px] border-border/60 text-muted-foreground">
                                        {item.badge}
                                      </Badge>
                                      {timelineStatusBadge(item.status)}
                                    </div>
                                    {item.preview && (
                                      <p className="text-[11.5px] text-muted-foreground line-clamp-2 mt-1 italic">
                                        “{item.preview}”
                                      </p>
                                    )}
                                  </div>
                                  <span className="hidden sm:inline text-[10px] text-muted-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity self-center whitespace-nowrap">
                                    abrir / excluir →
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </ScrollArea>
                    )}
                  </>
                );
              })()}
            </section>

            <section>
              <div className="flex items-end justify-between gap-2 mb-3">
                <div>
                  <h4 className="font-[Sora,ui-sans-serif] font-semibold text-foreground text-base">
                    O que está ligado
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Cada motor que pode rodar sozinho. Clique para configurar ou ligar/desligar.
                  </p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {sistemasAgendados.map((sys) => {
                  const Icon = sys.icon;
                  const hasCount = typeof sys.count === "number";
                  return (
                    <button
                      key={sys.id}
                      type="button"
                      onClick={sys.action}
                      className="group text-left rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm p-4 flex flex-col gap-3 hover:border-primary/40 hover:bg-card/80 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon className="w-5 h-5 text-primary" />
                        </div>
                        {sys.badge && (
                          <span
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                              sys.badgeOn
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-muted-foreground/30 bg-muted/30 text-muted-foreground"
                            }`}
                          >
                            {sys.badge}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="font-[Sora,ui-sans-serif] font-semibold text-sm text-foreground">
                            {sys.title}
                          </span>
                          {hasCount && (
                            <span className="font-[Sora,ui-sans-serif] font-bold text-xl text-foreground tabular-nums leading-none">
                              {sys.count}
                            </span>
                          )}
                        </div>
                        <p className="text-[11.5px] text-muted-foreground leading-relaxed line-clamp-3">
                          {sys.desc}
                        </p>
                        {sys.countLabel && hasCount && (
                          <p className="text-[10px] text-muted-foreground/70 italic mt-1">
                            {sys.count} {sys.countLabel}
                          </p>
                        )}
                      </div>
                      <span className="mt-auto text-[11px] font-medium text-primary inline-flex items-center gap-1 group-hover:gap-1.5 transition-all">
                        <Settings2 className="w-3.5 h-3.5" />
                        Abrir e configurar
                        <span className="transition-transform group-hover:translate-x-0.5">→</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-3">
                <h4 className="font-[Sora,ui-sans-serif] font-semibold text-foreground text-base flex items-center gap-2">
                  <Zap className="w-4 h-4 text-info" />
                  Dispara na hora
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-info/30 bg-info/10 text-info uppercase tracking-wider">
                    sem fila
                  </span>
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Não entram em "Próximos envios" porque não esperam horário. Aparecem no histórico depois que saem.
                </p>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                {disparoNaHora.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.title}
                      type="button"
                      onClick={item.action}
                      className="group text-left rounded-2xl border border-dashed border-border/50 bg-muted/10 p-4 flex flex-col gap-2 hover:border-info/40 hover:bg-info/5 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="w-9 h-9 rounded-xl bg-info/10 flex items-center justify-center shrink-0">
                          <Icon className="w-4.5 h-4.5 text-info" />
                        </div>
                        {item.badge && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-info/30 bg-info/5 text-info">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <div className="font-[Sora,ui-sans-serif] font-semibold text-[13px] text-foreground">
                        {item.title}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
                        {item.desc}
                      </p>
                      {item.action && (
                        <span className="mt-auto text-[11px] font-medium text-info inline-flex items-center gap-1 group-hover:gap-1.5 transition-all">
                          {item.actionLabel ?? "Abrir"}
                          <span className="transition-transform group-hover:translate-x-0.5">→</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </TabsContent>


          {/* ── Grupo A ── */}
          <TabsContent value="grupo-a" className="mt-0">
            <Suspense fallback={<LoadingRow />}>
              <AgendamentosGrupoAPanel />
            </Suspense>
          </TabsContent>

          {/* ── Grupo B — operação leads frios ── */}
          <TabsContent value="grupo-b" className="mt-0 h-[min(calc(100dvh-240px),760px)] min-h-[380px]">
            <Suspense fallback={<LoadingRow />}>
              <AgendamentosZeroLeadPanel consultantId={consultantId} onOpenChat={onOpenChat} />
            </Suspense>
          </TabsContent>

          {/* ── Grupo C — longo prazo ── */}
          <TabsContent value="grupo-c" className="mt-0">
            <Suspense fallback={<LoadingRow />}>
              <AgendamentosGrupoCPanel />
            </Suspense>
          </TabsContent>

          {/* ── Agenda (manual, pós-venda, campanhas…) ── */}
          <TabsContent value="agenda" className="mt-0 space-y-4">
            <Tabs value={agendaSub} onValueChange={(v) => setAgendaSub(v as typeof agendaSub)}>
              <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/30 p-1 mb-4">
                <TabsTrigger value="manual" className="text-[11px]">Manual</TabsTrigger>
                <TabsTrigger value="pos-venda" className="text-[11px]">Pós-venda</TabsTrigger>
                <TabsTrigger value="reaquecimento" className="text-[11px]">Reaquecimento</TabsTrigger>
                <TabsTrigger value="campanhas" className="text-[11px]">Campanhas</TabsTrigger>
                <TabsTrigger value="rodizios" className="text-[11px]">Rodízios</TabsTrigger>
              </TabsList>

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
                disabled={!channelReady.ok}
                title={channelBlockedReason || undefined}
              >
                <Plus className="w-4 h-4" />
                Agendar nova
              </Button>
            </div>

            {channelBlockedReason && (
              <p className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
                {channelBlockedReason} A lista do que já está agendado continua aparecendo. Se faltar
                comprovante de conexão ou outra pendência, resolva na aba Conversas e volte para agendar.
              </p>
            )}
            {channelReady.ok && (
              <p className="text-[11px] text-muted-foreground">
                Canal do consultor: <span className="font-semibold text-foreground">{channelReady.channel === "whapi" ? "Whapi" : "Evolution"}</span>
                {" · "}instância <code className="text-[10px]">{channelReady.instanceName}</code>
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
                  <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} min={nowLocalInputValue()} disabled={saving} className="rounded-xl" />
                  <p className="text-[10px] text-muted-foreground">Horário local (Brasília). O robô do servidor envia no horário mesmo com a aba fechada.</p>
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
              <MessageList messages={manual} onCancel={handleCancelManual} statusConfig={statusConfig} />
            )}
          </TabsContent>

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
              <PosVendaList items={posVenda} consultantId={consultantId} onSaved={refresh} />
            )}
          </TabsContent>

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

              <TabsContent value="campanhas" className="space-y-4 mt-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-bold">Campanhas</p>
                <p className="text-[11px] text-muted-foreground">
                  Disparo WhatsApp e campanhas de ligação (Velip) agendadas ou em andamento.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "whatsapp", whatsappSub: "envio_massa" })}>
                  <Megaphone className="w-3.5 h-3.5" /> WhatsApp
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => dispatchAgendamentosNav({ tab: "voz" })}>
                  <Phone className="w-3.5 h-3.5" /> Ligação
                </Button>
              </div>
            </div>

            {bulkCampaigns.length === 0 && voiceCampaigns.length === 0 ? (
              <EmptyState text="Nenhuma campanha agendada ou em andamento" />
            ) : (
              <div className="space-y-2">
                {voiceCampaigns.map((c) => (
                  <div key={`voice-${c.id}`} className="rounded-xl border border-info/20 bg-info/5 px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Phone className="w-3.5 h-3.5 text-info shrink-0" />
                      <span className="text-sm font-bold">{c.name}</span>
                      <Badge variant="secondary" className="text-[9px]">{campaignStatusLabel(c.status)}</Badge>
                      <Badge variant="outline" className="text-[9px]">Ligação</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.dialed} de {c.total} discados · {c.answered} atendidos · {c.failed} falhas
                    </p>
                    {c.scheduled_at && (
                      <p className="text-[11px] text-muted-foreground mt-1">Liga em: {formatScheduleDate(c.scheduled_at)}</p>
                    )}
                  </div>
                ))}
                {bulkCampaigns.map((c) => (
                  <div key={`bulk-${c.id}`} className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Megaphone className="w-3.5 h-3.5 text-warning shrink-0" />
                      <span className="text-sm font-bold">{c.name}</span>
                      <Badge variant="secondary" className="text-[9px]">{campaignStatusLabel(c.status)}</Badge>
                      <Badge variant="outline" className="text-[9px]">WhatsApp</Badge>
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

              <TabsContent value="rodizios" className="mt-0">
                <Suspense fallback={<LoadingRow />}>
                  <RodiziosBroadcastPanel consultantId={consultantId} />
                </Suspense>
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* ── Carteira iGreen ── */}
          <TabsContent value="carteira" className="mt-0">
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
        consultantId={consultantId}
        onClose={() => setSelected(null)}
        onGoToConfig={(tab) => {
          const subs = ["manual", "pos-venda", "reaquecimento", "campanhas", "rodizios"] as const;
          if ((subs as readonly string[]).includes(tab)) {
            setAgendaSub(tab as typeof agendaSub);
            goTab("agenda");
          } else {
            goTab(tab);
          }
          setSelected(null);
        }}
        editText={editText}
        setEditText={setEditText}
        editAt={editAt}
        setEditAt={setEditAt}
        savingEdit={savingEdit}
        deleting={deletingItem}
        onSaveManual={async () => {
          if (!selected || selected.kind !== "manual_scheduled") return;
          if (new Date(editAt).getTime() <= Date.now()) {
            toast({ title: "Escolha um horário no futuro", description: "A data informada já passou.", variant: "destructive" });
            return;
          }
          setSavingEdit(true);
          try {
            const id = selected.id.replace(/^manual-/, "");
            // Guarda contra corrida edição × execução: só salva se ainda
            // estiver pending. Se o robô já reivindicou (processing) ou já
            // enviou, nenhuma linha é afetada e avisamos.
            const { data, error } = await supabase
              .from("scheduled_messages")
              .update({
                message_text: editText,
                scheduled_at: new Date(editAt).toISOString(),
              })
              .eq("id", id)
              .eq("status", "pending")
              .select("id");
            if (error) throw error;
            if (!data || data.length === 0) {
              toast({ title: "Não foi possível editar", description: "Esta mensagem já foi enviada ou está saindo agora.", variant: "destructive" });
            } else {
              toast({ title: "Agendamento atualizado" });
            }
            setSelected(null);
            refresh();
          } catch {
            toast({ title: "Erro ao atualizar", variant: "destructive" });
          } finally {
            setSavingEdit(false);
          }
        }}
        onDelete={async () => {
          if (!selected) return;
          await handleDeleteTimelineItem(selected);
        }}
      />
    </div>
  );
}

function TimelineItemDialog({
  item, consultantId, onClose, onGoToConfig,
  editText, setEditText, editAt, setEditAt, savingEdit, deleting, onSaveManual, onDelete,
}: {
  item: AgendamentoTimelineItem | null;
  consultantId: string;
  onClose: () => void;
  onGoToConfig: (tab: AgendamentosHubTab) => void;
  editText: string;
  setEditText: (v: string) => void;
  editAt: string;
  setEditAt: (v: string) => void;
  savingEdit: boolean;
  deleting: boolean;
  onSaveManual: () => void;
  onDelete: () => void;
}) {
  const [posDefault, setPosDefault] = useState<PosVendaMediaBits | null>(null);
  const [posOwn, setPosOwn] = useState<PosVendaMediaBits | null>(null);
  const [posMediaLoading, setPosMediaLoading] = useState(false);

  useEffect(() => {
    if (!item || item.kind !== "pos_venda_auto") {
      setPosDefault(null);
      setPosOwn(null);
      return;
    }
    const parsed = parsePosVendaTimelineId(item.id);
    if (!parsed) return;
    let alive = true;
    setPosMediaLoading(true);
    const defaultStage = stageKeyToDefaultStage(parsed.stageKey);
    void (async () => {
      const [defRes, stageRes] = await Promise.all([
        supabase
          .from("pos_venda_default_media")
          .select("message_text, media_url, image_url, message_type, is_active")
          .eq("stage", defaultStage)
          .maybeSingle(),
        supabase
          .from("kanban_stages")
          .select("auto_message_text, auto_message_media_url, auto_message_image_url, auto_message_type")
          .eq("consultant_id", consultantId)
          .eq("stage_scope", "pos_venda")
          .eq("stage_key", parsed.stageKey)
          .maybeSingle(),
      ]);
      if (!alive) return;
      if (defRes.data && defRes.data.is_active !== false) {
        setPosDefault({
          message_text: defRes.data.message_text,
          media_url: defRes.data.media_url,
          image_url: defRes.data.image_url,
          message_type: defRes.data.message_type,
        });
      } else {
        setPosDefault(null);
      }
      const pick = stageRes.data as {
        auto_message_text: string | null;
        auto_message_media_url: string | null;
        auto_message_image_url: string | null;
        auto_message_type: string | null;
      } | null;
      if (pick && (pick.auto_message_media_url || pick.auto_message_image_url)) {
        setPosOwn({
          message_text: pick.auto_message_text,
          media_url: pick.auto_message_media_url,
          image_url: pick.auto_message_image_url,
          message_type: pick.auto_message_type,
        });
      } else {
        setPosOwn(null);
      }
      setPosMediaLoading(false);
    })();
    return () => { alive = false; };
  }, [item, consultantId]);

  if (!item) return null;
  const src = describeSource(item);
  const isManual = item.kind === "manual_scheduled";
  const isPosVenda = item.kind === "pos_venda_auto";
  const showDefault = isPosVenda && !posOwn && !!posDefault;

  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
                  min={nowLocalInputValue()}
                  onChange={(e) => setEditAt(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">Horário local (Brasília).</p>
              </div>
            </div>
          ) : isPosVenda ? (
            <div className="space-y-3">
              {posMediaLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando áudio/imagem…
                </div>
              ) : (
                <>
                  {showDefault && (
                    <PosVendaMediaPreview
                      label="Padrão iGreen (em uso)"
                      hint="Áudio + imagem institucionais até o consultor colocar o próprio material."
                      bits={posDefault}
                    />
                  )}
                  {posOwn && (
                    <PosVendaMediaPreview
                      label="Material do consultor"
                      bits={posOwn}
                    />
                  )}
                  {!showDefault && !posOwn && item.preview && (
                    <div className="rounded-xl border border-border/40 bg-secondary/10 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Prévia</p>
                      <p className="text-sm whitespace-pre-wrap">{item.preview}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : item.preview || item.audio_url || item.buttons?.length ? (
            <div className="rounded-xl border border-border/40 bg-secondary/10 p-3 space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Prévia</p>
              {item.preview && (
                <p className="text-sm whitespace-pre-wrap">{item.preview}</p>
              )}
              {item.audio_url && (
                <audio controls src={item.audio_url} className="w-full h-9" preload="none" />
              )}
              {item.buttons && item.buttons.length > 0 && (
                <div className="pt-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Botões do WhatsApp</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.buttons.map((b) => (
                      <span
                        key={b.id}
                        className="inline-flex items-center rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-medium text-primary"
                      >
                        {b.title}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 flex-wrap sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive gap-1.5"
            onClick={onDelete}
            disabled={deleting || savingEdit}
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Excluir agendamento
          </Button>
          <div className="flex flex-wrap gap-2">
            {isManual && (
              <Button onClick={onSaveManual} disabled={savingEdit || deleting || !editText.trim() || !editAt} className="gap-1.5">
                {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Salvar mudanças
              </Button>
            )}
            <Button variant="outline" onClick={() => onGoToConfig(src.targetTab)} className="gap-1.5" disabled={deleting}>
              <Settings2 className="w-3.5 h-3.5" />
              {src.ctaLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** pv_d120 → d120 (chave em pos_venda_default_media). */
function stageKeyToDefaultStage(stageKey: string): string {
  return stageKey.replace(/^pv_/, "");
}

type PosVendaMediaBits = {
  message_text: string | null;
  media_url: string | null;
  image_url: string | null;
  message_type?: string | null;
};

/** Prévia de texto + áudio + imagem (padrão iGreen ou do consultor). */
function PosVendaMediaPreview({
  label,
  hint,
  bits,
}: {
  label: string;
  hint?: string;
  bits: PosVendaMediaBits | null;
}) {
  if (!bits) return null;
  const hasAnything = !!(bits.message_text || bits.media_url || bits.image_url);
  if (!hasAnything) return null;
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-3 space-y-2.5">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {bits.message_text && (
        <p className="text-sm whitespace-pre-wrap text-foreground">{bits.message_text}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        {bits.image_url && (
          <div className="shrink-0 space-y-1">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> Imagem
            </p>
            <img
              src={bits.image_url}
              alt=""
              className="h-24 w-24 rounded-lg object-cover border border-border/50"
            />
          </div>
        )}
        {bits.media_url && (
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Volume2 className="w-3 h-3" /> Áudio
            </p>
            <audio controls preload="metadata" src={bits.media_url} className="w-full max-w-sm h-9" />
          </div>
        )}
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

function PosVendaList({
  items,
  consultantId,
  onSaved,
}: {
  items: import("@/lib/posVendaSchedule").UpcomingPosVendaItem[];
  consultantId: string;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<import("@/lib/posVendaSchedule").UpcomingPosVendaItem | null>(null);
  const [stageRow, setStageRow] = useState<{
    id: string;
    auto_message_text: string | null;
    auto_message_enabled: boolean;
    auto_message_media_url: string | null;
    auto_message_image_url: string | null;
    auto_message_type: string | null;
  } | null>(null);
  const [defaultBits, setDefaultBits] = useState<PosVendaMediaBits | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const stageKey = selected ? parsePosVendaTimelineId(selected.id)?.stageKey ?? null : null;

  useEffect(() => {
    if (!selected || !stageKey) return;
    setLoading(true);
    setStageRow(null);
    setDefaultBits(null);
    const defaultStage = stageKeyToDefaultStage(stageKey);

    void (async () => {
      const [stageRes, defRes] = await Promise.all([
        supabase
          .from("kanban_stages")
          .select("id, auto_message_text, auto_message_enabled, auto_message_media_url, auto_message_image_url, auto_message_type")
          .eq("consultant_id", consultantId)
          .eq("stage_scope", "pos_venda")
          .eq("stage_key", stageKey)
          .maybeSingle(),
        supabase
          .from("pos_venda_default_media")
          .select("message_text, media_url, image_url, message_type, is_active")
          .eq("stage", defaultStage)
          .maybeSingle(),
      ]);

      const data = stageRes.data as typeof stageRow;
      if (data) {
        setStageRow(data);
        const ownText = data.auto_message_text?.trim();
        setDraftText(ownText || defRes.data?.message_text || selected.messagePreview || "");
        setDraftEnabled(data.auto_message_enabled ?? true);
      } else {
        setDraftText(defRes.data?.message_text || selected.messagePreview || "");
        setDraftEnabled(true);
      }

      if (defRes.data && defRes.data.is_active !== false) {
        setDefaultBits({
          message_text: defRes.data.message_text,
          media_url: defRes.data.media_url,
          image_url: defRes.data.image_url,
          message_type: defRes.data.message_type,
        });
      }
      setLoading(false);
    })();
  }, [selected, stageKey, consultantId]);

  const ownMedia: PosVendaMediaBits | null = stageRow && (stageRow.auto_message_media_url || stageRow.auto_message_image_url || stageRow.auto_message_text)
    ? {
        message_text: stageRow.auto_message_text,
        media_url: stageRow.auto_message_media_url,
        image_url: stageRow.auto_message_image_url,
        message_type: stageRow.auto_message_type,
      }
    : null;

  const hasOwnMediaFiles = !!(stageRow?.auto_message_media_url || stageRow?.auto_message_image_url);
  const showingDefaultMedia = !hasOwnMediaFiles && !!defaultBits;

  async function handleSave() {
    if (!stageRow) {
      toast({ title: "Coluna não encontrada", description: "Abra Autoprogressão para editar todas as colunas.", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Se o consultor ainda não tem áudio/imagem próprios, copia o padrão
    // ao salvar o texto — senão o motor deixa de usar o fallback e some a mídia.
    const mediaUrl = stageRow.auto_message_media_url || defaultBits?.media_url || null;
    const imageUrl = stageRow.auto_message_image_url || defaultBits?.image_url || null;
    const msgType =
      stageRow.auto_message_type ||
      (mediaUrl ? (defaultBits?.message_type || "audio") : "text");

    const { error } = await supabase
      .from("kanban_stages")
      .update({
        auto_message_text: draftText || null,
        auto_message_enabled: draftEnabled,
        auto_message_media_url: mediaUrl,
        auto_message_image_url: imageUrl,
        auto_message_type: msgType,
      } as any)
      .eq("id", stageRow.id);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Mensagem atualizada" });
    setSelected(null);
    onSaved();
  }

  return (
    <>
      <ScrollArea className="max-h-[400px]">
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item)}
              className={`w-full text-left rounded-xl border px-4 py-3 transition-colors hover:border-primary/40 ${item.isOverdue ? "border-warning/30 bg-warning/5" : "border-accent/20 bg-accent/5"}`}
            >
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-sm font-bold">{item.customerName}</span>
                <Badge className="text-[9px] bg-primary/10 text-primary border-primary/30">{item.stageLabel}</Badge>
                <span className="ml-auto text-[10px] text-muted-foreground opacity-70">clique para editar</span>
              </div>
              {item.messagePreview && <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{item.messagePreview}</p>}
              <p className="text-[11px] text-muted-foreground">{formatScheduleDate(item.scheduledAt)}</p>
            </button>
          ))}
        </div>
      </ScrollArea>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  {selected.customerName}
                </DialogTitle>
                <DialogDescription>
                  {formatScheduleDate(selected.scheduledAt)} · {selected.stageLabel}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Onde está configurado</p>
                  <p className="text-sm font-semibold">Pós-venda automático → coluna “{selected.stageLabel}”</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enquanto você não sobe o seu áudio/imagem, o sistema usa o padrão iGreen (texto + áudio + imagem). Troque o seu material em Autoprogressão.
                  </p>
                </div>

                {loading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando configuração da coluna…
                  </div>
                ) : (
                  <>
                    {showingDefaultMedia && (
                      <PosVendaMediaPreview
                        label="Padrão iGreen (em uso)"
                        hint="Vale para todos os clientes desta coluna até você colocar o seu áudio/imagem."
                        bits={defaultBits}
                      />
                    )}
                    {hasOwnMediaFiles && (
                      <PosVendaMediaPreview
                        label="Seu material"
                        hint="Configurado na Autoprogressão desta coluna."
                        bits={ownMedia}
                      />
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-xs">Texto da mensagem</Label>
                      <Textarea
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        rows={4}
                        className="text-sm"
                        placeholder="Digite o texto que sai automaticamente…"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draftEnabled}
                        onChange={(e) => setDraftEnabled(e.target.checked)}
                        className="rounded"
                      />
                      Envio automático desta coluna ligado
                    </label>
                  </>
                )}
              </div>

              <DialogFooter className="gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  onClick={() => {
                    dispatchAgendamentosNav({ tab: "crm-clientes" });
                    setSelected(null);
                  }}
                  className="gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Trocar áudio/imagem (Autoprogressão)
                </Button>
                <Button onClick={handleSave} disabled={saving || loading} className="gap-1.5">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Salvar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MessageList({
  messages,
  onCancel,
  statusConfig,
}: {
  messages: import("@/lib/agendamentosHub").ScheduledMessageRow[];
  onCancel: (id: string) => void;
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
                  <Button variant="ghost" size="icon" title="Cancelar envio (fica no histórico como Cancelada)" className="h-8 w-8 text-destructive/60 hover:text-destructive shrink-0" onClick={() => onCancel(msg.id)}>
                    <XCircle className="w-3.5 h-3.5" />
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
