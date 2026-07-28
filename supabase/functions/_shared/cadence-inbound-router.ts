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
import { matchButtonIntent, type ButtonOption } from "./ai-button-intent.ts";
import { isCoverageCityIntent, coverageCityReply } from "./coverage-city-intent.ts";

export const BILL_BUTTON_VALUES: Readonly<Record<string, number>> = {
  bill_low: 200,
  bill_mid: 500,
  bill_high: 800,
};

/** Catálogo completo: clique OU digitar o título (Evolution sem botão) → mesmo id. */
export const CADENCE_BUTTON_CATALOG: ReadonlyArray<ButtonOption> = [
  { id: "bill_low", title: "Até R$300", phrases: ["ate 300", "até 300", "ate r$300", "ate r$ 300"] },
  { id: "bill_mid", title: "R$300 a R$700", phrases: ["300 a 700", "r$300 a r$700", "de 300 a 700"] },
  { id: "bill_high", title: "Acima de R$700", phrases: ["acima de 700", "acima de r$700", "mais de 700"] },
  { id: "analyze", title: "Quero analisar", phrases: ["analisar", "quero analisar", "analise", "análise"] },
  { id: "send_photo", title: "Enviar conta", phrases: ["enviar foto", "enviar conta", "mandar foto", "foto da conta"] },
  { id: "register", title: "Cadastrar", phrases: ["cadastrar", "quero cadastrar", "cadastro"] },
  { id: "activate", title: "Quero ativar", phrases: ["quero ativar", "ativar o beneficio", "ativar o benefício"] },
  { id: "bill_value", title: "Informar valor", phrases: ["informar valor", "digitar valor"] },
  { id: "more_benefits", title: "Conhecer mais", phrases: ["saber mais", "saber mais beneficio", "conhecer mais", "mais beneficios"] },
  { id: "how_it_works", title: "Como funciona", phrases: ["como funciona", "me explica"] },
  { id: "explain", title: "Explicar", phrases: ["me explica", "explica melhor"] },
  { id: "economy", title: "Economia", phrases: ["economia", "quanto economizo"] },
  { id: "club", title: "Clube", phrases: ["clube", "beneficios do clube"] },
  { id: "referral", title: "Indicação", phrases: ["indicacao", "indicação", "indicar"] },
  { id: "call_me", title: "Pode me ligar", phrases: ["me liga", "pode me ligar"] },
  { id: "human", title: "Falar com humano", phrases: ["falar com humano", "quero atendente", "falar com atendente"] },
  { id: "stop", title: "Encerrar", phrases: ["encerrar", "parar de receber", "sair do fluxo"] },
];

const BILL_RANGE_ESTIMATES = new Set([200, 500, 800]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    "Funciona assim: você continua com a *mesma distribuidora* e instalação. A iGreen aplica *créditos de energia limpa* na sua conta — *sem obra* e sem trocar relógio.\n\nPara ver se compensa no seu caso, me diga a *faixa da conta* ou envie a foto 📸",
  economy:
    "A economia vem dos *créditos de energia* na fatura — o percentual depende do seu consumo e da distribuidora. *Sem taxa* para começar a análise.\n\n*Qual a faixa da sua conta hoje?*",
  club:
    "Além da economia na conta, clientes elegíveis podem ter *vantagens em parceiros* — conforme regras vigentes.\n\nQuer iniciar a análise? Escolha a *faixa da conta* ou envie a foto 👇",
  referral:
    "Indicações podem gerar *benefícios* conforme as regras da iGreen — primeiro vale conhecer sua economia.\n\n*Em qual faixa está sua conta?*",
  more_benefits:
    "O benefício inclui *economia na conta* e, para elegíveis, vantagens extras no *clube de parceiros*.\n\nPara calcular no seu caso, qual a *média da sua conta de luz?*",
  how_it_works:
    "É simples: analisamos sua conta, confirmamos viabilidade e seguimos com o *cadastro digital* — sem obra na casa.\n\n*Qual faixa da sua conta hoje?*",
};

export type CadenceInboundInput = {
  customer: {
    id?: string;
    name?: string | null;
    consultant_id?: string | null;
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

/**
 * Estágios dos Grupos B/C (onda fria + recall + meta).
 * NEW / GREETED / AI_QUALIFYING são Grupo A — NÃO são retorno de cadência.
 */
export function isCadenceBcStage(stage: string | null | undefined): boolean {
  const s = String(stage || "").trim();
  if (!s) return false;
  return /^(COLD_|RECALL_|SMS_|CALL_|RETARGET_)/.test(s) || s === "CLOSE_LOST";
}

/** Pré-onda / qualificação = Grupo A (não rotear pelo nudge B/C). */
export function isCadenceGroupAStage(stage: string | null | undefined): boolean {
  const s = String(stage || "").trim();
  return s === "NEW" || s === "GREETED" || s === "AI_QUALIFYING";
}

function stageFromLeadResponded(reason: string | null | undefined): string | null {
  const m = /^lead_responded(?::(.+))?$/.exec(String(reason || "").trim());
  if (!m) return null;
  return m[1] || null;
}

/**
 * Contexto de retorno B/C → Grupo A.
 * Ordem importa:
 * 1) Lead DENTRO do fluxo A / pipeline de cadastro → NUNCA intercepta
 *    (nem com buttonId: a3 usa os mesmos ids more_benefits/activate/human
 *    e o clique pertence ao flow engine, não à cadência).
 * 2) Origem Grupo A (GREETED/NEW/AI_QUALIFYING) → não intercepta.
 * 3) Só então botão de cadência / estágio B/C / origin_recovery.
 */
export function isCadenceReturnContext(input: CadenceInboundInput): boolean {
  if (input.customer?.do_not_contact) return false;

  const step = String(input.customer?.conversation_step || "");
  if (isActiveGroupAConversation(step)) return false;

  const fromResponded = stageFromLeadResponded(input.cadencePausedReason);
  // Explicitamente Grupo A → nunca nudge de cadência (mesmo com origin_recovery legado).
  if (fromResponded && isCadenceGroupAStage(fromResponded)) return false;
  if (isCadenceGroupAStage(input.cadenceStage)) return false;

  if (isCadenceButtonId(input.buttonId)) return true;

  if (fromResponded && isCadenceBcStage(fromResponded)) return true;
  if (isCadenceBcStage(input.cadenceStage)) return true;

  // Marcado pelo hook só quando vinha de B/C (ou legado já em recuperação).
  if (String(input.customer?.origin_recovery || "") === "cadence") return true;

  return false;
}

/** Já no Grupo A / fluxo custom / pipeline de cadastro. */
export function isActiveGroupAConversation(step: string | null | undefined): boolean {
  const s = String(step || "").trim();
  if (!s) return false;
  // Pesquisa/encerramento de atendimento humano ≠ funil de cadastro.
  // Sem isso, lead em aguardando_avaliacao_* após COLD_1 não entra no router B→A.
  if (
    s === "aguardando_avaliacao_atendimento" ||
    s === "atendimento_finalizado"
  ) {
    return false;
  }
  if (s.startsWith("flow:") || s.startsWith("passo_")) return true;
  if (UUID_RE.test(s)) return true;
  if (/^a\d_/.test(s) || s.startsWith("a1_") || s.startsWith("a2_") || s.startsWith("a3_")) return true;
  if (
    /^(aguardando_|ask_|confirmando_|processando_|portal_|editing_|finalizando|complete|cadastro_)/.test(s)
  ) {
    return true;
  }
  return false;
}

/** Digitar o título do botão (Evolution sem botão nativo) = mesmo que clicar. */
export function resolveCadenceButtonFromText(text: string | null | undefined): string | null {
  const msg = String(text || "").trim();
  if (!msg) return null;
  // matchButtonIntent síncrono (número/título/frase) — sem await; IA fica no apply*.
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const msgN = norm(msg);
  const num = msg.match(/^([1-9])\b/);
  if (num) {
    // números 1-3 só fazem sentido com BILL_RANGE / ANALYZE — tratado no apply com catálogo
  }
  for (const b of CADENCE_BUTTON_CATALOG) {
    const tN = norm(b.title);
    if (msgN === tN) return b.id;
    if (tN.length >= 8 && msgN.includes(tN)) return b.id;
    for (const ph of b.phrases || []) {
      const pN = norm(ph);
      if (!pN) continue;
      if (msgN === pN) return b.id;
      if (pN.length >= 8 && msgN.includes(pN)) return b.id;
      // palavra única ≥5 com boundary
      if (!pN.includes(" ") && pN.length >= 5) {
        const escaped = pN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(msgN)) return b.id;
      }
    }
  }
  return null;
}

/** Nunca troca valor preciso já salvo por faixa estimada (200/500/800). */
export function mergeBillValue(
  customer: CadenceInboundInput["customer"],
  incoming?: number | null,
): number | undefined {
  const existing = Number(customer?.electricity_bill_value);
  const hasExisting = Number.isFinite(existing) && existing > 0;
  const inc = incoming != null ? Number(incoming) : NaN;
  const hasIncoming = Number.isFinite(inc) && inc > 0;
  if (hasExisting && hasIncoming && BILL_RANGE_ESTIMATES.has(inc) && !BILL_RANGE_ESTIMATES.has(existing)) {
    return existing;
  }
  if (hasIncoming) return inc;
  if (hasExisting) return existing;
  return undefined;
}

function existingBill(customer: CadenceInboundInput["customer"]): number | undefined {
  return mergeBillValue(customer, null);
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
 * Entrada no fluxo conversacional Grupo A após retorno de cadência B/C.
 *
 * Regra: tempo passou — o gasto pode ter mudado. Sempre limpa o valor da
 * conta para o motor re-pedir o a2 (áudio + pedir valor). O nome NÃO é
 * re-pedido: se já existir, resolveLandingStep pula a1 e pousa no a2.
 *
 * Faixa/botão/valor digitado na cadência NÃO grava electricity_bill_value
 * aqui — só sinaliza engajamento; o valor oficial vem do a2.
 */
function conversationalEntryUpdates(
  customer: CadenceInboundInput["customer"],
  _billValue?: number,
): Record<string, unknown> {
  const u: Record<string, unknown> = {
    flow_variant: "A",
    conversation_step: null,
    origin_recovery: "cadence",
    sales_phase: "fechamento",
    custom_step_retries: 0,
    last_custom_prompt_at: null,
    ai_followups_count: 0,
    // Força a2 (pedir valor de novo). Valor antigo / faixa da cadência não conta.
    electricity_bill_value: null,
  };
  const nm = String(customer?.name || "").trim();
  if (nm.length >= 2) u.name_source = "cadence"; // TRUSTED → pula a1
  return u;
}

function pushToCadastro(
  customer: CadenceInboundInput["customer"],
  reason: string,
  billValue?: number,
): CadenceRouteResult {
  return {
    handled: true,
    continueBotFlow: true,
    updates: conversationalEntryUpdates(customer, billValue),
    reason,
  };
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

  let buttonId = String(input.buttonId || "").trim().toLowerCase();
  const text = String(input.messageText || "").trim();
  const hasMedia = !!(input.isFile || input.hasImage || input.hasDocument);

  // Digitou o título do botão (comum no Evolution) → trata como clique.
  if (!buttonId && text) {
    const fromText = resolveCadenceButtonFromText(text);
    if (fromText) buttonId = fromText;
  }

  const knownBill = existingBill(input.customer);

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

  if (hasMedia) {
    return {
      handled: true,
      continueBotFlow: true,
      updates: cadastroUpdates(knownBill),
      reason: "cadence_media_cadastro",
    };
  }

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

  if (buttonId in BILL_BUTTON_VALUES) {
    return pushToCadastro(input.customer, `cadence_bill_${buttonId}`, BILL_BUTTON_VALUES[buttonId]);
  }

  if (CADASTRO_BUTTON_IDS.has(buttonId) && buttonId !== "bill_value") {
    return pushToCadastro(input.customer, `cadence_cadastro_${buttonId}`, knownBill);
  }

  if (buttonId === "bill_value") {
    if (knownBill != null && knownBill >= 100) {
      return pushToCadastro(input.customer, "cadence_bill_value_already_known", knownBill);
    }
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

  // Educativo: se já tem valor, NÃO repergunta — empurra ao cadastro
  if (EDUCATIONAL_BUTTON_IDS.has(buttonId)) {
    if (knownBill != null && knownBill >= 100) {
      return pushToCadastro(input.customer, `cadence_educational_to_cadastro_${buttonId}`, knownBill);
    }
    return {
      handled: true,
      continueBotFlow: false,
      updates: { origin_recovery: "cadence", flow_variant: "A" },
      reply: EDUCATIONAL_REPLIES[buttonId] || nudgeReply(input.customer),
      buttons: [...BILL_RANGE_BUTTONS],
      reason: `cadence_educational_${buttonId}`,
    };
  }

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
    return pushToCadastro(input.customer, "cadence_typed_bill", billValue);
  }

  if (
    text &&
    (wantsToAdvance(text) || isActivateIntent(text, buttonId) ||
      /\b(analisar|analise|análise|cadastr|ativar|enviar\s+(?:a\s+)?conta|mandar\s+(?:a\s+)?foto)\b/i.test(text))
  ) {
    return pushToCadastro(input.customer, "cadence_intent_cadastro", knownBill);
  }

  // Já tem valor → qualquer ambiguidade ainda avança (sem loop)
  if (knownBill != null && knownBill >= 100) {
    return pushToCadastro(input.customer, "cadence_known_bill_forward", knownBill);
  }

  if (text && isCoverageCityIntent(text)) {
    return {
      handled: true,
      continueBotFlow: false,
      updates: { origin_recovery: "cadence", flow_variant: "A", conversation_step: "qualificacao" },
      reply: `${coverageCityReply(input.customer?.name)}\n\nQual a faixa da sua conta hoje? 👇`,
      buttons: [...BILL_RANGE_BUTTONS],
      reason: "cadence_coverage_city",
    };
  }

  if (text && /\?|como\s+funciona|é\s+seguro|é\s+golpe|tem\s+taxa|aceita\s+pix|quanto\s+custa|fidelidade|aluguel|titular|economiz|painel\s+solar|minha\s+cidade|tem\s+cobertura|atende\s+(?:na\s+)?minha/i.test(text)) {
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
 * Texto livre sem clique → catálogo determinístico + IA, MAS:
 * - só quando o contexto JÁ é retorno B/C (sem depender do botão inferido);
 * - IA nunca decide human/call_me/stop (nome próprio não pode virar handoff);
 * - dentro do fluxo A (flow:/a1/ask_*) nada disso roda.
 */
const AI_SAFE_BUTTON_IDS = new Set([
  "bill_low",
  "bill_mid",
  "bill_high",
  "analyze",
  "send_photo",
  "register",
  "activate",
  "bill_value",
  "more_benefits",
  "how_it_works",
  "explain",
  "economy",
  "club",
  "referral",
]);

const CADENCE_FAQ_CTA =
  "\n\nPara ver se compensa no *seu* caso, escolha a faixa da sua conta hoje 👇";

/**
 * Usa a base de conhecimento (FAQ + seções IA) quando o lead pergunta
 * na cadência B/C — em vez de só o texto fixo curto.
 * Fail-open: se KB/IA falhar, devolve o fallback.
 */
export async function enrichCadenceFaqWithKnowledge(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    question: string;
    consultantId?: string | null;
    leadName?: string;
    fallback: string;
  },
): Promise<{ text: string; source: "kb" | "ai" | "fallback" }> {
  const q = String(opts.question || "").trim();
  if (q.length < 4) return { text: opts.fallback, source: "fallback" };

  try {
    const { lookupKnowledge } = await import("./knowledge-lookup.ts");
    const hit = await lookupKnowledge({
      supabase,
      question: q,
      consultantId: opts.consultantId || undefined,
    });
    if (hit.found && hit.confidence >= 0.55 && String(hit.text || "").trim().length >= 24) {
      const body = String(hit.text).trim().slice(0, 1100);
      return { text: `${body}${CADENCE_FAQ_CTA}`, source: "kb" };
    }
  } catch (e) {
    console.warn("[cadence-router] lookupKnowledge:", (e as Error).message);
  }

  try {
    const { answerFaqWithAI } = await import("./ai-faq-answerer.ts");
    const ai = await answerFaqWithAI({
      supabase,
      question: q,
      consultantId: opts.consultantId || undefined,
      leadName: opts.leadName,
      currentStepLabel: "Retorno cadência (Grupo B/C)",
    });
    if (ai.text && ai.confidence >= 0.55 && String(ai.text).trim().length >= 20) {
      const body = String(ai.text).trim().slice(0, 1100);
      return { text: `${body}${CADENCE_FAQ_CTA}`, source: "ai" };
    }
  } catch (e) {
    console.warn("[cadence-router] answerFaqWithAI:", (e as Error).message);
  }

  return { text: opts.fallback, source: "fallback" };
}

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
  // Gate ANTES de qualquer inferência: o contexto precisa ser retorno B/C
  // por si só. Sem isso, a IA mapeava o NOME digitado no a1 para "humano".
  const inCadenceContext = isCadenceReturnContext({ ...opts, buttonId: opts.buttonId ?? null });
  if (!inCadenceContext) return { routed: false, continueBotFlow: true };

  if (!opts.buttonId && opts.messageText && !opts.isFile && !opts.hasImage && !opts.hasDocument) {
    let resolved = resolveCadenceButtonFromText(opts.messageText);
    if (!resolved) {
      try {
        const intent = await matchButtonIntent(String(opts.messageText), [...CADENCE_BUTTON_CATALOG], {
          apiKey: Deno.env.get("LOVABLE_API_KEY"),
          timeoutMs: 3500,
        });
        // IA só decide destinos "seguros" (cadastro/educativo). Handoff,
        // ligação e opt-out exigem clique real ou frase determinística.
        if (intent.match && intent.confidence >= 0.75 && AI_SAFE_BUTTON_IDS.has(intent.match)) {
          resolved = intent.match;
          console.log(
            `[cadence-router] ai-button-intent match=${intent.match} conf=${intent.confidence} reason=${intent.reason}`,
          );
        }
      } catch (e) {
        console.warn("[cadence-router] ai-button-intent falhou:", (e as Error).message);
      }
    }
    if (resolved) {
      opts.buttonId = resolved;
      opts.isButton = true;
    }
  }

  const route = resolveCadenceInboundRoute(opts);
  if (!route) return { routed: false, continueBotFlow: true };

  // Pergunta aberta / educativo: enriquecer com a base de conhecimento.
  const reason = String(route.reason || "");
  const wantsKb =
    reason === "cadence_faq_nudge" ||
    reason.startsWith("cadence_educational_");
  if (
    wantsKb &&
    !route.continueBotFlow &&
    route.reply &&
    opts.messageText &&
    !opts.isFile &&
    !opts.hasImage &&
    !opts.hasDocument
  ) {
    const enriched = await enrichCadenceFaqWithKnowledge(supabase, {
      question: String(opts.messageText),
      consultantId: opts.customer.consultant_id,
      leadName: firstName(opts.customer),
      fallback: route.reply,
    });
    route.reply = enriched.text;
    if (enriched.source !== "fallback") {
      console.log(`[cadence-router] faq via ${enriched.source} reason=${reason}`);
    }
  }

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
