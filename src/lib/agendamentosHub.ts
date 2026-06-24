import type { UpcomingPosVendaItem } from "@/lib/posVendaSchedule";

export type AgendamentoTimelineKind =
  | "manual_scheduled"
  | "pos_venda_auto"
  | "bot_followup"
  | "bulk_campaign";

export type AgendamentoTimelineStatus = "pending" | "overdue" | "running" | "sent" | "failed";

export interface AgendamentoTimelineItem {
  id: string;
  kind: AgendamentoTimelineKind;
  title: string;
  preview?: string | null;
  at: Date;
  status: AgendamentoTimelineStatus;
  badge: string;
}

export interface ScheduledMessageRow {
  id: string;
  remote_jid: string;
  message_text: string;
  scheduled_at: string;
  status: string;
  sent_at: string | null;
}

export interface BotFollowupRow {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  next_followup_at: string;
  conversation_step: string | null;
}

export interface BulkCampaignRow {
  id: string;
  name: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  scheduled_at: string | null;
  started_at: string | null;
}

export interface ReactivationSettingsSummary {
  auto_enabled: boolean;
  horas_ate_primeiro_followup: number;
  max_envios: number;
  horas_entre_envios: number;
  janela_inicio: number;
  janela_fim: number;
  enviar_fim_de_semana: boolean;
}

export const DEFAULT_REACTIVATION_SETTINGS: ReactivationSettingsSummary = {
  auto_enabled: false,
  horas_ate_primeiro_followup: 24,
  max_envios: 3,
  horas_entre_envios: 48,
  janela_inicio: 9,
  janela_fim: 20,
  enviar_fim_de_semana: false,
};

export type AgendamentosHubTab =
  | "overview"
  | "fila"
  | "pos-venda"
  | "conversao"
  | "bulk"
  | "historico";

export interface AgendamentosNavDetail {
  tab: string;
  whatsappSub?: string;
  conversaoView?: string;
  hubTab?: AgendamentosHubTab;
}

export function dispatchAgendamentosNav(detail: AgendamentosNavDetail) {
  window.dispatchEvent(new CustomEvent("igreen-admin-nav", { detail }));
}

export function buildAgendamentosTimeline(input: {
  manual: ScheduledMessageRow[];
  posVenda: UpcomingPosVendaItem[];
  botFollowups: BotFollowupRow[];
  bulk: BulkCampaignRow[];
}): AgendamentoTimelineItem[] {
  const now = Date.now();
  const items: AgendamentoTimelineItem[] = [];

  for (const m of input.manual) {
    if (m.status !== "pending") continue;
    const at = new Date(m.scheduled_at);
    items.push({
      id: `manual-${m.id}`,
      kind: "manual_scheduled",
      title: m.remote_jid.split("@")[0],
      preview: m.message_text,
      at,
      status: at.getTime() <= now ? "overdue" : "pending",
      badge: "Fila manual",
    });
  }

  for (const p of input.posVenda) {
    items.push({
      id: p.id,
      kind: "pos_venda_auto",
      title: p.customerName,
      preview: p.messagePreview,
      at: p.scheduledAt,
      status: p.isOverdue ? "overdue" : "pending",
      badge: p.stageLabel,
    });
  }

  for (const b of input.botFollowups) {
    const at = new Date(b.next_followup_at);
    items.push({
      id: `followup-${b.id}`,
      kind: "bot_followup",
      title: b.name || b.phone_whatsapp || "Lead",
      preview: b.conversation_step ? `Passo: ${b.conversation_step}` : null,
      at,
      status: at.getTime() <= now ? "overdue" : "pending",
      badge: "Follow-up bot",
    });
  }

  for (const c of input.bulk) {
    const at = c.scheduled_at ? new Date(c.scheduled_at) : c.started_at ? new Date(c.started_at) : new Date();
    items.push({
      id: `bulk-${c.id}`,
      kind: "bulk_campaign",
      title: c.name || "Campanha",
      preview: `${c.sent}/${c.total} enviados`,
      at,
      status: c.status === "running" ? "running" : "pending",
      badge: c.status === "scheduled" ? "Disparo PRO agendado" : "Disparo PRO",
    });
  }

  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}
