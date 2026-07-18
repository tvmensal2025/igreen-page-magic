/**
 * Rótulos amigáveis para estágios do motor de cadência (Zero Lead Perdido).
 * Códigos técnicos (COLD_1, AI_QUALIFYING…) ficam só em tooltip / painel técnico.
 */
import { stepByStage } from "@/lib/cadenceCalendarMap";

export type CadenceStageGroup = "A" | "B" | "C" | "fim";

type StageMeta = { short: string; long: string; group: CadenceStageGroup };

/** Estágios fora do calendário B/C (Grupo A e estados finais). */
const BASE_STAGES: Record<string, StageMeta> = {
  NEW: { short: "Novo", long: "Lead novo — acabou de entrar no sistema", group: "A" },
  GREETED: { short: "Aguardando onda", long: "Aguardando início da onda de reaquecimento (dia 1)", group: "A" },
  AI_QUALIFYING: { short: "Em conversa", long: "Conversando com a vendedora automática", group: "A" },
  PAUSED: { short: "Pausado", long: "Cadência pausada manualmente ou pelo sistema", group: "fim" },
  WON: { short: "Ganhou", long: "Lead convertido — cadência encerrada", group: "fim" },
  CLOSE_LOST: { short: "Sem resposta", long: "Onda de 10 dias encerrada sem retorno", group: "B" },
  RETARGET_META: { short: "Meta — público", long: "Enviado para público de remarketing na Meta", group: "C" },
  RETARGET_ADS_15D: { short: "Meta — anúncios", long: "Remarketing de anúncios (~15 dias após a onda)", group: "C" },
};

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
    return { label: "Pausado", hint: "Backlog antigo zerado — use Liberar DDD para reativar" };
  }
  if (reason.includes("SLA") || reason.includes("pause")) {
    return { label: "Pausado", hint: reason };
  }
  return { label: "Pausado", hint: reason };
}
