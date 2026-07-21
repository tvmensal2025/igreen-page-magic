/**
 * Fluxo código digitado errado (ao cliente: sempre "código", nunca "OTP"):
 * 1) Pergunta se o código digitado é mesmo o que chegou
 * 2) Se confirmar → notifica o consultor (handoff)
 * 3) Se negar → pede para digitar de novo
 *
 * Textos editáveis no Multicanal Grupo A (9b/9c/9d) → bot_flow_steps.fallback do a10.
 * Fail-safe: defaults hardcoded se o passo/fluxo não existir.
 */

import { notifyHandoff } from "./notify-consultant.ts";

export const OTP_CONFIRM_STEP = "otp_confirmar";
export const OTP_BTN_SIM = "otp_confirm_sim";
export const OTP_BTN_NAO = "otp_confirm_nao";

const DEFAULT_ASK =
  "Recebi o código *{{codigo}}*, mas o portal *não aceitou* 😕\n\n" +
  "Confirma que *é esse mesmo* o código que chegou no seu WhatsApp?";

const DEFAULT_SIM =
  "Perfeito, anotei ✅\n\nVou chamar o *consultor* agora para ele liberar seu cadastro com esse código. Em breve ele te responde por aqui.";

const DEFAULT_NAO =
  "Sem problema! Digite aqui o *código correto* que chegou no WhatsApp (só os números).";

const DEFAULT_BTN_SIM = "✅ Sim, é esse";
const DEFAULT_BTN_NAO = "❌ Não, vou digitar";

export type CodigoConfirmCopy = {
  ask: string;
  sim: string;
  nao: string;
  buttons: { id: string; title: string }[];
};

function applyCodigo(template: string, code: string): string {
  return String(template || "")
    .replace(/\{\{\s*codigo\s*\}\}/gi, code)
    .replace(/\{\{\s*otp\s*\}\}/gi, code);
}

/** Defaults síncronos (fail-safe). Preferir resolveCodigoConfirmCopy em runtime. */
export function otpConfirmAskMessage(code: string): string {
  return applyCodigo(DEFAULT_ASK, code);
}

export function otpConfirmButtons(): { id: string; title: string }[] {
  return [
    { id: OTP_BTN_SIM, title: DEFAULT_BTN_SIM },
    { id: OTP_BTN_NAO, title: DEFAULT_BTN_NAO },
  ];
}

/**
 * Lê textos personalizados do Multicanal (fallback do a10 no fluxo A ativo).
 * Qualquer falha de leitura → defaults (não quebra cadastro).
 */
export async function resolveCodigoConfirmCopy(
  supabase: any,
  consultantId: string | null | undefined,
  code: string,
): Promise<CodigoConfirmCopy> {
  const digits = String(code || "").replace(/\D/g, "") || String(code || "").trim();
  const fallback: CodigoConfirmCopy = {
    ask: applyCodigo(DEFAULT_ASK, digits),
    sim: DEFAULT_SIM,
    nao: DEFAULT_NAO,
    buttons: otpConfirmButtons(),
  };

  try {
    if (!consultantId) return fallback;

    let { data: flow } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .eq("variant", "A")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!flow?.id) {
      const { data: anyFlow } = await supabase
        .from("bot_flows")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      flow = anyFlow;
    }
    if (!flow?.id) return fallback;

    const { data: stepRow } = await supabase
      .from("bot_flow_steps")
      .select("fallback")
      .eq("flow_id", flow.id)
      .eq("step_key", "a10_portal_otp_facial")
      .eq("is_active", true)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    const fb = (stepRow as { fallback?: Record<string, unknown> } | null)?.fallback;
    if (!fb || typeof fb !== "object") return fallback;

    const askTpl = String(fb.codigo_confirm_ask || "").trim();
    const simTpl = String(fb.codigo_confirm_sim || "").trim();
    const naoTpl = String(fb.codigo_confirm_nao || "").trim();
    const btnSim = String(fb.codigo_confirm_btn_sim || "").trim();
    const btnNao = String(fb.codigo_confirm_btn_nao || "").trim();

    return {
      ask: applyCodigo(askTpl || DEFAULT_ASK, digits),
      sim: simTpl || DEFAULT_SIM,
      nao: naoTpl || DEFAULT_NAO,
      buttons: [
        { id: OTP_BTN_SIM, title: btnSim || DEFAULT_BTN_SIM },
        { id: OTP_BTN_NAO, title: btnNao || DEFAULT_BTN_NAO },
      ],
    };
  } catch (e) {
    console.warn("[otp-confirm] resolveCodigoConfirmCopy:", (e as Error)?.message);
    return fallback;
  }
}

/** Detecta resposta de confirmação (botão ou texto). */
export function parseOtpConfirmReply(
  messageText: string,
  buttonId?: string | null,
): "sim" | "nao" | null {
  const bid = String(buttonId || "").trim().toLowerCase();
  if (bid === OTP_BTN_SIM || bid === "otp_confirm_sim") return "sim";
  if (bid === OTP_BTN_NAO || bid === "otp_confirm_nao") return "nao";

  const t = String(messageText || "").trim().toLowerCase();
  if (!t) return null;
  if (
    /^(sim+|s|ss|ssim|yes|ok|certo|confirmo|confirma|é esse|e esse|esse mesmo|isso|pode)\b/.test(t) ||
    /\b(sim[,.]?\s*(é|e)\s*esse|é\s*esse\s*mesmo|confirmo)\b/.test(t)
  ) {
    return "sim";
  }
  if (
    /^(n[aã]o+|nao|n|no|errad[oa]|outro)\b/.test(t) ||
    /\b(n[aã]o\s*(é|e)\s*esse|vou\s*digitar|digitar\s*de\s*novo|outro\s*c[oó]digo)\b/.test(t)
  ) {
    return "nao";
  }
  return null;
}

export async function markOtpNeedsConfirm(
  supabase: any,
  customerId: string,
  code: string,
  errorSnippet?: string,
): Promise<void> {
  await supabase.from("customers").update({
    status: "awaiting_otp",
    conversation_step: OTP_CONFIRM_STEP,
    otp_code: String(code).slice(0, 12),
    otp_received_at: new Date().toISOString(),
    otp_pending_replay: false,
    last_otp_dispatch_error: (errorSnippet || "otp_invalid_pending_confirm").slice(0, 200),
    updated_at: new Date().toISOString(),
  }).eq("id", customerId);
}

export async function handleOtpConfirmedByClient(
  supabase: any,
  customer: {
    id: string;
    name?: string | null;
    phone_whatsapp?: string | null;
    consultant_id?: string | null;
    otp_code?: string | null;
    conversation_step?: string | null;
  },
): Promise<{ clientReply: string }> {
  const code = String(customer.otp_code || "").replace(/\D/g, "") || "(sem código)";
  const copy = await resolveCodigoConfirmCopy(supabase, customer.consultant_id, code);

  await supabase.from("customers").update({
    bot_paused: true,
    bot_paused_reason: "otp_confirmado_portal_rejeitou",
    bot_paused_at: new Date().toISOString(),
    conversation_step: "otp_falhou",
    status: "awaiting_otp",
    updated_at: new Date().toISOString(),
  }).eq("id", customer.id);

  if (customer.consultant_id) {
    await notifyHandoff(
      customer.consultant_id,
      {
        id: customer.id,
        name: customer.name,
        phone_whatsapp: customer.phone_whatsapp,
        conversation_step: "otp_confirmar",
      },
      `Cliente confirmou que o código ${code} está correto, mas o portal iGreen rejeitou (inválido/expirado). Precisa validar manualmente.`,
      "otp_confirmado_rejeitado_portal",
    ).catch((e) => console.warn("[otp-confirm] notifyHandoff:", (e as Error)?.message));
  }

  return { clientReply: copy.sim };
}

export async function handleOtpDeniedByClient(
  supabase: any,
  customerId: string,
  consultantId?: string | null,
): Promise<{ clientReply: string }> {
  const copy = await resolveCodigoConfirmCopy(supabase, consultantId, "");

  await supabase.from("customers").update({
    otp_code: null,
    otp_received_at: null,
    otp_pending_replay: false,
    status: "awaiting_otp",
    conversation_step: "aguardando_otp",
    last_otp_dispatch_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", customerId);

  return { clientReply: copy.nao };
}
