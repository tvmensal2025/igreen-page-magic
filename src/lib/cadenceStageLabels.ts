/**
 * Rótulos amigáveis para estágios do motor de cadência (Zero Lead Perdido).
 * Códigos técnicos (COLD_1, AI_QUALIFYING…) ficam só em tooltip / painel técnico.
 */
import { stepByStage } from "@/lib/cadenceCalendarMap";

export type CadenceStageGroup = "A" | "B" | "C" | "fim";

type StageMeta = { short: string; long: string; group: CadenceStageGroup };

/** Estágios fora do calendário B/C (Grupo A e estados finais). */
const BASE_STAGES: Record<string, StageMeta> = {
  NEW: { short: "Entrada", long: "Lead novo — acabou de entrar no sistema", group: "A" },
  GREETED: {
    short: "Aguardando",
    long: "Janela de silêncio (~2h) antes da retomada no WhatsApp",
    group: "A",
  },
  AI_QUALIFYING: { short: "Em conversa", long: "Conversando com a vendedora automática", group: "A" },
  A_NUDGE: { short: "Retomada", long: "Cutuca no WhatsApp — retomada da conversa", group: "A" },
  A_SMS: { short: "SMS", long: "SMS de reforço da escada do Grupo A", group: "A" },
  A_CALL: { short: "Ligação", long: "1ª ligação da escada do Grupo A", group: "A" },
  A_CALL_RETRY: {
    short: "Fecha A",
    long: "Última janela do Grupo A antes de ir para o frio (B)",
    group: "A",
  },
  PAUSED: { short: "Pausado", long: "Cadência pausada manualmente ou pelo sistema", group: "fim" },
  WON: { short: "Ganhou", long: "Lead convertido — cadência encerrada", group: "fim" },
  CLOSE_LOST: { short: "Sem resposta", long: "Onda de 10 dias encerrada sem retorno", group: "B" },
  RETARGET_META: { short: "Meta — público", long: "Enviado para público de remarketing na Meta", group: "C" },
  RETARGET_ADS_15D: { short: "Meta — anúncios", long: "Remarketing de anúncios (~15 dias após a onda)", group: "C" },
};

/** Próxima ação do motor (rótulo curto pra lista da pizza). */
const STAGE_NEXT_SHORT: Record<string, string> = {
  NEW: "Aguardando",
  GREETED: "Retomada (Zap)",
  AI_QUALIFYING: "Retomada (Zap)",
  A_NUDGE: "SMS",
  A_SMS: "Ligação",
  A_CALL: "Fecha A",
  A_CALL_RETRY: "Grupo B · D+1",
  COLD_1: "SMS D+1",
  SMS_1: "Ligação D+1",
  CALL_1: "Zap D+2",
  COLD_2: "SMS tema D+2",
  SMS_TEMA_2: "Ligação D+4",
  CALL_2: "SMS D+6",
  SMS_2: "Zap D+7",
  COLD_3: "SMS tema D+7",
  SMS_TEMA_7: "Ligação D+10",
  CALL_3: "Zap fecha D+10",
  COLD_4: "Grupo C · Meta",
  CLOSE_LOST: "Meta · público",
  RETARGET_META: "Meta · anúncios",
  RETARGET_ADS_15D: "1º recall",
  RECALL_60D: "SMS recall",
  RECALL_60D_SMS: "Ligação recall",
  RECALL_60D_CALL: "Recall ~90d",
  RECALL_90D: "SMS recall",
  RECALL_90D_SMS: "Ligação recall",
  RECALL_90D_CALL: "Recall ~5m",
  RECALL_5M: "SMS recall",
  RECALL_5M_SMS: "Ligação recall",
  RECALL_5M_CALL: "Recall ~8m",
  RECALL_8M: "SMS recall",
  RECALL_8M_SMS: "Ligação recall",
  RECALL_8M_CALL: "Recall ~12m",
  RECALL_12M: "SMS recall",
  RECALL_12M_SMS: "Ligação recall",
  RECALL_12M_CALL: "Recall anual",
  RECALL_YEARLY: "SMS anual",
  RECALL_YEARLY_SMS: "Ligação anual",
  RECALL_YEARLY_CALL: "Fim do ciclo",
};

export function labelNextCadenceAction(stage: string | null | undefined): string | null {
  const key = (stage || "").trim();
  if (!key || key === "PAUSED" || key === "WON") return null;
  return STAGE_NEXT_SHORT[key] || null;
}

function shortFromCalendarTitle(title: string): string {
  const part = title.split("—")[0]?.trim();
  return part || title;
}

/** Nome curto para badges e listas. */
export function labelCadenceStage(stage: string | null | undefined, mode: "short" | "long" = "short"): string {
  const key = (stage || "").trim();
  if (!key) return "—";

  const base = BASE_STAGES[key];
  if (base) return mode === "short" ? base.short : base.long;

  const step = stepByStage(key);
  if (step) return mode === "short" ? shortFromCalendarTitle(step.title) : step.title;

  return key
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Grupo lógico A (quente) · B (onda 10d) · C (longo prazo) · fim. */
export function cadenceStageGroup(stage: string | null | undefined): CadenceStageGroup | null {
  const key = (stage || "").trim();
  if (!key) return null;
  const base = BASE_STAGES[key];
  if (base) return base.group;
  const step = stepByStage(key);
  if (step) return step.cadenceGroup;
  return null;
}

export const CADENCE_GROUP_BADGE: Record<CadenceStageGroup, string> = {
  A: "Quente",
  B: "Onda 10 dias",
  C: "Longo prazo",
  fim: "Encerrado",
};

/** Motivo de pausa → texto legível. */
export function labelPausedReason(reason: string | null | undefined): { label: string; hint?: string } | null {
  if (!reason) return null;
  if (reason.startsWith("not_lead")) {
    return { label: "Não é lead", hint: "Telefone fora do DDD de leads reais" };
  }
  if (reason === "manual_won") return { label: "Ganhou", hint: "Marcado como convertido" };
  if (reason === "manual_already_closed") return { label: "Perdido", hint: "Sem interesse ou já fechou" };
  if (reason === "manual_admin_pause") return { label: "Pausado", hint: "Pausado manualmente pelo admin" };
  if (reason === "manual_admin_clear_sla_backlog") {
    return { label: "Backlog SLA", hint: "Congelado na limpeza do backlog — revise no dashboard (Revisar agora)" };
  }
  if (reason.includes("SLA") || reason.includes("pause")) {
    return { label: "Pausado", hint: reason };
  }
  return { label: "Pausado", hint: reason };
}
