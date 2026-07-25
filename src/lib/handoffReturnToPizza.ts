/**
 * Handoff humano fora da pizza → devolver ao ciclo A/B/C.
 * Limpa pausa de cadência + bot e resolve alertas abertos.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  CADENCE_GROUP_BADGE,
  cadenceStageGroup,
  labelCadenceStage,
} from "@/lib/cadenceStageLabels";
import { onlyDigits } from "@/lib/phone";
import { resolveLeadPanelDisplayName } from "@/lib/customerDisplayName";

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
};

const REASON_LABEL: Record<string, string> = {
  auto_loop_detected: "Loop detectado — lead repetiu o mesmo passo várias vezes",
  auto_orphan_step_detected: "Passo órfão — fluxo alterado e lead em passo inexistente",
  custom_step_no_match_retries_exhausted: "IA não entendeu a resposta após várias tentativas",
  duvida_fora_faq: "Pergunta fora da base de conhecimento",
  cadastro_falhou: "Cadastro no portal falhou",
  no_media_received: "Não enviou foto/documento pedido",
  step_misconfigured_or_lead_off_topic: "Passo mal configurado ou lead saiu do roteiro",
  handoff_humano: "Atendimento humano (handoff)",
  ai_handoff_duvidas: "Handoff por dúvidas",
  humano_assumiu: "Você assumiu o atendimento",
};

export function formatHandoffReason(reason: string | null | undefined): string {
  const r = String(reason || "").trim();
  if (!r) return "Handoff — aguardando você";
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
  if (r === HANDOFF_PAUSE_REASON) return "handoff";
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

/**
 * Lista leads do consultor fora da pizza que ainda precisam de ação:
 * só handoff humano com telefone útil.
 *
 * Não lista: invalid_phone / sem_celular / DNC / opt-out — já estão
 * resolvidos (bloqueados ou inúteis) e não há o que fazer no painel.
 */
export async function loadHandoffLeads(consultantId: string): Promise<HandoffLead[]> {
  const { data: cadenceRows, error } = await supabase
    .from("lead_cadence_state")
    .select("id, customer_id, stage, paused_until, paused_reason, next_action_at, updated_at")
    .eq("consultant_id", consultantId)
    .eq("paused_reason", HANDOFF_PAUSE_REASON)
    .order("updated_at", { ascending: false })
    .limit(300);

  if (error) throw new Error(error.message);
  const rows = cadenceRows || [];
  if (!rows.length) return [];

  const customerIds = rows.map((r) => r.customer_id).filter(Boolean) as string[];

  const [{ data: customers }, { data: alerts }] = await Promise.all([
    supabase
      .from("customers")
      .select(
        "id, name, phone_whatsapp, conversation_step, bot_paused, bot_paused_reason, name_source, last_inbound_media_url, last_inbound_media_kind, do_not_contact",
      )
      .in("id", customerIds),
    supabase
      .from("bot_handoff_alerts")
      .select("id, customer_id, reason, user_message, created_at")
      .eq("consultant_id", consultantId)
      .in("customer_id", customerIds)
      .is("resolved_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const custById = new Map((customers || []).map((c) => [c.id, c]));
  const alertByCustomer = new Map<
    string,
    { id: string; customer_id: string | null; reason: string | null; user_message: string | null; created_at: string }
  >();
  for (const a of alerts || []) {
    if (!a.customer_id) continue;
    if (!alertByCustomer.has(a.customer_id)) alertByCustomer.set(a.customer_id, a);
  }

  const out: HandoffLead[] = [];
  for (const row of rows) {
    const c = custById.get(row.customer_id);
    const phone = c?.phone_whatsapp || "";
    // Sem número útil ou já bloqueado → não aparece (nada a fazer aqui).
    if (!hasUsableHandoffPhone(phone)) continue;
    if ((c as { do_not_contact?: boolean | null } | undefined)?.do_not_contact) continue;

    const alert = alertByCustomer.get(row.customer_id);
    const name = String(c?.name || "").trim();
    const display = resolveLeadPanelDisplayName({
      name: c?.name,
      nameSource: (c as { name_source?: string | null } | undefined)?.name_source,
    });
    const grupo = cadenceStageGroup(String(row.stage));
    const category = classifyPauseReason(row.paused_reason);
    const mediaKind = String((c as { last_inbound_media_kind?: string | null } | undefined)?.last_inbound_media_kind || "");
    const mediaUrl = String((c as { last_inbound_media_url?: string | null } | undefined)?.last_inbound_media_url || "").trim();
    const photoUrl =
      mediaUrl && /image|photo|picture|sticker/i.test(mediaKind) ? mediaUrl : null;
    out.push({
      cadenceId: row.id,
      customerId: row.customer_id,
      stage: String(row.stage),
      stageLabel: labelCadenceStage(String(row.stage), "short"),
      grupo,
      grupoLabel: grupo ? CADENCE_GROUP_BADGE[grupo] || grupo : "—",
      name: name || "(sem nome)",
      displayName: display.displayName || name || "(sem nome)",
      phone,
      phoneFormatted: formatPhoneBr(phone),
      conversationStep: c?.conversation_step ?? null,
      botPaused: !!c?.bot_paused,
      botPausedReason: c?.bot_paused_reason ?? null,
      pausedUntil: row.paused_until,
      pausedReasonRaw: row.paused_reason ?? null,
      category,
      alertId: alert?.id ?? null,
      alertReason: alert?.reason ?? null,
      alertMessage: alert?.user_message ?? null,
      alertAt: alert?.created_at ?? null,
      photoUrl,
    });
  }
  return out;
}

export type ReturnHandoffResult = {
  ok: boolean;
  error?: string;
};

/**
 * Devolve um lead ao ciclo: limpa pausa de cadência, despausa bot, resolve alertas.
 */
export async function returnHandoffToPizza(opts: {
  customerId: string;
  cadenceId?: string | null;
  resolvedBy: string;
}): Promise<ReturnHandoffResult> {
  const { customerId, resolvedBy } = opts;
  const now = new Date().toISOString();

  let cadenceId = opts.cadenceId;
  if (!cadenceId) {
    const { data } = await supabase
      .from("lead_cadence_state")
      .select("id")
      .eq("customer_id", customerId)
      .eq("paused_reason", HANDOFF_PAUSE_REASON)
      .maybeSingle();
    cadenceId = data?.id ?? null;
  }

  if (cadenceId) {
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
    // Sem linha handoff: ainda tenta limpar qualquer pausa handoff do customer
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
    })
    .eq("id", customerId);
  if (custErr) return { ok: false, error: custErr.message };

  const { error: alertErr } = await supabase
    .from("bot_handoff_alerts")
    .update({ resolved_at: now, resolved_by: resolvedBy })
    .eq("customer_id", customerId)
    .is("resolved_at", null);
  if (alertErr) {
    // Não bloqueia o retorno à pizza se só o alerta falhar
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
 * Esquecer lead: marca WON / já cliente — sai do ciclo automático,
 * WhatsApp manual continua ok (não é bloqueio).
 */
export async function forgetHandoffLeads(opts: {
  items: Array<{ customerId: string; cadenceId: string }>;
}): Promise<{ ok: number; failed: number; lastError?: string }> {
  let ok = 0;
  let failed = 0;
  let lastError: string | undefined;
  const now = new Date().toISOString();

  for (const item of opts.items) {
    const { error: cadErr } = await supabase
      .from("lead_cadence_state")
      .update({
        stage: "WON",
        paused_until: null,
        paused_reason: "manual_won",
        next_action_at: null,
      } as never)
      .eq("id", item.cadenceId);

    if (cadErr) {
      failed++;
      lastError = cadErr.message;
      continue;
    }

    // Despausa bot para não ficar “preso” no handoff visual, mas sem reativar ciclo.
    await supabase
      .from("customers")
      .update({
        bot_paused: false,
        bot_paused_reason: null,
        bot_paused_at: null,
      })
      .eq("id", item.customerId);

    await supabase
      .from("bot_handoff_alerts")
      .update({ resolved_at: now, resolved_by: null })
      .eq("customer_id", item.customerId)
      .is("resolved_at", null);

    ok++;
  }

  return { ok, failed, lastError };
}
