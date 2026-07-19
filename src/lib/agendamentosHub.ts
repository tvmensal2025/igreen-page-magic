import type { UpcomingPosVendaItem } from "@/lib/posVendaSchedule";

export type AgendamentoTimelineKind =
  | "manual_scheduled"
  | "pos_venda_auto"
  | "bot_followup"
  | "bulk_campaign"
  | "voice_campaign"
  | "cadence_send";

export type AgendamentoTimelineStatus = "pending" | "overdue" | "running" | "sent" | "failed";

export interface AgendamentoTimelineItem {
  id: string;
  kind: AgendamentoTimelineKind;
  title: string;
  preview?: string | null;
  audio_url?: string | null;
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

/** Campanha PSTN (Velip) — mesma forma útil para timeline/listagem. */
export interface VoiceCampaignRow {
  id: string;
  name: string;
  status: string;
  total: number;
  dialed: number;
  answered: number;
  failed: number;
  scheduled_at: string | null;
  started_at: string | null;
  created_at: string;
}

/** Linha do motor de cadência (A→B→C) — 1 lead = 1 próximo envio programado. */
export interface CadenceScheduleRow {
  id: string;
  customer_id: string;
  stage: string;
  next_action_at: string;
  paused_until: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
}

/** Traduz o código do estágio do motor para o que o consultor entende. */
export function cadenceStageLabel(stage: string): { channel: "WhatsApp" | "Ligação" | "SMS" | "Meta" | "Sofia"; label: string } {
  if (stage.startsWith("COLD_")) return { channel: "WhatsApp", label: `WhatsApp reengajamento ${stage.replace("COLD_", "")}` };
  if (stage.startsWith("CALL_")) return { channel: "Ligação", label: `Ligação Sofia ${stage.replace("CALL_", "")}` };
  if (stage === "SMS_TEMA_2") return { channel: "SMS", label: "SMS tema · Dia 2" };
  if (stage === "SMS_TEMA_7") return { channel: "SMS", label: "SMS tema · Dia 7" };
  if (stage.startsWith("SMS_")) return { channel: "SMS", label: `SMS ${stage.replace("SMS_", "")}` };
  if (stage === "META") return { channel: "Meta", label: "Retargeting Meta" };
  if (stage === "AI_QUALIFYING") return { channel: "Sofia", label: "Sofia qualificando" };
  if (stage === "GREETED") return { channel: "Sofia", label: "Sofia inicial" };
  return { channel: "WhatsApp", label: stage };
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
  | "mapa"
  | "grupo-a"
  | "grupo-b"
  | "grupo-c"
  | "agenda"
  | "carteira"
  | "historico"
  /** @deprecated use mapa */
  | "overview"
  /** @deprecated use grupo-b */
  | "leads-frios"
  /** @deprecated use agenda */
  | "manual"
  | "pos-venda"
  | "reaquecimento"
  | "campanhas"
  | "rodizios"
  /** @deprecated use carteira */
  | "igreen";

export interface AgendamentosNavDetail {
  tab: string;
  whatsappSub?: string;
  conversaoView?: string;
  hubTab?: AgendamentosHubTab;
}

export function dispatchAgendamentosNav(detail: AgendamentosNavDetail) {
  window.dispatchEvent(new CustomEvent("igreen-admin-nav", { detail }));
}

export interface CadenceStageInfo {
  message_text: string | null;
  audio_url: string | null;
}

export function buildAgendamentosTimeline(input: {
  manual: ScheduledMessageRow[];
  posVenda: UpcomingPosVendaItem[];
  botFollowups: BotFollowupRow[];
  bulk: BulkCampaignRow[];
  voice?: VoiceCampaignRow[];
  cadence?: CadenceScheduleRow[];
  cadenceStageInfo?: Record<string, CadenceStageInfo>;
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
      badge: "Agenda manual",
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
      badge: "Reaquecimento",
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
      badge:
        c.status === "scheduled" ? "Campanha WA agendada"
        : c.status === "paused" ? "Campanha WA pausada — precisa de atenção"
        : "Campanha WA em andamento",
    });
  }

  for (const c of input.voice || []) {
    const at = c.scheduled_at
      ? new Date(c.scheduled_at)
      : c.started_at
        ? new Date(c.started_at)
        : new Date(c.created_at);
    items.push({
      id: `voice-${c.id}`,
      kind: "voice_campaign",
      title: c.name || "Campanha de ligação",
      preview: `${c.dialed}/${c.total} discados · ${c.answered} atendidos`,
      at,
      status: c.status === "running" ? "running" : "pending",
      badge:
        c.status === "scheduled" ? "Ligação agendada"
        : c.status === "paused" ? "Ligação pausada — precisa de atenção"
        : "Ligação em andamento",
    });
  }

  for (const c of input.cadence || []) {
    const at = new Date(c.next_action_at);
    const paused = c.paused_until && new Date(c.paused_until).getTime() > now;
    const { channel, label } = cadenceStageLabel(c.stage);
    items.push({
      id: `cadence-${c.id}`,
      kind: "cadence_send",
      title: c.customer_name || c.customer_phone || "Lead",
      preview: `${channel} · ${label}`,
      at,
      status: paused ? "pending" : at.getTime() <= now ? "overdue" : "pending",
      badge: `Motor A→B→C · ${label}`,
    });
  }

  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}
