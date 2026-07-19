/**
 * Leads congelados por zeragem de backlog SLA (manual_admin_clear_sla_backlog).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  CADENCE_GROUP_BADGE,
  cadenceStageGroup,
  labelCadenceStage,
} from "@/lib/cadenceStageLabels";
import { stepByStage } from "@/lib/cadenceCalendarMap";
import { isCrmCadastroEmAnalise, isNuncaMaisContatar } from "@/lib/crmVsLeadAnalysis";
import {
  guessNameFromInboundMessage,
  resolveLeadPanelDisplayName,
} from "@/lib/customerDisplayName";
import { onlyDigits } from "@/lib/phone";

export const SLA_BACKLOG_PAUSE_REASON = "manual_admin_clear_sla_backlog";

export type SlaBacklogLead = {
  id: string;
  customerId: string;
  stage: string;
  nextActionAt: string | null;
  name: string;
  displayName: string;
  nameSourceLabel: string | null;
  phone: string;
  phoneFormatted: string;
  status: string | null;
  conversationStep: string | null;
  doNotContact: boolean;
  grupo: "A" | "B" | "C" | "fim" | null;
  grupoLabel: string;
  stageLabel: string;
  chatLabel: string;
  nextOnRelease: string;
  flags: string[];
};

const CONVERTED_STATUSES = new Set([
  "registered_igreen",
  "cadastro_concluido",
  "approved",
]);

const DEAD_CHAT_STEPS = new Set([
  "aguardando_avaliacao_atendimento",
  "atendimento_finalizado",
]);

function labelChatStep(step: string | null): string {
  const s = String(step || "").trim().toLowerCase();
  if (!s) return "Sem conversa ativa";
  if (DEAD_CHAT_STEPS.has(s)) return "Chat encerrado";
  if (s === "aguardando_conta") return "Em conversa · pedindo conta";
  if (s.startsWith("flow:")) return "Em conversa · fluxo A";
  if (s === "complete") return "Cadastro concluído";
  return s.replace(/_/g, " ");
}

/** O que o motor faz ao liberar (paused_reason limpo + next_action_at = agora). */
export function describeReleaseNextStep(
  stage: string,
  conversationStep: string | null,
): string {
  const grupo = cadenceStageGroup(stage);
  const step = stepByStage(stage);

  if (stage === "COLD_1") {
    return "Grupo B · WhatsApp reabrir (dia 1) — toque COLD_1 no próximo horário comercial";
  }
  if (stage === "GREETED") {
    return "Grupo A · motor agenda Onda B (COLD_1) — reabertura WhatsApp dia 1";
  }
  if (stage === "AI_QUALIFYING") {
    const chat = String(conversationStep || "").toLowerCase();
    if (chat === "aguardando_conta" || chat.startsWith("flow:")) {
      return "Grupo A · ainda no fluxo WhatsApp — daily-reheat pode retomar conversa; motor também pode avançar para Onda B";
    }
    if (DEAD_CHAT_STEPS.has(chat)) {
      return "Chat já encerrado · motor avança para Onda B (COLD_1) — WhatsApp de reabertura";
    }
    return "Grupo A residual · motor avança para Onda B (COLD_1)";
  }
  if (step?.channel === "whatsapp") {
    return `${CADENCE_GROUP_BADGE[step.cadenceGroup]} · WhatsApp — ${step.title}`;
  }
  if (step?.channel === "sms") {
    return `${CADENCE_GROUP_BADGE[step.cadenceGroup]} · SMS — ${step.title}`;
  }
  if (step?.channel === "voice") {
    return `${CADENCE_GROUP_BADGE[step.cadenceGroup]} · Ligação — ${step.title}`;
  }
  if (grupo === "B") return `Grupo B · ${labelCadenceStage(stage, "long")}`;
  if (grupo === "C") return `Grupo C · ${labelCadenceStage(stage, "long")}`;
  return labelCadenceStage(stage, "long");
}

function formatPhoneBr(raw: string | null | undefined): string {
  const d = onlyDigits(raw);
  if (d.length === 13 && d.startsWith("55")) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(raw || "").trim() || "—";
}

async function loadChatNameHints(customerIds: string[]): Promise<Map<string, string>> {
  const hints = new Map<string, string>();
  if (!customerIds.length) return hints;

  const { data } = await supabase
    .from("conversations")
    .select("customer_id, message_text, conversation_step")
    .in("customer_id", customerIds)
    .eq("message_direction", "inbound")
    .not("message_text", "is", null)
    .order("created_at", { ascending: true })
    .limit(400);

  const byCustomer = new Map<string, Array<{ text: string; step: string | null }>>();
  for (const row of data || []) {
    const id = String((row as { customer_id: string }).customer_id);
    const list = byCustomer.get(id) || [];
    if (list.length >= 8) continue;
    list.push({
      text: String((row as { message_text: string }).message_text || ""),
      step: ((row as { conversation_step?: string | null }).conversation_step as string | null) ?? null,
    });
    byCustomer.set(id, list);
  }

  for (const [customerId, messages] of byCustomer) {
    for (const msg of messages) {
      const step = String(msg.step || "").toLowerCase();
      if (step.includes("ask_name") || step.includes("a1_")) {
        const guessed = guessNameFromInboundMessage(msg.text);
        if (guessed) {
          hints.set(customerId, guessed);
          break;
        }
      }
    }
    if (hints.has(customerId)) continue;
    for (const msg of messages) {
      const guessed = guessNameFromInboundMessage(msg.text);
      if (guessed) {
        hints.set(customerId, guessed);
        break;
      }
    }
  }

  return hints;
}

function buildFlags(input: {
  status: string | null;
  conversationStep: string | null;
  doNotContact: boolean;
}): string[] {
  const flags: string[] = [];
  const st = String(input.status || "").toLowerCase();
  if (CONVERTED_STATUSES.has(st)) flags.push("Já convertido");
  if (st === "rejected" || st === "contato_incompleto") flags.push("Perdido / incompleto");
  const step = String(input.conversationStep || "").toLowerCase();
  if (DEAD_CHAT_STEPS.has(step)) flags.push("Chat encerrado");
  if (step === "aguardando_conta" || step.startsWith("flow:")) flags.push("Conversa ativa");
  if (input.doNotContact) flags.push("Já bloqueado");
  return flags;
}

export async function loadSlaBacklogLeads(consultantId: string): Promise<SlaBacklogLead[]> {
  const { data: rows, error } = await supabase
    .from("lead_cadence_state")
    .select("id, customer_id, stage, next_action_at")
    .eq("consultant_id", consultantId)
    .eq("paused_reason", SLA_BACKLOG_PAUSE_REASON)
    .order("stage")
    .order("next_action_at", { ascending: true });

  if (error || !rows?.length) return [];

  const custIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
  const { data: customers } = await supabase
    .from("customers")
    .select(
      "id, name, name_source, phone_whatsapp, status, conversation_step, do_not_contact, portal_submitted_at, bill_holder_name, doc_holder_name",
    )
    .in("id", custIds);

  const custMap = new Map((customers || []).map((c) => [c.id, c]));

  const prelimNeedHints: string[] = [];
  for (const id of custIds) {
    const c = custMap.get(id);
    if (!c) continue;
    const pre = resolveLeadPanelDisplayName({
      name: c.name,
      nameSource: c.name_source,
      billHolderName: c.bill_holder_name,
      docHolderName: c.doc_holder_name,
    });
    if (pre.displayName === "Sem nome") prelimNeedHints.push(String(id));
  }
  const chatHints = await loadChatNameHints(prelimNeedHints);

  return rows.map((r) => {
    const c = custMap.get(r.customer_id);
    const stage = String(r.stage || "");
    const grupo = cadenceStageGroup(stage);
    const conversationStep = (c?.conversation_step as string | null) ?? null;
    const flags = buildFlags({
      status: (c?.status as string | null) ?? null,
      conversationStep,
      doNotContact: c?.do_not_contact === true,
    });
    if (isCrmCadastroEmAnalise(c || {})) flags.push("CRM em análise");
    if (isNuncaMaisContatar({ do_not_contact: c?.do_not_contact, paused_reason: null })) {
      flags.push("Bloqueado");
    }

    const phone = String(c?.phone_whatsapp || "");
    const phoneFormatted = formatPhoneBr(phone);
    const { displayName, nameSourceLabel } = resolveLeadPanelDisplayName({
      name: (c?.name as string | null) ?? null,
      nameSource: (c?.name_source as string | null) ?? null,
      billHolderName: (c?.bill_holder_name as string | null) ?? null,
      docHolderName: (c?.doc_holder_name as string | null) ?? null,
      chatNameHint: chatHints.get(String(r.customer_id)) ?? null,
    });

    return {
      id: String(r.id),
      customerId: String(r.customer_id),
      stage,
      nextActionAt: r.next_action_at,
      name: displayName,
      displayName,
      nameSourceLabel,
      phone,
      phoneFormatted,
      status: (c?.status as string | null) ?? null,
      conversationStep,
      doNotContact: c?.do_not_contact === true,
      grupo,
      grupoLabel: grupo ? CADENCE_GROUP_BADGE[grupo] : "—",
      stageLabel: labelCadenceStage(stage, "short"),
      chatLabel: labelChatStep(conversationStep),
      nextOnRelease: describeReleaseNextStep(stage, conversationStep),
      flags: [...new Set(flags)],
    };
  });
}

export type SlaBacklogSummary = {
  total: number;
  byStage: Record<string, number>;
  byGrupo: Record<string, number>;
};

export function summarizeSlaBacklog(leads: SlaBacklogLead[]): SlaBacklogSummary {
  const byStage: Record<string, number> = {};
  const byGrupo: Record<string, number> = {};
  for (const l of leads) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1;
    const g = l.grupoLabel || "—";
    byGrupo[g] = (byGrupo[g] || 0) + 1;
  }
  return { total: leads.length, byStage, byGrupo };
}
