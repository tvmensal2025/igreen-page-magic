/**
 * Próximo passo do lead no portal do parceiro — horário + canal + o que será feito.
 */
import { CHANNEL_LABEL, stepByStage } from "@/lib/cadenceCalendarMap";
import { labelNextCadenceAction } from "@/lib/cadenceStageLabels";

export type PartnerNextStepTone = "overdue" | "soon" | "later" | "none";

export type PartnerNextStepSchedule = {
  what: string;
  channel: string;
  shortLabel: string;
  nextActionAt: string | null;
  isHandoff: boolean;
};

/** Textos curtos para parceiro leigo — sem jargão de cadência. */
const A_NEXT_SIMPLE: Record<string, { what: string; channel: string }> = {
  NEW: { what: "A Sofia manda mensagem no Zap", channel: "Zap" },
  GREETED: { what: "A Sofia manda outra mensagem no Zap", channel: "Zap" },
  AI_QUALIFYING: { what: "A Sofia manda outra mensagem no Zap", channel: "Zap" },
  A_NUDGE: { what: "Manda um SMS de lembrete", channel: "SMS" },
  A_SMS: { what: "Liga para essa pessoa", channel: "Ligação" },
  A_CALL: { what: "Tenta ligar de novo", channel: "Ligação" },
  A_CALL_RETRY: { what: "A Sofia manda mensagem no Zap (quem esfriou)", channel: "Zap" },
};

export const PARTNER_HANDOFF_NOW = "O consultor está atendendo essa pessoa agora.";

function channelFromCalendarStage(stage: string): string {
  const step = stepByStage(stage);
  if (!step) return "Automação";
  return CHANNEL_LABEL[step.channel] ?? "Automação";
}

function whatFromCalendarStage(stage: string): string | null {
  const step = stepByStage(stage);
  if (!step) return null;
  return step.title.replace(/\s*—.*$/, "").trim() || step.title;
}

/** Próximo estágio lógico (para B/C inferir canal pelo calendário). */
const STAGE_TO_NEXT: Record<string, string> = {
  NEW: "GREETED",
  GREETED: "A_NUDGE",
  AI_QUALIFYING: "A_NUDGE",
  A_NUDGE: "A_SMS",
  A_SMS: "A_CALL",
  A_CALL: "A_CALL_RETRY",
  A_CALL_RETRY: "COLD_1",
  COLD_1: "SMS_1",
  SMS_1: "CALL_1",
  CALL_1: "COLD_2",
  COLD_2: "SMS_TEMA_2",
  SMS_TEMA_2: "CALL_2",
  CALL_2: "SMS_2",
  SMS_2: "COLD_3",
  COLD_3: "SMS_TEMA_7",
  SMS_TEMA_7: "CALL_3",
  CALL_3: "COLD_4",
  COLD_4: "CLOSE_LOST",
  CLOSE_LOST: "RETARGET_META",
  RETARGET_META: "RETARGET_ADS_15D",
  RETARGET_ADS_15D: "RECALL_60D",
  RECALL_60D: "RECALL_60D_SMS",
  RECALL_60D_SMS: "RECALL_60D_CALL",
  RECALL_60D_CALL: "RECALL_90D",
  RECALL_90D: "RECALL_90D_SMS",
  RECALL_90D_SMS: "RECALL_90D_CALL",
  RECALL_90D_CALL: "RECALL_5M",
  RECALL_5M: "RECALL_5M_SMS",
  RECALL_5M_SMS: "RECALL_5M_CALL",
  RECALL_5M_CALL: "RECALL_8M",
  RECALL_8M: "RECALL_8M_SMS",
  RECALL_8M_SMS: "RECALL_8M_CALL",
  RECALL_8M_CALL: "RECALL_12M",
  RECALL_12M: "RECALL_12M_SMS",
  RECALL_12M_SMS: "RECALL_12M_CALL",
  RECALL_12M_CALL: "RECALL_YEARLY",
  RECALL_YEARLY: "RECALL_YEARLY_SMS",
  RECALL_YEARLY_SMS: "RECALL_YEARLY_CALL",
};

export function describePartnerNextStep(input: {
  stage: string | null | undefined;
  pausedReason?: string | null;
  nextActionAt?: string | null;
}): PartnerNextStepSchedule {
  const stage = String(input.stage || "").trim();
  const paused = String(input.pausedReason || "").trim().toLowerCase();
  const isHandoff =
    paused === "handoff_humano" || paused.startsWith("humano_assumiu");

  if (isHandoff) {
    return {
      what: "A Sofia manda outra mensagem no Zap",
      channel: "Zap",
      shortLabel: "Sofia volta no Zap",
      nextActionAt: input.nextActionAt ?? null,
      isHandoff: true,
    };
  }

  const shortLabel = labelNextCadenceAction(stage) || "Próximo contato automático";
  const a = A_NEXT_SIMPLE[stage];
  if (a) {
    return {
      what: a.what,
      channel: a.channel,
      shortLabel,
      nextActionAt: input.nextActionAt ?? null,
      isHandoff: false,
    };
  }

  const nextStage = STAGE_TO_NEXT[stage];
  if (nextStage) {
    const calWhat = whatFromCalendarStage(nextStage);
    const calChannel = channelFromCalendarStage(nextStage);
    if (calWhat) {
      const channel = calChannel === "WhatsApp" ? "Zap" : calChannel;
      return {
        what: simplifyCalendarWhat(calWhat, channel),
        channel,
        shortLabel,
        nextActionAt: input.nextActionAt ?? null,
        isHandoff: false,
      };
    }
  }

  const currentCal = whatFromCalendarStage(stage);
  if (currentCal) {
    const channel = channelFromCalendarStage(stage);
    const ch = channel === "WhatsApp" ? "Zap" : channel;
    return {
      what: simplifyCalendarWhat(currentCal, ch),
      channel: ch,
      shortLabel,
      nextActionAt: input.nextActionAt ?? null,
      isHandoff: false,
    };
  }

  return {
    what: shortLabel,
    channel: "Automático",
    shortLabel,
    nextActionAt: input.nextActionAt ?? null,
    isHandoff: false,
  };
}

function simplifyCalendarWhat(title: string, channel: string): string {
  const t = title.toLowerCase();
  if (channel === "SMS" || t.includes("sms")) return "Manda um SMS de lembrete";
  if (channel === "Ligação" || t.includes("ligação") || t.includes("ligacao")) {
    return "Liga para essa pessoa";
  }
  if (channel === "Zap" || t.includes("zap") || t.includes("whatsapp")) {
    return "A Sofia manda outra mensagem no Zap";
  }
  return title.split("—")[0]?.trim() || title;
}

/** Countdown até `next_action_at` (atualiza com `nowMs`). */
export function formatCadenceCountdown(
  iso: string | null | undefined,
  nowMs: number,
): { text: string; tone: PartnerNextStepTone; ms: number | null } {
  const until = formatPartnerTimeUntil(iso, nowMs);
  return { text: until.text, tone: until.tone, ms: until.ms };
}

function pluralPt(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function humanDurationPt(ms: number): string {
  const abs = Math.max(0, Math.abs(ms));
  const days = Math.floor(abs / 86_400_000);
  const hrs = Math.floor((abs % 86_400_000) / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${pluralPt(days, "dia", "dias")}`);
  if (hrs > 0) parts.push(`${hrs} ${pluralPt(hrs, "hora", "horas")}`);
  if (days === 0 && mins > 0) parts.push(`${mins} ${pluralPt(mins, "minuto", "minutos")}`);
  if (parts.length === 0) return "menos de 1 minuto";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} e ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** Texto amigável: “daqui 2 horas e 15 minutos” / “atrasado há 5 minutos”. */
export function formatPartnerTimeUntil(
  iso: string | null | undefined,
  nowMs: number,
): { text: string; tone: PartnerNextStepTone; ms: number | null } {
  if (!iso) {
    return { text: "Sem horário definido ainda", tone: "none", ms: null };
  }
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) {
    return { text: "Sem horário definido ainda", tone: "none", ms: null };
  }
  const diff = target - nowMs;
  const dur = humanDurationPt(diff);
  if (diff <= 0) {
    return { text: `Passou há ${dur}`, tone: "overdue", ms: diff };
  }
  return { text: `Faltam ${dur}`, tone: diff < 3_600_000 ? "soon" : "later", ms: diff };
}

/** Data/hora curta: "07/08 às 17h16". */
export function formatPartnerScheduleWhenShort(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const dm = d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
  const hm = d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${dm} às ${hm.replace(":", "h")}`;
}

/** Card único para o parceiro leigo (handoff = consultor atendendo). */
export function buildPartnerLeadCardText(input: {
  isHandoff: boolean;
  stageNotice: string;
  nextStepWhat: string;
  nextActionAt: string | null;
  nowMs: number;
}): { nowLine: string; nextLine: string } {
  const when = formatPartnerScheduleWhenShort(input.nextActionAt);
  const left = formatPartnerTimeUntil(input.nextActionAt, input.nowMs);

  if (input.isHandoff) {
    const timing =
      when && left.tone !== "none"
        ? `Se ninguém falar até ${when} (${left.text.toLowerCase()}), `
        : "Se ninguém falar por 48 horas, ";
    return {
      nowLine: PARTNER_HANDOFF_NOW,
      nextLine: `${timing}a Sofia manda outra mensagem no Zap.`,
    };
  }

  const timing =
    when && left.tone !== "none"
      ? `${when} · ${left.text}`
      : left.tone !== "none"
        ? left.text
        : "em breve";

  return {
    nowLine: input.stageNotice,
    nextLine: `${input.nextStepWhat} — ${timing}`,
  };
}

/** Data/hora em BRT (versão longa, se precisar). */
export function formatPartnerScheduleWhen(iso: string | null | undefined): string | null {
  const short = formatPartnerScheduleWhenShort(iso);
  return short;
}
