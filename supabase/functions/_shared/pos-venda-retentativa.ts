/**
 * Retentativa pós-reprovado (~60 dias):
 * 1) Cron move para `retentativa` e manda WA com botão (Whapi)
 *    ou lista numerada *1.* (Evolution — sem botão real)
 * 2) Clique / resposta "1" → sai da carteira, entra Grupo A (cadastro)
 */

export const PV_RETENTATIVA_DAYS = 60;
export const PV_RETENTATIVA_BUTTON_ID = "pv_retentativa_cadastro";
export const PV_RETENTATIVA_BUTTON_TITLE = "Quero tentar de novo";
export const PV_RETENTATIVA_STAGE = "retentativa";
export const PV_RETENTATIVA_STAGE_KEY = "pv_retentativa";

/** Prompt do sendChoice: Whapi = botão; Evolution = texto com *1.* */
export const PV_RETENTATIVA_CHOICE_PROMPT =
  "Toque no botão *Quero tentar de novo* ou digite *1* se quiser participar de uma nova análise.";

const BUTTON_ALIASES = new Set([
  PV_RETENTATIVA_BUTTON_ID,
  "quero tentar de novo",
  "quero tentar",
  "tentar de novo",
  "nova analise",
  "nova análise",
  "participar",
]);

export function isPosVendaRetentativaClick(
  buttonId: string | null | undefined,
  messageText: string | null | undefined,
  customer: { pos_venda_stage?: string | null } | null | undefined,
): boolean {
  const stage = String(customer?.pos_venda_stage || "").toLowerCase();
  if (stage !== PV_RETENTATIVA_STAGE) return false;

  const bid = String(buttonId || "").trim().toLowerCase();
  if (bid && (bid === PV_RETENTATIVA_BUTTON_ID || BUTTON_ALIASES.has(bid))) {
    return true;
  }

  const txt = String(messageText || "").trim().toLowerCase();
  if (!txt) return false;
  // Evolution: "1", "1.", "1)" — opção única da lista numerada
  if (/^1[.)]?$/.test(txt)) return true;
  for (const alias of BUTTON_ALIASES) {
    if (txt.includes(alias)) return true;
  }
  return false;
}

export type RecadastroPatch = Record<string, unknown>;

/**
 * Patch para sair do CRM pós-venda e reabrir Grupo A / cadastro.
 * Sync iGreen respeita `pos_venda_recadastro_at` para não re-flipar a origem.
 */
export function buildPosVendaRecadastroPatch(
  customer: {
    name?: string | null;
    name_source?: string | null;
  },
  nowIso: string = new Date().toISOString(),
): RecadastroPatch {
  const patch: RecadastroPatch = {
    customer_origin: "whatsapp_lead",
    status: "pending",
    pos_venda_stage: null,
    pos_venda_manual: false,
    pos_venda_pending_stage: null,
    pos_venda_reason: null,
    pos_venda_approved_at: null,
    pos_venda_recadastro_at: nowIso,
    portal_submitted_at: null,
    conversation_step: null,
    flow_variant: "A",
    origin_recovery: "pos_venda_retentativa",
    sales_phase: "fechamento",
    bot_paused: false,
    bot_paused_reason: null,
    bot_paused_until: null,
    custom_step_retries: 0,
    last_custom_prompt_at: null,
    ai_followups_count: 0,
    electricity_bill_value: null,
    andamento_igreen: null,
  };
  const nm = String(customer?.name || "").trim();
  if (nm.length >= 2) {
    // Mantém nome; marca confiável o bastante para pular a1 se o landing permitir.
    patch.name_source = customer.name_source || "cadence";
  }
  return patch;
}

export async function activatePosVendaRecadastro(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customer: {
    id: string;
    name?: string | null;
    name_source?: string | null;
    consultant_id?: string | null;
  },
): Promise<{ ok: boolean; patch: RecadastroPatch; error?: string }> {
  const patch = buildPosVendaRecadastroPatch(customer);
  const { error } = await supabase.from("customers").update(patch).eq("id", customer.id);
  if (error) {
    return { ok: false, patch, error: error.message };
  }

  try {
    const { ensureCadenceState } = await import("./cadence-hooks.ts");
    if (customer.consultant_id) {
      await ensureCadenceState(supabase, customer.id, customer.consultant_id);
    }
  } catch (e) {
    console.warn(
      "[pos-venda-retentativa] ensureCadenceState falhou:",
      (e as Error)?.message,
    );
  }

  return { ok: true, patch };
}
