/**
 * Handoff humano → painel do dashboard.
 * Ações: voltar ao acompanhamento · já é cliente · bloquear.
 *
 * Fonte: cadence `handoff_humano` OU customers.bot_paused humano / assigned_human_id.
 *
 * Lista só LEADS que ainda precisam de ação.
 * Bloqueado (do_not_contact): NÃO entra — já decidido; não recebe automação.
 * Cliente (carteira / convertido): NÃO entra — não é lead; "Voltar" nele
 * só libera pausa (não mete em A/B/C) se ainda estiver listado por bug antigo.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  CADENCE_GROUP_BADGE,
  cadenceStageGroup,
  labelCadenceStage,
} from "@/lib/cadenceStageLabels";
import {
  isClienteProibidoCadenciaABC,
  type ClienteCadenceSignals,
} from "@/lib/clienteCadenceGuard";
import { onlyDigits } from "@/lib/phone";
import { resolveLeadPanelDisplayName } from "@/lib/customerDisplayName";

const CUSTOMER_HANDOFF_SELECT =
  "id, name, phone_whatsapp, conversation_step, bot_paused, bot_paused_reason, assigned_human_id, name_source, last_inbound_media_url, last_inbound_media_kind, do_not_contact, customer_origin, status, is_converted, pos_venda_stage, andamento_igreen, pos_venda_recadastro_at";

export const HANDOFF_PAUSE_REASON = "handoff_humano";

export type BlockedCategory = "handoff" | "security" | "other";

export type HandoffLead = {
  cadenceId: string;
  customerId: string;
  stage: string;
  stageLabel: string;
  grupo: "A" | "B" | "C" | "fim" | null;
  grupoLabel: string;
  name: string;
  displayName: string;
  phone: string;
  phoneFormatted: string;
  conversationStep: string | null;
  botPaused: boolean;
  botPausedReason: string | null;
  pausedUntil: string | null;
  pausedReasonRaw: string | null;
  category: BlockedCategory;
  alertId: string | null;
  alertReason: string | null;
  alertMessage: string | null;
  alertAt: string | null;
  /** Foto do lead se houver (mídia inbound recente). */
  photoUrl: string | null;
  /** Já é cliente (carteira / convertido) — handoff ok; sem ciclo leads A/B/C. */
  isCliente: boolean;
  /** Bloqueado — não recebe automação; fora da lista de handoff. */
  doNotContact: boolean;
};

const REASON_LABEL: Record<string, string> = {
  auto_loop_detected: "Loop detectado — lead repetiu o mesmo passo várias vezes",
  auto_orphan_step_detected: "Passo órfão — fluxo alterado e lead em passo inexistente",
  custom_step_no_match_retries_exhausted: "IA não entendeu a resposta após várias tentativas",
  duvida_fora_faq: "Pergunta fora da base de conhecimento",
  cadastro_falhou: "Cadastro no portal falhou",
  no_media_received: "Não enviou foto/documento pedido",
  step_misconfigured_or_lead_off_topic: "Passo mal configurado ou lead saiu do roteiro",
  handoff_humano: "Você precisa atender",
  ai_handoff_duvidas: "IA pediu ajuda (dúvidas)",
  low_confidence_handoff: "IA sem certeza — precisa de você",
  lead_pediu_humano: "Cliente pediu atendimento humano",
  humano_assumiu: "Você assumiu o atendimento",
  humano_assumiu_audio: "Você assumiu (enviou áudio)",
  humano_assumiu_midia: "Você assumiu (enviou mídia)",
  humano_assumiu_whatsapp: "Você assumiu pelo WhatsApp",
  humano_assumiu_template: "Você assumiu (mensagem pronta)",
  flow_button_humano: "Cliente escolheu falar com humano",
};

/** Motivos de bot_paused que devem aparecer no painel de handoff. */
export function isHandoffBotPauseReason(reason: string | null | undefined): boolean {
  const r = String(reason || "").trim().toLowerCase();
  if (!r) return false;
  if (r.includes("humano") || r.includes("human")) return true;
  if (r.includes("handoff")) return true;
  if (r === "lead_pediu_humano" || r.startsWith("lead_pediu_humano")) return true;
  if (r === "ai_handoff_duvidas" || r === "low_confidence_handoff") return true;
  if (r === "flow_button_humano") return true;
  if (r.startsWith("muitas_duvidas")) return true;
  return false;
}

export function formatHandoffReason(reason: string | null | undefined): string {
  const r = String(reason || "").trim();
  if (!r) return "Aguardando você atender";
  return REASON_LABEL[r] || r.replace(/_/g, " ");
}

function formatPhoneBr(raw: string | null | undefined): string {
  const d = onlyDigits(raw || "");
  if (d.length >= 12 && d.startsWith("55")) {
    const rest = d.slice(2);
    if (rest.length === 11) return `(${rest.slice(0, 2)}) ${rest.slice(2, 7)}-${rest.slice(7)}`;
    if (rest.length === 10) return `(${rest.slice(0, 2)}) ${rest.slice(2, 6)}-${rest.slice(6)}`;
  }
  return raw || d || "—";
}

/** Motivos "security" — lead sai da pizza por bloqueio/qualidade, não por handoff humano. */
export const SECURITY_PAUSE_REASONS = [
  "invalid_phone",
  "dnc",
  "opt_out",
  "manual_admin_clear_sla_backlog",
] as const;

const SECURITY_PAUSE_PREFIXES = ["dnc:", "not_lead_outside_ddd"];

export function classifyPauseReason(reason: string | null | undefined): BlockedCategory {
  const r = String(reason || "").trim().toLowerCase();
  if (!r) return "other";
  if (r === HANDOFF_PAUSE_REASON || isHandoffBotPauseReason(r)) return "handoff";
  if ((SECURITY_PAUSE_REASONS as readonly string[]).includes(r)) return "security";
  if (SECURITY_PAUSE_PREFIXES.some((p) => r.startsWith(p))) return "security";
  return "other";
}

const SECURITY_REASON_LABEL: Record<string, string> = {
  invalid_phone: "Telefone inválido (canal morto)",
  dnc: "Bloqueado — nunca mais contatar",
  opt_out: "Opt-out — pediu para não receber",
  manual_admin_clear_sla_backlog: "Congelado pelo admin (backlog)",
};

export function formatSecurityReason(reason: string | null | undefined): string {
  const r = String(reason || "").trim().toLowerCase();
  if (!r) return "Bloqueado";
  if (SECURITY_REASON_LABEL[r]) return SECURITY_REASON_LABEL[r];
  if (r.startsWith("dnc:")) return `Bloqueado (${r.slice(4)})`;
  if (r.startsWith("not_lead_outside_ddd")) return "Fora do DDD atendido";
  return r.replace(/_/g, " ");
}

/**
 * Telefone útil para WA/voz (não placeholder `sem_celular_*` nem lixo).
 * Sem isso não há ação possível neste painel — lead não entra na lista.
 */
export function hasUsableHandoffPhone(phone: string | null | undefined): boolean {
  const raw = String(phone || "").trim();
  if (!raw || /sem_celular/i.test(raw)) return false;
  const d = onlyDigits(raw);
  if (d.length === 10 || d.length === 11) return true;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return true;
  return false;
}

type CadenceRow = {
  id: string;
  customer_id: string;
  stage: string;
  paused_until: string | null;
  paused_reason: string | null;
  updated_at?: string | null;
};

type CustomerRow = {
  id: string;
  name: string | null;
  phone_whatsapp: string | null;
  conversation_step: string | null;
  bot_paused: boolean | null;
  bot_paused_reason: string | null;
  assigned_human_id?: string | null;
  name_source?: string | null;
  last_inbound_media_url?: string | null;
  last_inbound_media_kind?: string | null;
  do_not_contact?: boolean | null;
  consultant_id?: string;
  customer_origin?: string | null;
  status?: string | null;
  is_converted?: boolean | null;
  pos_venda_stage?: string | null;
  andamento_igreen?: string | null;
  pos_venda_recadastro_at?: string | null;
};

function customerAsClienteSignals(c: CustomerRow | undefined): ClienteCadenceSignals {
  return {
    customer_origin: c?.customer_origin,
    status: c?.status,
    is_converted: c?.is_converted,
    pos_venda_stage: c?.pos_venda_stage,
    andamento_igreen: c?.andamento_igreen,
    pos_venda_recadastro_at: c?.pos_venda_recadastro_at,
  };
}

/** Cliente de carteira / convertido — não é lead; fora do painel de handoff A/B/C. */
export function isHandoffClienteNotLead(c: CustomerRow | undefined): boolean {
  if (!c) return false;
  return isClienteProibidoCadenciaABC(customerAsClienteSignals(c));
}

function buildHandoffLead(
  customerId: string,
  c: CustomerRow | undefined,
  cadence: CadenceRow | null,
  alert: {
    id: string;
    reason: string | null;
    user_message: string | null;
    created_at: string;
  } | null,
): HandoffLead | null {
  const phone = c?.phone_whatsapp || "";
  if (!hasUsableHandoffPhone(phone)) return null;
  // Bloqueado / cliente carteira: fora deste painel (não é lead aguardando ciclo).
  if (c?.do_not_contact) return null;
  const isCliente = isHandoffClienteNotLead(c);
  if (isCliente) return null;

  const name = String(c?.name || "").trim();
  const display = resolveLeadPanelDisplayName({
    name: c?.name,
    nameSource: c?.name_source,
  });
  const stage = String(cadence?.stage || "NEW");
  const grupo = cadenceStageGroup(stage);
  const pausedReason =
    cadence?.paused_reason ||
    c?.bot_paused_reason ||
    (c?.assigned_human_id ? "humano_assumiu" : HANDOFF_PAUSE_REASON);
  const category = classifyPauseReason(pausedReason);
  const mediaKind = String(c?.last_inbound_media_kind || "");
  const mediaUrl = String(c?.last_inbound_media_url || "").trim();
  const photoUrl =
    mediaUrl && /image|photo|picture|sticker/i.test(mediaKind) ? mediaUrl : null;

  return {
    cadenceId: cadence?.id || `customer:${customerId}`,
    customerId,
    stage,
    stageLabel: labelCadenceStage(stage, "short"),
    grupo,
    grupoLabel: grupo ? CADENCE_GROUP_BADGE[grupo] || grupo : "—",
    name: name || "(sem nome)",
    displayName: display.displayName || name || "(sem nome)",
    phone,
    phoneFormatted: formatPhoneBr(phone),
    conversationStep: c?.conversation_step ?? null,
    botPaused: !!c?.bot_paused || !!c?.assigned_human_id,
    botPausedReason: c?.bot_paused_reason ?? null,
    pausedUntil: cadence?.paused_until ?? null,
    pausedReasonRaw: pausedReason,
    category,
    alertId: alert?.id ?? null,
    alertReason: alert?.reason ?? null,
    alertMessage: alert?.user_message ?? null,
    alertAt: alert?.created_at ?? null,
    photoUrl,
    isCliente: false,
    doNotContact: false,
  };
}

/**
 * Lista LEADS em handoff que ainda precisam de ação:
 * voltar ao acompanhamento · já é cliente · bloquear.
 *
 * Entram:
 * - cadence `paused_reason = handoff_humano`
 * - customers com bot_paused humano / assigned_human_id (takeover)
 *
 * Não lista: bloqueados (do_not_contact), clientes de carteira/convertidos,
 * sem telefone útil, WON esquecido sem pausa humana ativa.
 */
export async function loadHandoffLeads(consultantId: string): Promise<HandoffLead[]> {
  const [{ data: cadenceHandoff, error: cadErr }, { data: pausedCustomers, error: custErr }] =
    await Promise.all([
      supabase
        .from("lead_cadence_state")
        .select("id, customer_id, stage, paused_until, paused_reason, updated_at")
        .eq("consultant_id", consultantId)
        .eq("paused_reason", HANDOFF_PAUSE_REASON)
        .order("updated_at", { ascending: false })
        .limit(300),
      supabase
        .from("customers")
        .select(CUSTOMER_HANDOFF_SELECT)
        .eq("consultant_id", consultantId)
        .eq("bot_paused", true)
        .order("bot_paused_at", { ascending: false })
        .limit(300),
    ]);

  if (cadErr) throw new Error(cadErr.message);
  if (custErr) throw new Error(custErr.message);

  const humanPausedCustomers = (pausedCustomers || []).filter((c) => {
    if (c.do_not_contact) return false;
    if (isHandoffClienteNotLead(c as CustomerRow)) return false;
    if (c.assigned_human_id) return true;
    return isHandoffBotPauseReason(c.bot_paused_reason);
  }) as CustomerRow[];

  const customerIds = new Set<string>();
  for (const r of cadenceHandoff || []) {
    if (r.customer_id) customerIds.add(r.customer_id);
  }
  for (const c of humanPausedCustomers) customerIds.add(c.id);

  if (!customerIds.size) return [];

  const ids = Array.from(customerIds);

  const [{ data: allCustomers }, { data: allCadence }, { data: alerts }] = await Promise.all([
    supabase
      .from("customers")
      .select(CUSTOMER_HANDOFF_SELECT)
      .in("id", ids),
    supabase
      .from("lead_cadence_state")
      .select("id, customer_id, stage, paused_until, paused_reason, updated_at")
      .in("customer_id", ids),
    supabase
      .from("bot_handoff_alerts")
      .select("id, customer_id, reason, user_message, created_at")
      .eq("consultant_id", consultantId)
      .in("customer_id", ids)
      .is("resolved_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const custById = new Map((allCustomers || []).map((c) => [c.id, c as CustomerRow]));
  const cadenceByCustomer = new Map<string, CadenceRow>();
  for (const row of allCadence || []) {
    if (!row.customer_id) continue;
    // Prefer handoff_humano row; senão a mais recente.
    const prev = cadenceByCustomer.get(row.customer_id);
    if (!prev || row.paused_reason === HANDOFF_PAUSE_REASON) {
      cadenceByCustomer.set(row.customer_id, row as CadenceRow);
    }
  }

  const alertByCustomer = new Map<
    string,
    { id: string; reason: string | null; user_message: string | null; created_at: string }
  >();
  for (const a of alerts || []) {
    if (!a.customer_id) continue;
    if (!alertByCustomer.has(a.customer_id)) {
      alertByCustomer.set(a.customer_id, {
        id: a.id,
        reason: a.reason,
        user_message: a.user_message,
        created_at: a.created_at,
      });
    }
  }

  const out: HandoffLead[] = [];
  for (const customerId of ids) {
    const c = custById.get(customerId);
    const cadence = cadenceByCustomer.get(customerId) || null;

    // Já esquecido (WON) e sem bot humano ativo → não lista.
    const stage = String(cadence?.stage || "");
    const cadReason = String(cadence?.paused_reason || "");
    const alreadyForgotten =
      stage === "WON" ||
      cadReason === "manual_won" ||
      cadReason.startsWith("won:");
    const stillHumanPaused =
      !!c?.assigned_human_id ||
      (!!c?.bot_paused && isHandoffBotPauseReason(c?.bot_paused_reason)) ||
      cadReason === HANDOFF_PAUSE_REASON;
    if (alreadyForgotten && !stillHumanPaused) continue;

    const lead = buildHandoffLead(
      customerId,
      c,
      cadence,
      alertByCustomer.get(customerId) || null,
    );
    if (lead) out.push(lead);
  }

  out.sort((a, b) => {
    const ta = a.alertAt || a.pausedUntil || "";
    const tb = b.alertAt || b.pausedUntil || "";
    return tb.localeCompare(ta);
  });

  return out;
}

/**
 * Marca a cadência do lead como handoff — tira da pizza e manda pro painel.
 * Idempotente. Sem linha de cadência = noop (lead ainda entra via bot_paused).
 */
export async function pauseCadenceForHandoff(customerId: string): Promise<void> {
  if (!customerId) return;
  const { error } = await supabase
    .from("lead_cadence_state")
    .update({
      paused_reason: HANDOFF_PAUSE_REASON,
      next_action_at: null,
    } as never)
    .eq("customer_id", customerId)
    .neq("stage", "WON");
  if (error) {
    console.warn("[pauseCadenceForHandoff]", error.message);
  }
}

export type ReturnHandoffResult = {
  ok: boolean;
  error?: string;
};

/**
 * Volta ao acompanhamento: limpa pausa humana, despausa bot, resolve alertas.
 *
 * - Lead: reativa cadência A/B/C (`next_action_at`).
 * - Cliente (carteira / convertido): só libera o handoff — pós-venda
 *   (aprovado / 30 / 60…) segue; NÃO entra em leads novos.
 */
export async function returnHandoffToPizza(opts: {
  customerId: string;
  cadenceId?: string | null;
  resolvedBy: string;
}): Promise<ReturnHandoffResult> {
  const { customerId, resolvedBy } = opts;
  const now = new Date().toISOString();

  const { data: cust } = await supabase
    .from("customers")
    .select(CUSTOMER_HANDOFF_SELECT)
    .eq("id", customerId)
    .maybeSingle();
  const isCliente = !!(cust && isHandoffClienteNotLead(cust as CustomerRow));

  let cadenceId = opts.cadenceId;
  if (cadenceId?.startsWith("customer:")) cadenceId = null;

  if (!cadenceId) {
    const { data } = await supabase
      .from("lead_cadence_state")
      .select("id")
      .eq("customer_id", customerId)
      .eq("paused_reason", HANDOFF_PAUSE_REASON)
      .maybeSingle();
    cadenceId = data?.id ?? null;
  }

  if (isCliente) {
    // Cliente: tira pausa de handoff sem agendar A/B/C. Se havia stage de lead, WON.
    const clienteCadencePatch = {
      paused_reason: null,
      paused_until: null,
      next_action_at: null,
      stage: "WON",
      won_at: now,
    } as never;
    if (cadenceId) {
      const { error: cadErr } = await supabase
        .from("lead_cadence_state")
        .update(clienteCadencePatch)
        .eq("id", cadenceId);
      if (cadErr) return { ok: false, error: cadErr.message };
    } else {
      await supabase
        .from("lead_cadence_state")
        .update(clienteCadencePatch)
        .eq("customer_id", customerId)
        .eq("paused_reason", HANDOFF_PAUSE_REASON);
    }
  } else if (cadenceId) {
    const { error: cadErr } = await supabase
      .from("lead_cadence_state")
      .update({
        paused_reason: null,
        paused_until: null,
        next_action_at: now,
      })
      .eq("id", cadenceId);
    if (cadErr) return { ok: false, error: cadErr.message };
  } else {
    const { error: cadErr } = await supabase
      .from("lead_cadence_state")
      .update({
        paused_reason: null,
        paused_until: null,
        next_action_at: now,
      })
      .eq("customer_id", customerId)
      .eq("paused_reason", HANDOFF_PAUSE_REASON);
    if (cadErr) return { ok: false, error: cadErr.message };
  }

  const { error: custErr } = await supabase
    .from("customers")
    .update({
      bot_paused: false,
      bot_paused_reason: null,
      bot_paused_at: null,
      bot_paused_until: null,
      assigned_human_id: null,
    } as never)
    .eq("id", customerId);
  if (custErr) return { ok: false, error: custErr.message };

  const { error: alertErr } = await supabase
    .from("bot_handoff_alerts")
    .update({ resolved_at: now, resolved_by: resolvedBy })
    .eq("customer_id", customerId)
    .is("resolved_at", null);
  if (alertErr) {
    console.warn("[returnHandoffToPizza] resolve alert:", alertErr.message);
  }

  return { ok: true };
}

/** Lote — cadenceIds opcionais; usa customerIds. */
export async function returnHandoffsToPizza(opts: {
  items: Array<{ customerId: string; cadenceId?: string | null }>;
  resolvedBy: string;
}): Promise<{ ok: number; failed: number; lastError?: string }> {
  let ok = 0;
  let failed = 0;
  let lastError: string | undefined;
  for (const item of opts.items) {
    const r = await returnHandoffToPizza({
      customerId: item.customerId,
      cadenceId: item.cadenceId,
      resolvedBy: opts.resolvedBy,
    });
    if (r.ok) ok++;
    else {
      failed++;
      lastError = r.error;
    }
  }
  return { ok, failed, lastError };
}

/**
 * Já é cliente (manual): marca is_converted + WON — sai dos leads A/B/C.
 * Pós-venda (aprovado/30/60) e handoff futuro continuam.
 * WhatsApp manual ok. Não é bloqueio.
 */
export async function forgetHandoffLeads(opts: {
  items: Array<{ customerId: string; cadenceId: string }>;
}): Promise<{ ok: number; failed: number; lastError?: string }> {
  let ok = 0;
  let failed = 0;
  let lastError: string | undefined;
  const now = new Date().toISOString();

  for (const item of opts.items) {
    const realCadenceId = item.cadenceId.startsWith("customer:")
      ? null
      : item.cadenceId;

    if (realCadenceId) {
      const { error: cadErr } = await supabase
        .from("lead_cadence_state")
        .update({
          stage: "WON",
          paused_until: null,
          paused_reason: "manual_won",
          next_action_at: null,
          won_at: now,
        } as never)
        .eq("id", realCadenceId);

      if (cadErr) {
        failed++;
        lastError = cadErr.message;
        continue;
      }
    } else {
      const { error: cadErr } = await supabase
        .from("lead_cadence_state")
        .update({
          stage: "WON",
          paused_until: null,
          paused_reason: "manual_won",
          next_action_at: null,
          won_at: now,
        } as never)
        .eq("customer_id", item.customerId);

      if (cadErr) {
        console.warn("[forgetHandoffLeads] cadence:", cadErr.message);
      }
    }

    // is_converted → fora de A/B/C; handoff futuro ainda lista se humano assumir.
    // Não zera bot_paused se ainda precisa atender — só marca cliente.
    // Aqui limpamos a pausa atual (atendimento resolvido como “já cliente”).
    const { error: custErr } = await supabase
      .from("customers")
      .update({
        is_converted: true,
        bot_paused: false,
        bot_paused_reason: null,
        bot_paused_at: null,
        bot_paused_until: null,
        assigned_human_id: null,
      } as never)
      .eq("id", item.customerId);

    if (custErr) {
      failed++;
      lastError = custErr.message;
      continue;
    }

    await supabase
      .from("bot_handoff_alerts")
      .update({ resolved_at: now, resolved_by: null })
      .eq("customer_id", item.customerId)
      .is("resolved_at", null);

    ok++;
  }

  return { ok, failed, lastError };
}
