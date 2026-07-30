/**
 * Classificação A/B/C do portal público do parceiro.
 * Paridade de fatias com ReheatCyclePizza (admin) — sem depender do componente admin.
 */
import { CADENCE_CALENDAR } from "@/lib/cadenceCalendarMap";
import { isCycleLeadEligible, isPausedGroupA } from "@/lib/cycleEligibility";
import { labelCadenceStage, labelNextCadenceAction } from "@/lib/cadenceStageLabels";
import { safeFirstNameUi } from "@/lib/cadencePreview";
import { formatBrazilPhone } from "@/lib/phone";
import { formatPersonName, isUsableCustomerName } from "@/lib/customerDisplayName";

export type PartnerCycleGroup = "A" | "B" | "C";

export type PartnerPortalCycleLeadRaw = {
  id: string;
  name?: string | null;
  name_source?: string | null;
  phone_whatsapp?: string | null;
  status?: string | null;
  conversation_step?: string | null;
  portal_submitted_at?: string | null;
  do_not_contact?: boolean | null;
  customer_origin?: string | null;
  is_converted?: boolean | null;
  stage?: string | null;
  paused_reason?: string | null;
  next_action_at?: string | null;
  active_cadence?: boolean | null;
  pos_venda_stage?: string | null;
  andamento_igreen?: string | null;
  pos_venda_recadastro_at?: string | null;
  /** Fila diária (daily_reheat_queue) — prioridade sobre stage, como no admin. */
  queue_queue?: string | null;
  queue_step?: string | null;
};

export type PartnerCycleStep = {
  id: string;
  label: string;
  short: string;
  hint: string;
};

export type ClassifiedPartnerLead = {
  id: string;
  group: PartnerCycleGroup;
  sliceId: string;
  stage: string | null;
  displayName: string;
  phoneDisplay: string;
  phoneTel: string;
  stageNotice: string;
  nextHint: string | null;
};

/** Pizza A — mesmas fatias do admin. */
export const PARTNER_CYCLE_A_STEPS: PartnerCycleStep[] = [
  {
    id: "ask_name",
    label: "Entrada no ciclo",
    short: "Entrada",
    hint: "Acabou de entrar — pedindo nome e iniciando no WhatsApp.",
  },
  {
    id: "flow",
    label: "Em conversa",
    short: "Ativo",
    hint: "Em conversa no WhatsApp — coletando dados ou respondendo.",
  },
  {
    id: "wait",
    label: "Aguardando resposta",
    short: "Aguardando",
    hint: "Janela de silêncio (~2h). Sem resposta, sobe a escada de retomada.",
  },
  {
    id: "nudge",
    label: "Retomada no WhatsApp",
    short: "Retomada",
    hint: "Toque automático no WhatsApp para retomar quem sumiu.",
  },
  {
    id: "sms",
    label: "SMS de reforço",
    short: "SMS",
    hint: "SMS se a retomada no Zap não teve resposta.",
  },
  {
    id: "call1",
    label: "Ligação",
    short: "Ligação",
    hint: "Ligação automática. Sem atendimento, tenta de novo.",
  },
  {
    id: "retry",
    label: "Fecha leads novos",
    short: "Encerra",
    hint: "Última janela dos novos. Sem resposta → quem esfriou.",
  },
];

const CADENCE_TO_A: Record<string, string> = {
  NEW: "ask_name",
  GREETED: "wait",
  AI_QUALIFYING: "flow",
  A_NUDGE: "nudge",
  A_SMS: "sms",
  A_CALL: "call1",
  A_CALL_RETRY: "retry",
};

/** Fila A (daily_reheat) → fatia pizza A — paridade admin. */
const QUEUE_A_TO_SLICE: Record<string, string> = {
  open: "ask_name",
  flow: "flow",
  wait2h: "wait",
  call1: "call1",
  retry: "retry",
  sms: "sms",
  close: "retry",
  quente: "ask_name",
};

/** Fila B → dia pizza B. */
const QUEUE_B_TO_SLICE: Record<string, string> = {
  call1: "d1",
  open: "d1",
  retry: "d4",
  sms: "d6",
  wait: "d7",
  close: "d10",
};

const FRIO_HINTS: Record<string, string> = {
  d1: "Reengajamento D+1 — Zap → SMS → ligação se silêncio.",
  d2: "Dia 2 — nova abordagem no Zap; SMS se não responder.",
  d4: "Dia 4 — 2ª ligação (só se ainda em silêncio).",
  d6: "Dia 6 — SMS de novidades com link do Zap.",
  d7: "Dia 7 — Zap de resposta fácil + SMS se silêncio.",
  d10: "Dia 10 — fecha a onda: ligação + Zap. Sem retorno → recall.",
};

export const PARTNER_CYCLE_B_STEPS: PartnerCycleStep[] = CADENCE_CALENDAR.filter(
  (d) => d.group === "B",
).map((d) => ({
  id: d.id,
  label: d.label,
  short: d.id === "d1" ? "D+1" : d.id.replace("d", "D"),
  hint: FRIO_HINTS[d.id] ?? d.subtitle ?? d.label,
}));

const CADENCE_TO_B: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const day of CADENCE_CALENDAR) {
    if (day.group !== "B") continue;
    for (const step of day.steps) map[step.stage] = day.id;
  }
  return map;
})();

export const PARTNER_CYCLE_C_STEPS: PartnerCycleStep[] = [
  {
    id: "meta",
    label: "Meta / audiência",
    short: "Meta",
    hint: "Após a onda: audiência Meta e remarketing. Sem WhatsApp nesta fatia.",
  },
  {
    id: "r30",
    label: "1º recall (~30d)",
    short: "~30d",
    hint: "Recall — Zap → SMS → ligação se silêncio.",
  },
  {
    id: "r90",
    label: "Recall ~90d",
    short: "90d",
    hint: "Recall — mesma escada Zap → SMS → ligação.",
  },
  {
    id: "r5m",
    label: "Recall ~5 meses",
    short: "5m",
    hint: "Recall longo — Zap → SMS → ligação.",
  },
  {
    id: "r8m",
    label: "Recall ~8 meses",
    short: "8m",
    hint: "Recall longo — Zap → SMS → ligação.",
  },
  {
    id: "r12m",
    label: "Recall ~12 meses",
    short: "12m",
    hint: "Recall ~1 ano — Zap → SMS → ligação.",
  },
  {
    id: "ryear",
    label: "Recall anual",
    short: "Ano",
    hint: "Loop anual — Zap → SMS → ligação e reinicia o ciclo longo.",
  },
];

const CADENCE_TO_C: Record<string, string> = {
  CLOSE_LOST: "meta",
  RETARGET_META: "meta",
  RETARGET_ADS_15D: "meta",
  RECALL_60D: "r30",
  RECALL_60D_SMS: "r30",
  RECALL_60D_CALL: "r30",
  RECALL_90D: "r90",
  RECALL_90D_SMS: "r90",
  RECALL_90D_CALL: "r90",
  RECALL_5M: "r5m",
  RECALL_5M_SMS: "r5m",
  RECALL_5M_CALL: "r5m",
  RECALL_8M: "r8m",
  RECALL_8M_SMS: "r8m",
  RECALL_8M_CALL: "r8m",
  RECALL_12M: "r12m",
  RECALL_12M_SMS: "r12m",
  RECALL_12M_CALL: "r12m",
  RECALL_YEARLY: "ryear",
  RECALL_YEARLY_SMS: "ryear",
  RECALL_YEARLY_CALL: "ryear",
};

const SLICE_NOTICE: Record<string, string> = {
  ask_name: "Acabou de entrar — pedindo nome no WhatsApp",
  flow: "Em conversa no WhatsApp agora",
  wait: "Aguardando resposta (~2h de silêncio)",
  nudge: "Sem resposta — retomada no WhatsApp",
  sms: "Reforço por SMS em andamento",
  call1: "Ligação automática em andamento",
  retry: "Última janela dos leads novos antes de quem esfriou",
  d1: "Reengajamento D+1 — Zap → SMS → ligação se silêncio",
  d2: "Dia 2 — Zap + SMS se silêncio",
  d4: "Dia 4 — 2ª ligação se ainda em silêncio",
  d6: "Dia 6 — SMS de novidades",
  d7: "Dia 7 — Zap de resposta fácil",
  d10: "Dia 10 — fecha a onda (ligação + Zap)",
  meta: "Na audiência Meta / remarketing",
  r30: "Recall (~30d) — Zap → SMS → ligação",
  r90: "Recall (~90d) — Zap → SMS → ligação",
  r5m: "Recall (~5 meses) — Zap → SMS → ligação",
  r8m: "Recall (~8 meses) — Zap → SMS → ligação",
  r12m: "Recall (~12 meses) — Zap → SMS → ligação",
  ryear: "Recall anual — Zap → SMS → ligação",
};

export function stepsForGroup(group: PartnerCycleGroup): PartnerCycleStep[] {
  if (group === "A") return PARTNER_CYCLE_A_STEPS;
  if (group === "B") return PARTNER_CYCLE_B_STEPS;
  return PARTNER_CYCLE_C_STEPS;
}

export function displayPartnerLeadName(
  name: string | null | undefined,
  nameSource: string | null | undefined,
): string {
  const first = safeFirstNameUi(name, nameSource);
  if (first) return first;
  if (isUsableCustomerName(name)) {
    const full = formatPersonName(String(name).trim());
    return full.split(/\s+/)[0] || "Lead";
  }
  return "Lead";
}

export function stageNoticeForSlice(
  sliceId: string,
  stage: string | null | undefined,
): string {
  if (SLICE_NOTICE[sliceId]) return SLICE_NOTICE[sliceId];
  const long = labelCadenceStage(stage, "long");
  if (long && long !== "—") return long;
  return "Em acompanhamento automático (WhatsApp, SMS ou ligação)";
}

/**
 * Classifica um lead bruto do RPC no ciclo A/B/C.
 * Retorna null se fora do ciclo (CRM, bloqueado, carteira, etc.).
 */
export function classifyPartnerCycleLead(
  raw: PartnerPortalCycleLeadRaw,
): ClassifiedPartnerLead | null {
  if (
    !isCycleLeadEligible({
      customer_origin: raw.customer_origin,
      status: raw.status,
      conversation_step: raw.conversation_step,
      portal_submitted_at: raw.portal_submitted_at,
      do_not_contact: raw.do_not_contact,
      paused_reason: raw.paused_reason,
      active_cadence: raw.active_cadence ?? !!raw.next_action_at,
      is_converted: raw.is_converted,
      pos_venda_stage: raw.pos_venda_stage,
      andamento_igreen: raw.andamento_igreen,
      pos_venda_recadastro_at: raw.pos_venda_recadastro_at,
    })
  ) {
    return null;
  }

  const stage = String(raw.stage || "").trim() || null;
  const queue = String(raw.queue_queue || "").trim().toUpperCase();
  const queueStep = String(raw.queue_step || "").trim();
  let group: PartnerCycleGroup | null = null;
  let sliceId: string | null = null;

  // Fila diária tem prioridade (igual ReheatCyclePizza).
  if (queue === "A" && QUEUE_A_TO_SLICE[queueStep]) {
    group = "A";
    sliceId = QUEUE_A_TO_SLICE[queueStep];
  } else if (queue === "B" && QUEUE_B_TO_SLICE[queueStep]) {
    group = "B";
    sliceId = QUEUE_B_TO_SLICE[queueStep];
  } else if (stage === "PAUSED") {
    if (isPausedGroupA(raw.paused_reason)) {
      group = "A";
      sliceId = "flow";
    } else {
      const prev = /^lead_responded:(.+)$/.exec(String(raw.paused_reason || ""))?.[1]?.trim();
      if (prev && CADENCE_TO_B[prev]) {
        group = "B";
        sliceId = CADENCE_TO_B[prev];
      } else if (prev && CADENCE_TO_C[prev]) {
        group = "C";
        sliceId = CADENCE_TO_C[prev];
      } else {
        return null;
      }
    }
  } else if (stage && CADENCE_TO_A[stage]) {
    group = "A";
    sliceId = CADENCE_TO_A[stage];
  } else if (stage && CADENCE_TO_B[stage]) {
    group = "B";
    sliceId = CADENCE_TO_B[stage];
  } else if (stage && CADENCE_TO_C[stage]) {
    group = "C";
    sliceId = CADENCE_TO_C[stage];
  } else {
    // Sem stage mapeável e sem fila → fora da pizza (não inventa Entrada).
    return null;
  }

  const phoneRaw = String(raw.phone_whatsapp || "").trim();
  const phoneDisplay = phoneRaw ? formatBrazilPhone(phoneRaw) : "—";
  const digits = phoneRaw.replace(/\D/g, "");
  const phoneTel = digits
    ? digits.startsWith("55")
      ? `+${digits}`
      : digits.length >= 10
        ? `+55${digits}`
        : ""
    : "";

  const next = labelNextCadenceAction(stage);
  const notice = stageNoticeForSlice(sliceId, stage);

  return {
    id: raw.id,
    group,
    sliceId,
    stage,
    displayName: displayPartnerLeadName(raw.name, raw.name_source),
    phoneDisplay,
    phoneTel,
    stageNotice: notice,
    nextHint: next,
  };
}

export function classifyPartnerCycleLeads(
  raws: PartnerPortalCycleLeadRaw[],
): ClassifiedPartnerLead[] {
  const out: ClassifiedPartnerLead[] = [];
  for (const r of raws) {
    const c = classifyPartnerCycleLead(r);
    if (c) out.push(c);
  }
  return out;
}

export function countBySlice(
  leads: ClassifiedPartnerLead[],
  group: PartnerCycleGroup,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of stepsForGroup(group)) counts[s.id] = 0;
  for (const l of leads) {
    if (l.group !== group) continue;
    counts[l.sliceId] = (counts[l.sliceId] || 0) + 1;
  }
  return counts;
}

export function leadsInSlice(
  leads: ClassifiedPartnerLead[],
  group: PartnerCycleGroup,
  sliceId: string,
): ClassifiedPartnerLead[] {
  return leads.filter((l) => l.group === group && l.sliceId === sliceId);
}
