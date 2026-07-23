import type { UpcomingPosVendaItem } from "@/lib/posVendaSchedule";
import { cadenceStageGroup, labelCadenceStage, type CadenceStageGroup } from "@/lib/cadenceStageLabels";
import { STAGE_CHANNEL } from "@/lib/cadencePreview";

export type AgendamentoTimelineKind =
  | "manual_scheduled"
  | "pos_venda_auto"
  | "bot_followup"
  | "bulk_campaign"
  | "voice_campaign"
  | "cadence_send"
  | "daily_reheat"
  | "pending_media"
  | "voice_retry";

export type AgendamentoTimelineStatus = "pending" | "overdue" | "running" | "sent" | "failed";

export type AgendamentoChannel = "whatsapp" | "sms" | "voice" | "meta" | "sofia" | "mixed";

export type AgendamentoPizzaGroup = "A" | "B" | "C" | null;

export interface CadenceButton {
  id: string;
  title: string;
}

export interface AgendamentoTimelineItem {
  id: string;
  kind: AgendamentoTimelineKind;
  title: string;
  preview?: string | null;
  audio_url?: string | null;
  buttons?: CadenceButton[] | null;
  at: Date;
  status: AgendamentoTimelineStatus;
  badge: string;
  /** Canal principal do envio. */
  channel: AgendamentoChannel;
  /** Fatia da pizza quando vem do motor / reheat. */
  pizzaGroup: AgendamentoPizzaGroup;
  customerId?: string | null;
  phone?: string | null;
  motorLabel: string;
  /** Chips do passo atual (ex. reheat planned_actions). */
  actionsPreview?: string[] | null;
  stage?: string | null;
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

/** Fila diária A/B (daily_reheat_queue). */
export interface DailyReheatRow {
  id: string;
  customer_id: string;
  queue: string;
  step: string;
  status: string;
  next_action_at: string;
  planned_actions: unknown;
  customer_name?: string | null;
  customer_phone?: string | null;
}

/** Cauda de mídia WA do bot conversacional. */
export interface PendingMediaRow {
  id: string | number;
  customer_id: string | null;
  scheduled_for: string;
  payload: unknown;
  customer_name?: string | null;
  customer_phone?: string | null;
}

/** Retry individual de campanha de voz. */
export interface VoiceRetryRow {
  id: string;
  campaign_id: string;
  campaign_name?: string | null;
  customer_id: string | null;
  name: string | null;
  phone: string | null;
  status: string;
  next_attempt_at: string;
  attempts: number;
  max_attempts: number;
}

/** Traduz o código do estágio do motor para o que o consultor entende. */
export function cadenceStageLabel(stage: string): {
  channel: "WhatsApp" | "Ligação" | "SMS" | "Meta" | "Sofia";
  label: string;
} {
  if (stage.startsWith("COLD_")) return { channel: "WhatsApp", label: `WhatsApp reengajamento ${stage.replace("COLD_", "")}` };
  if (stage.startsWith("CALL_")) return { channel: "Ligação", label: `Ligação Sofia ${stage.replace("CALL_", "")}` };
  if (stage === "SMS_TEMA_2") return { channel: "SMS", label: "SMS tema · Dia 2" };
  if (stage === "SMS_TEMA_7") return { channel: "SMS", label: "SMS tema · Dia 7" };
  if (stage.startsWith("SMS_")) return { channel: "SMS", label: `SMS ${stage.replace("SMS_", "")}` };
  if (stage === "META" || stage.startsWith("RETARGET_")) return { channel: "Meta", label: "Retargeting Meta" };
  if (stage === "AI_QUALIFYING") return { channel: "Sofia", label: "Sofia qualificando" };
  if (stage === "GREETED") return { channel: "Sofia", label: "Aguardando resposta" };
  if (stage === "NEW") return { channel: "Sofia", label: "Entrada no ciclo" };
  if (stage === "A_NUDGE") return { channel: "WhatsApp", label: "Grupo A · retomada" };
  if (stage === "A_SMS") return { channel: "SMS", label: "Grupo A · SMS reforço" };
  if (stage === "A_CALL") return { channel: "Ligação", label: "Grupo A · ligação" };
  if (stage === "A_CALL_RETRY") return { channel: "Ligação", label: "Grupo A · fecha A" };
  return { channel: "WhatsApp", label: labelCadenceStage(stage, "short") };
}

export function channelFromCadenceStage(stage: string): AgendamentoChannel {
  const ch = STAGE_CHANNEL[stage];
  if (ch === "whatsapp") return "whatsapp";
  if (ch === "sms") return "sms";
  if (ch === "voice") return "voice";
  if (ch === "meta_audience") return "meta";
  if (ch === "system") return "sofia";
  const legacy = cadenceStageLabel(stage).channel;
  if (legacy === "WhatsApp") return "whatsapp";
  if (legacy === "SMS") return "sms";
  if (legacy === "Ligação") return "voice";
  if (legacy === "Meta") return "meta";
  return "sofia";
}

export function pizzaGroupFromCadence(stage: string): AgendamentoPizzaGroup {
  const g = cadenceStageGroup(stage);
  if (g === "A" || g === "B" || g === "C") return g;
  return null;
}

const REHEAT_ACTION_LABEL: Record<string, string> = {
  open_attendance: "Abrir atendimento",
  send_audio: "Áudio",
  start_flow: "Fluxo",
  call: "Ligação",
  sms: "SMS",
  close_rating: "Encerrar",
  wait: "Espera",
};

export function normalizePlannedActions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => String(a || "").trim())
    .filter(Boolean)
    .map((a) => REHEAT_ACTION_LABEL[a] || a);
}

export function channelFromPlannedActions(actions: string[]): AgendamentoChannel {
  const lower = actions.map((a) => a.toLowerCase());
  const hasCall = lower.some((a) => a.includes("liga") || a === "call");
  const hasSms = lower.some((a) => a.includes("sms"));
  const hasWa = lower.some(
    (a) => a.includes("áudio") || a.includes("audio") || a.includes("fluxo") || a.includes("flow") || a.includes("atendimento"),
  );
  const n = [hasCall, hasSms, hasWa].filter(Boolean).length;
  if (n > 1) return "mixed";
  if (hasCall) return "voice";
  if (hasSms) return "sms";
  if (hasWa) return "whatsapp";
  return "whatsapp";
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
  | "futuros"
  | "carteira"
  | "historico"
  | "numeros-invalidos"
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
  buttons: CadenceButton[] | null;
}

function statusAt(at: Date, now: number, running = false): AgendamentoTimelineStatus {
  if (running) return "running";
  return at.getTime() <= now ? "overdue" : "pending";
}

/** Remove reheat quando o mesmo customer já tem cadência na mesma janela (~2h). */
function dedupeReheatAgainstCadence(
  items: AgendamentoTimelineItem[],
): AgendamentoTimelineItem[] {
  const cadenceByCustomer = new Map<string, number>();
  for (const it of items) {
    if (it.kind !== "cadence_send" || !it.customerId) continue;
    cadenceByCustomer.set(it.customerId, it.at.getTime());
  }
  return items.filter((it) => {
    if (it.kind !== "daily_reheat" || !it.customerId) return true;
    const cadAt = cadenceByCustomer.get(it.customerId);
    if (cadAt == null) return true;
    return Math.abs(cadAt - it.at.getTime()) > 2 * 3600_000;
  });
}

export function buildAgendamentosTimeline(input: {
  manual: ScheduledMessageRow[];
  posVenda: UpcomingPosVendaItem[];
  botFollowups: BotFollowupRow[];
  bulk: BulkCampaignRow[];
  voice?: VoiceCampaignRow[];
  cadence?: CadenceScheduleRow[];
  cadenceStageInfo?: Record<string, CadenceStageInfo>;
  dailyReheat?: DailyReheatRow[];
  pendingMedia?: PendingMediaRow[];
  voiceRetries?: VoiceRetryRow[];
}): AgendamentoTimelineItem[] {
  const now = Date.now();
  const items: AgendamentoTimelineItem[] = [];

  for (const m of input.manual) {
    if (m.status !== "pending") continue;
    const at = new Date(m.scheduled_at);
    const phone = m.remote_jid.split("@")[0] || null;
    items.push({
      id: `manual-${m.id}`,
      kind: "manual_scheduled",
      title: phone || "Agenda",
      preview: m.message_text,
      at,
      status: statusAt(at, now),
      badge: "Agenda manual",
      channel: "whatsapp",
      pizzaGroup: null,
      phone,
      motorLabel: "Agenda manual",
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
      channel: "whatsapp",
      pizzaGroup: null,
      customerId: p.customerId,
      motorLabel: "Pós-venda",
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
      status: statusAt(at, now),
      badge: "Follow-up bot",
      channel: "whatsapp",
      pizzaGroup: "A",
      customerId: b.id,
      phone: b.phone_whatsapp,
      motorLabel: "Follow-up bot",
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
      channel: "whatsapp",
      pizzaGroup: null,
      motorLabel: "Campanha WA",
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
      channel: "voice",
      pizzaGroup: null,
      motorLabel: "Campanha de ligação",
    });
  }

  for (const c of input.cadence || []) {
    const at = new Date(c.next_action_at);
    const paused = c.paused_until && new Date(c.paused_until).getTime() > now;
    const { channel: chLabel, label } = cadenceStageLabel(c.stage);
    const info = input.cadenceStageInfo?.[c.stage];
    const name = c.customer_name || "";
    const rendered = info?.message_text
      ? info.message_text
          .replace(/\{\{\s*nome\s*\}\}/gi, name || "cliente")
          .replace(/\{\{\s*consultor\s*\}\}/gi, "seu consultor")
          .replace(/\{\{\s*assistente\s*\}\}/gi, "Sofia")
      : null;
    const pizza = pizzaGroupFromCadence(c.stage);
    items.push({
      id: `cadence-${c.id}`,
      kind: "cadence_send",
      title: c.customer_name || c.customer_phone || "Lead",
      preview: rendered || `${chLabel} · ${label}`,
      audio_url: info?.audio_url ?? null,
      buttons: info?.buttons ?? null,
      at,
      status: paused ? "pending" : statusAt(at, now),
      badge: `Motor A→B→C · ${label}`,
      channel: channelFromCadenceStage(c.stage),
      pizzaGroup: pizza,
      customerId: c.customer_id,
      phone: c.customer_phone,
      motorLabel: "Motor A→B→C",
      stage: c.stage,
    });
  }

  for (const r of input.dailyReheat || []) {
    if (r.status !== "planned" && r.status !== "claimed") continue;
    const at = new Date(r.next_action_at);
    const actions = normalizePlannedActions(r.planned_actions);
    const q = String(r.queue || "").toUpperCase();
    const pizza: AgendamentoPizzaGroup = q === "A" || q === "B" ? q : null;
    items.push({
      id: `reheat-${r.id}`,
      kind: "daily_reheat",
      title: r.customer_name || r.customer_phone || "Lead",
      preview: actions.length ? actions.join(" → ") : `Passo ${r.step}`,
      at,
      status: r.status === "claimed" ? "running" : statusAt(at, now),
      badge: `Reheat diário · fila ${q || "?"}`,
      channel: channelFromPlannedActions(actions),
      pizzaGroup: pizza,
      customerId: r.customer_id,
      phone: r.customer_phone,
      motorLabel: "Reheat diário",
      actionsPreview: actions.length ? actions : null,
      stage: r.step,
    });
  }

  for (const m of input.pendingMedia || []) {
    const at = new Date(m.scheduled_for);
    const payload = m.payload as { items?: unknown[]; remote_jid?: string } | null;
    const nItems = Array.isArray(payload?.items) ? payload!.items!.length : 0;
    const jidPhone = payload?.remote_jid?.split("@")[0] || null;
    items.push({
      id: `media-${m.id}`,
      kind: "pending_media",
      title: m.customer_name || m.customer_phone || jidPhone || "Lead",
      preview: nItems > 0 ? `${nItems} mídia(s) na fila do bot` : "Fila de mídia (bot)",
      at,
      status: statusAt(at, now),
      badge: "Fila de mídia (bot)",
      channel: "whatsapp",
      pizzaGroup: "A",
      customerId: m.customer_id,
      phone: m.customer_phone || jidPhone,
      motorLabel: "Fila de mídia (bot)",
    });
  }

  for (const v of input.voiceRetries || []) {
    const at = new Date(v.next_attempt_at);
    items.push({
      id: `voice-retry-${v.id}`,
      kind: "voice_retry",
      title: v.name || v.phone || "Contato",
      preview: `Tentativa ${v.attempts + 1}/${v.max_attempts}${v.campaign_name ? ` · ${v.campaign_name}` : ""}`,
      at,
      status: v.status === "dialing" ? "running" : statusAt(at, now),
      badge: "Retry de ligação",
      channel: "voice",
      pizzaGroup: null,
      customerId: v.customer_id,
      phone: v.phone,
      motorLabel: "Retry de ligação",
    });
  }

  return dedupeReheatAgainstCadence(items).sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function groupTimelineByDay(items: AgendamentoTimelineItem[], now = new Date()): {
  key: "overdue" | "today" | "tomorrow" | "week" | "later";
  label: string;
  items: AgendamentoTimelineItem[];
}[] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today0 = startOfDay(now);
  const tomorrow0 = today0 + 86400_000;
  const dayAfter0 = tomorrow0 + 86400_000;
  const weekEnd0 = today0 + 7 * 86400_000;

  const buckets: Record<string, AgendamentoTimelineItem[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
  };

  for (const it of items) {
    const t = it.at.getTime();
    if (it.status === "overdue" || t < today0) buckets.overdue.push(it);
    else if (t < tomorrow0) buckets.today.push(it);
    else if (t < dayAfter0) buckets.tomorrow.push(it);
    else if (t < weekEnd0) buckets.week.push(it);
    else buckets.later.push(it);
  }

  return (
    [
      { key: "overdue" as const, label: "Atrasados", items: buckets.overdue },
      { key: "today" as const, label: "Hoje", items: buckets.today },
      { key: "tomorrow" as const, label: "Amanhã", items: buckets.tomorrow },
      { key: "week" as const, label: "Esta semana", items: buckets.week },
      { key: "later" as const, label: "Depois", items: buckets.later },
    ] as const
  ).filter((b) => b.items.length > 0);
}

// silence unused type import in some TS configs
export type { CadenceStageGroup };
