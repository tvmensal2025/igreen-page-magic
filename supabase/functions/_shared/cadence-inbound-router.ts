/**
 * Roteador de respostas inbound vindas da cadência (Grupos B e C).
 *
 * Garante que cliques de botão, valores digitados e retornos pós-recall
 * entrem no Grupo A (cadastro) ou recebam CTA explícito — nunca vácuo.
 */

import { extractMoneyFromText } from "./parse-money.ts";
import { wantsToAdvance } from "./bot/cadastro-intent.ts";
import { isActivateIntent } from "./bot/flow-activate-routing.ts";
import {
  ANALYZE_OR_CALL_BUTTONS,
  BILL_RANGE_BUTTONS,
  type CadenceButton,
} from "./cadence-stage-buttons.ts";

export const BILL_BUTTON_VALUES: Readonly<Record<string, number>> = {
  bill_low: 200,
  bill_mid: 500,
  bill_high: 800,
};

const CADASTRO_BUTTON_IDS = new Set([
  "bill_low",
  "bill_mid",
  "bill_high",
  "analyze",
  "send_photo",
  "register",
  "activate",
  "bill_value",
]);

const EDUCATIONAL_BUTTON_IDS = new Set([
  "explain",
  "economy",
  "club",
  "referral",
  "more_benefits",
  "how_it_works",
]);

const HUMAN_BUTTON_IDS = new Set(["call_me", "human"]);
const STOP_BUTTON_IDS = new Set(["stop"]);

const ALL_CADENCE_BUTTON_IDS = new Set([
  ...CADASTRO_BUTTON_IDS,
  ...EDUCATIONAL_BUTTON_IDS,
  ...HUMAN_BUTTON_IDS,
  ...STOP_BUTTON_IDS,
]);

const OPT_OUT_TEXT = /^(sair|parar|stop|cancelar|encerrar|nao\s+quero|não\s+quero)$/i;

const EDUCATIONAL_REPLIES: Readonly<Record<string, string>> = {
  explain:
    "Funciona assim: você continua com a mesma distribuidora e instalação. A iGreen aplica créditos de energia limpa na sua conta — sem obra e sem trocar relógio.\n\nPara ver se compensa no seu caso, me diga a faixa da conta ou envie a foto 📸",
  economy:
    "A economia vem dos créditos de energia na fatura — o percentual depende do seu consumo e da distribuidora. Sem taxa para começar a análise.\n\nQual a faixa da sua conta hoje?",
  club:
    "Além da economia na conta, clientes elegíveis podem ter vantagens em parceiros — conforme regras vigentes.\n\nQuer iniciar a análise? Escolha a faixa da conta ou envie a foto 👇",
  referral:
    "Indicações podem gerar benefícios conforme as regras da iGreen — primeiro vale conhecer sua economia.\n\nEm qual faixa está sua conta?",
  more_benefits:
    "O benefício inclui economia na conta e, para elegíveis, vantagens extras no clube de parceiros.\n\nPara calcular no seu caso, qual a média da sua conta de luz?",
  how_it_works:
    "É simples: analisamos sua conta, confirmamos viabilidade e seguimos com o cadastro digital — sem obra na casa.\n\nQual faixa da sua conta hoje?",
};

export type CadenceInboundInput = {
  customer: {
    id?: string;
    name?: string | null;
    origin_recovery?: string | null;
    flow_variant?: string | null;
    conversation_step?: string | null;
    electricity_bill_value?: number | string | null;
    electricity_bill_photo_url?: string | null;
    do_not_contact?: boolean | null;
  };
  messageText?: string | null;
  buttonId?: string | null;
  isButton?: boolean;
  isFile?: boolean;
  hasImage?: boolean;
  hasDocument?: boolean;
  cadencePausedReason?: string | null;
  cadenceStage?: string | null;
};

export type CadenceRouteResult = {
  handled: boolean;
  /** Se true, o webhook continua para bot-flow (ex.: OCR de foto). */
  continueBotFlow: boolean;
  updates: Record<string, unknown>;
  reply?: string | null;
  buttons?: CadenceButton[];
  reason: string;
};

export function isCadenceButtonId(id: string | null | undefined): boolean {
  const k = String(id || "").trim().toLowerCase();
  return !!k && ALL_CADENCE_BUTTON_IDS.has(k);
}

export function isCadenceReturnContext(input: CadenceInboundInput): boolean {
  if (input.customer?.do_not_contact) return false;
  if (isCadenceButtonId(input.buttonId)) return true;
  if (String(input.customer?.origin_recovery || "") === "cadence") return true;
  const reason = String(input.cadencePausedReason || "");
  if (reason.startsWith("lead_responded")) return true;
  if (/^(COLD_|RECALL_|SMS_|CALL_)/.test(String(input.cadenceStage || ""))) return true;
  return false;
}

function firstName(customer: CadenceInboundInput["customer"]): string {
  return String(customer?.name || "").trim().split(/\s+/)[0] || "";
}

function cadastroReply(customer: CadenceInboundInput["customer"], billValue?: number): string {
  const nm = firstName(customer);
  const v = nm ? `${nm}, ` : "";
  if (billValue && billValue >= 100) {
    return `Perfeito, ${v}com média em torno de *R$ ${Math.round(billValue)}* já consigo avançar.\n\n📸 Me envie agora uma *foto ou PDF da sua conta de luz* para confirmar os dados e iniciar o cadastro.`;
  }
  return `Show, ${v}pra calcular sua economia e iniciar o cadastro, me envie uma *foto ou PDF da sua conta de luz* 📸`;
}

function lowBillReply(billValue: number): string {
  return `Obrigada por me falar. Com conta em torno de R$ ${Math.round(billValue)}, normalmente a economia fica pequena e pode não compensar agora. Vou deixar registrado e, se seu consumo subir, a gente retoma 💚`;
}

/** Atalho legado: foto/PDF direto → OCR no bot-flow (aguardando_conta). */
function cadastroUpdates(billValue?: number): Record<string, unknown> {
  const u: Record<string, unknown> = {
    flow_variant: "A",
    conversation_step: "aguardando_conta",
    origin_recovery: "cadence",
    sales_phase: "fechamento",
    custom_step_retries: 0,
    last_custom_prompt_at: null,
    ai_followups_count: 0,
  };
  if (billValue != null && Number.isFinite(billValue) && billValue > 0) {
    u.electricity_bill_value = billValue;
  }
  return u;
}

/**
 * Entrada no fluxo conversacional Grupo A (passo 3+).
 * conversation_step=null → resolveLandingStep pula a1/a2 se nome/valor já existem
 * e emite a3_explain_with_buttons (áudio + texto + botões).
 */
function conversationalEntryUpdates(
  customer: CadenceInboundInput["customer"],
  billValue?: number,
): Record<string, unknown> {
  const u: Record<string, unknown> = {
    flow_variant: "A",
    conversation_step: null,
    origin_recovery: "cadence",
    sales_phase: "fechamento",
    custom_step_retries: 0,
    last_custom_prompt_at: null,
    ai_followups_count: 0,
  };
  if (billValue != null && Number.isFinite(billValue) && billValue > 0) {
    u.electricity_bill_value = billValue;
  }
  const nm = String(customer?.name || "").trim();
  if (nm.length >= 2) {
    u.name_source = "cadence";
  }
  return u;
}

function optOutUpdates(): Record<string, unknown> {
  return {
    bot_paused: true,
    bot_paused_reason: "opt_out",
    do_not_contact: true,
  };
}

function nudgeReply(customer: CadenceInboundInput["customer"]): string {
  const nm = firstName(customer);
  const v = nm ? `${nm}, ` : "";
  return `Oi, ${v}vi sua mensagem sobre *economia na conta de luz* ⚡\n\nPara eu já calcular se compensa, escolha a faixa da sua conta ou envie a foto 👇`;
}

/**
 * Resolve o destino de um inbound pós-cadência.
 * Retorna `null` quando o contexto não é retorno de cadência B/C.
 */
export function resolveCadenceInboundRoute(input: CadenceInboundInput): CadenceRouteResult | null {
  if (!isCadenceReturnContext(input)) return null;

  const buttonId = String(input.buttonId || "").trim().toLowerCase();
  const text = String(input.messageText || "").trim();
  const hasMedia = !!(input.isFile || input.hasImage || input.hasDocument);

  // Opt-out explícito
  if (STOP_BUTTON_IDS.has(buttonId) || OPT_OUT_TEXT.test(text)) {
    return {
      handled: true,
      continueBotFlow: false,
      updates: optOutUpdates(),
      reply:
        "Tudo bem! Você foi removido da nossa lista de contato e não receberá mais mensagens automáticas. Se mudar de ideia, é só responder aqui. 🙏",
      reason: "cadence_opt_out",
    };
  }

  // Foto/PDF direto → cadastro (bot-flow faz OCR)
  if (hasMedia) {
    return {
      handled: true,
      continueBotFlow: true,
      updates: cadastroUpdates(
        Number(input.customer?.electricity_bill_value) || undefined,
      ),
      reason: "cadence_media_cadastro",
    };
  }

  // Humano
  if (HUMAN_BUTTON_IDS.has(buttonId) || /\b(me\s+liga|pode\s+ligar|quero\s+ligar|ligar\s+pra\s+mim)\b/i.test(text)) {
    return {
      handled: true,
      continueBotFlow: false,
      updates: {
        conversation_step: "aguardando_humano",
        origin_recovery: "cadence",
      },
      reply: "Combinado! Vou avisar o consultor para te ligar em breve. Se preferir, pode mandar a foto da conta por aqui também 📸",
      reason: "cadence_human",
    };
  }

  // Faixa por botão → passo 3 (a3_explain_with_buttons) + fluxo completo
  if (buttonId in BILL_BUTTON_VALUES) {
    const billValue = BILL_BUTTON_VALUES[buttonId];
    return {
      handled: true,
      continueBotFlow: true,
      updates: conversationalEntryUpdates(input.customer, billValue),
      reason: `cadence_bill_${buttonId}`,
    };
  }

  // Cadastro direto → fluxo conversacional (a3 se já tem valor, senão do início)
  if (
    CADASTRO_BUTTON_IDS.has(buttonId) &&
    buttonId !== "bill_value"
  ) {
    const existing = Number(input.customer?.electricity_bill_value);
    const billValue = Number.isFinite(existing) && existing > 0 ? existing : undefined;
    return {
      handled: true,
      continueBotFlow: true,
      updates: conversationalEntryUpdates(input.customer, billValue),
      reason: `cadence_cadastro_${buttonId}`,
    };
  }

  if (buttonId === "bill_value") {
    return {
      handled: true,
      continueBotFlow: false,
      updates: {
        flow_variant: "A",
        conversation_step: "qualificacao",
        origin_recovery: "cadence",
      },
      reply: `${firstName(input.customer) ? firstName(input.customer) + ", " : ""}qual a média da sua conta de luz? (pode digitar só o valor, ex: 450)`,
      reason: "cadence_ask_bill_value",
    };
  }

  // Educativo
  if (EDUCATIONAL_BUTTON_IDS.has(buttonId)) {
    return {
      handled: true,
      continueBotFlow: false,
      updates: { origin_recovery: "cadence" },
      reply: EDUCATIONAL_REPLIES[buttonId] || nudgeReply(input.customer),
      buttons: [...BILL_RANGE_BUTTONS],
      reason: `cadence_educational_${buttonId}`,
    };
  }

  // Valor digitado (Grupo C e B)
  const billValue = extractMoneyFromText(text);
  if (billValue != null && billValue > 0) {
    if (billValue < 100) {
      return {
        handled: true,
        continueBotFlow: false,
        updates: {
          electricity_bill_value: billValue,
          conversation_step: "valor_baixo",
          status: "rejected",
          bot_paused: true,
          bot_paused_reason: "low_bill_value",
          origin_recovery: "cadence",
        },
        reply: lowBillReply(billValue),
        reason: "cadence_low_bill",
      };
    }
    return {
      handled: true,
      continueBotFlow: true,
      updates: conversationalEntryUpdates(input.customer, billValue),
      reason: "cadence_typed_bill",
    };
  }

  // Intenção de cadastro em texto livre → fluxo conversacional completo
  if (
    text &&
  (wantsToAdvance(text) || isActivateIntent(text, buttonId) ||
    /\b(analisar|analise|análise|cadastr|ativar|enviar\s+(?:a\s+)?conta|mandar\s+(?:a\s+)?foto)\b/i.test(text))
  ) {
    const existing = Number(input.customer?.electricity_bill_value);
    const billValue = Number.isFinite(existing) && existing > 0 ? existing : undefined;
    return {
      handled: true,
      continueBotFlow: true,
      updates: conversationalEntryUpdates(input.customer, billValue),
      reason: "cadence_intent_cadastro",
    };
  }

  // Dúvida → resposta curta + CTA (nunca vácuo)
  if (text && /\?|como\s+funciona|seguro|golpe|taxa|pix|pagar|custa/i.test(text)) {
    return {
      handled: true,
      continueBotFlow: false,
      updates: { origin_recovery: "cadence", flow_variant: "A", conversation_step: "qualificacao" },
      reply:
        "Sem taxa para iniciar a análise e sem pedir Pix ao consultor. Funciona com créditos de energia na sua fatura — sem obra.\n\nQual a faixa da sua conta hoje? 👇",
      buttons: [...BILL_RANGE_BUTTONS],
      reason: "cadence_faq_nudge",
    };
  }

  // Saudação / mensagem ambígua → nudge com botões
  return {
    handled: true,
    continueBotFlow: false,
    updates: {
      flow_variant: "A",
      conversation_step: "qualificacao",
      origin_recovery: "cadence",
    },
    reply: nudgeReply(input.customer),
    buttons: [...ANALYZE_OR_CALL_BUTTONS],
    reason: "cadence_default_nudge",
  };
}

export type CadenceRouteApplyResult = {
  routed: boolean;
  continueBotFlow: boolean;
  reason?: string;
};

/**
 * Aplica roteamento no banco e envia resposta (texto ou botões).
 * Chamado pelos webhooks após `onLeadInboundResponse`.
 */
export async function applyCadenceInboundRoute(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: CadenceInboundInput & {
    customerId: string;
    remoteJid: string;
    sender: {
      sendText: (jid: string, text: string) => Promise<boolean | unknown>;
      sendButtons: (jid: string, text: string, buttons: CadenceButton[]) => Promise<boolean | unknown>;
    };
  },
): Promise<CadenceRouteApplyResult> {
  const route = resolveCadenceInboundRoute(opts);
  if (!route) return { routed: false, continueBotFlow: true };

  const now = new Date().toISOString();
  const updates = { ...route.updates, updated_at: now };

  try {
    await supabase.from("customers").update(updates).eq("id", opts.customerId);
    Object.assign(opts.customer, updates);
  } catch (e) {
    console.warn("[cadence-router] persist falhou:", (e as Error).message);
  }

  if (!route.continueBotFlow && route.reply) {
    try {
      if (route.buttons?.length) {
        await opts.sender.sendButtons(opts.remoteJid, route.reply, route.buttons);
      } else {
        await opts.sender.sendText(opts.remoteJid, route.reply);
      }
      await supabase.from("conversations").insert({
        customer_id: opts.customerId,
        message_direction: "outbound",
        message_text: route.reply,
        message_type: route.buttons?.length ? "buttons" : "text",
        conversation_step: (updates as Record<string, unknown>).conversation_step ??
          opts.customer.conversation_step,
      }).then(() => {}, () => {});
    } catch (e) {
      console.warn("[cadence-router] envio falhou:", (e as Error).message);
    }
  }

  console.log(
    `[cadence-router] customer=${opts.customerId} reason=${route.reason} continueBotFlow=${route.continueBotFlow}`,
  );

  return {
    routed: true,
    continueBotFlow: route.continueBotFlow,
    reason: route.reason,
  };
}
