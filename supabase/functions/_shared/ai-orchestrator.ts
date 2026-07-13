// AI Orchestrator — triagem (Gemini Flash) → GPT-5.5 com tool-calling →
// especialista (Gemini 3.1 Pro RAG) executa.
//
// Princípio: GPT-5.5 só é chamado quando a triagem decide que vale a pena.
// Botão/mídia/passo previsível → "deterministic" (zero IA).
//
// Uso típico:
//   const r = await runOrchestrator({ supabase, customer, message, step, history });
//   if (r.reply) await sendText(jid, r.reply);

import { aiChatCascade } from "./ai-gateway.ts";
import { trackAIUsage, logAIDecision, type AIPhase } from "./ai-cost-tracker.ts";
import { answerFaqWithAI } from "./ai-faq-answerer.ts";
import { formatReply, formatFaqReply } from "./format-reply.ts";

export type OrchestratorRoute =
  | "deterministic"  // botão/mídia — fluxo determinístico cuida
  | "answer_faq"     // chamar Gemini 3.1 Pro com RAG
  | "escalate"       // pausar bot e notificar humano
  | "clarify"        // pedir reformulação curta
  | "continue";      // sem ação, deixa o fluxo seguir

export interface TriageOut {
  route: OrchestratorRoute;
  intent: string;
  needs_orchestrator: boolean;
  confidence: number;
}

export interface OrchestratorInput {
  supabase: any;
  customer: any;
  consultantId: string;
  message: string;
  step?: string | null;
  /** Ação concreta que o bot está aguardando NESTE passo (ex: "confirmar o
   *  telefone com DDD"). Evita que a IA invente em que etapa o lead está. */
  stepGoal?: string | null;
  history?: string;       // pre-formatted "Lead: ... / Bot: ..." lines
  isButton?: boolean;
  hasMedia?: boolean;
  forceModel?: { triage?: string; orchestrator?: string; faq?: string };
}

export interface OrchestratorOutput {
  reply: string;          // text to send (empty = no reply)
  route: OrchestratorRoute;
  intent: string;
  confidence: number;
  shouldHandoff: boolean;
  modelChain: string[];   // models actually used (audit)
  latencyMs: number;
}

// PREMIUM: triagem usa GPT-5-mini (raciocínio melhor que Flash, ainda barato/rápido)
const TRIAGE_MODEL = "openai/gpt-5-mini";
const ORCH_MODEL   = "openai/gpt-5.5";

const TRIAGE_SCHEMA = {
  name: "triage",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      route: { type: "string", enum: ["deterministic","answer_faq","escalate","clarify","continue"] },
      intent: { type: "string" },
      needs_orchestrator: { type: "boolean" },
      confidence: { type: "number" },
    },
    required: ["route","intent","needs_orchestrator","confidence"],
  },
};

const TRIAGE_SYSTEM = `Você triagem de mensagens WhatsApp de leads iGreen Energy.
Classifique a mensagem do lead em uma das rotas:
- "deterministic": clicou botão, mandou mídia esperada, ou respondeu o que o passo pediu (ex: CPF/valor/CEP). Fluxo determinístico cuida.
- "answer_faq": tem dúvida real, objeção ou pergunta sobre produto/processo/segurança/cobrança.
- "escalate": pede humano, ameaça, reclamação grave, raiva, cancelar, desistir.
- "clarify": mensagem muito curta/ambígua que precisa pergunta de volta.
- "continue": saudação/agradecimento — deixa fluxo seguir sem responder específico.

needs_orchestrator = true APENAS se route="answer_faq" ou "escalate" (= vale pagar GPT pra decidir tom/resposta).
confidence 0..1.`;

async function runTriage(input: OrchestratorInput): Promise<TriageOut> {
  if (input.isButton || input.hasMedia) {
    return { route: "deterministic", intent: input.isButton ? "button" : "media", needs_orchestrator: false, confidence: 1 };
  }
  const msg = (input.message || "").trim();
  if (!msg) return { route: "continue", intent: "empty", needs_orchestrator: false, confidence: 1 };
  if (msg.length < 3) return { route: "clarify", intent: "too_short", needs_orchestrator: false, confidence: 0.9 };

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await aiChatCascade({
      model: input.forceModel?.triage || TRIAGE_MODEL,
      temperature: 0.1,
      maxTokens: 400,
      jsonSchema: TRIAGE_SCHEMA,
      messages: [
        { role: "system", content: TRIAGE_SYSTEM },
        { role: "user", content: `PASSO ATUAL: ${input.step || "?"}\nAÇÃO PENDENTE: ${input.stepGoal || "—"}\nMENSAGEM: "${msg.slice(0, 600)}"` },
      ],
      signal: ctrl.signal,
    });
    clearTimeout(to);
    void trackAIUsage({ supabase: input.supabase, consultantId: input.consultantId, model: r.modelUsed, phase: "triage", usage: r.usage });
    const j = r.json as TriageOut | undefined;
    if (j && typeof j.route === "string") return j;
  } catch (e) {
    console.warn("[orchestrator] triage failed:", (e as Error).message);
  }
  // Fallback heurístico: assume answer_faq se tem ? ou >20 chars
  return {
    route: msg.includes("?") || msg.length > 20 ? "answer_faq" : "continue",
    intent: "heuristic_fallback",
    needs_orchestrator: msg.includes("?") || msg.length > 20,
    confidence: 0.4,
  };
}

const ORCH_SCHEMA = {
  name: "orchestrate",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["answer_faq","escalate","clarify","continue"] },
      reply: { type: "string", description: "Resposta final pro lead em PT-BR, curta (2-4 frases), tom WhatsApp." },
      use_rag: { type: "boolean", description: "Se true, ignore reply e chame Gemini 3.1 Pro com base de conhecimento." },
      reason: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["action","reply","use_rag","reason","confidence"],
  },
};

function buildOrchSystem(personaText: string | null): string {
  const persona = personaText ? `\n\nPERSONA DO CONSULTOR:\n${personaText}` : "";
  return `Você é o cérebro de um bot WhatsApp da iGreen Energy (energia por assinatura, desconto até 20% na conta de luz).
Decida UMA ação. Regras:
1. "answer_faq" + use_rag=true → quando a pergunta precisa de fato/número/processo específico. Deixe RAG responder.
2. "answer_faq" + use_rag=false + reply preenchido → quando você consegue responder com confiança usando contexto da conversa, sem precisar de RAG.
3. "escalate" → lead pede humano, ameaça, reclamação grave, raiva, cancelar, desistir, ou pergunta exige negociação caso-a-caso. Escreva reply acolhedora de 1 frase ("Já chamei um consultor, ele te responde em instantes 😊").
4. "clarify" → ambíguo demais. reply = 1 pergunta curta pra entender.
5. "continue" → não precisa responder agora (ex: ok/obrigado). reply="".

CONTEXTO DO PASSO (CRÍTICO): o bot está aguardando uma AÇÃO PENDENTE específica do lead (ela vem no prompt).
- NUNCA invente em que etapa o cadastro está. Não diga "estamos validando seus documentos", "conferindo seu pagamento" etc. se isso não estiver na AÇÃO PENDENTE.
- Se o lead perguntar sobre o status ("já estou me cadastrando?", "em que passo estou?"), responda com base APENAS na AÇÃO PENDENTE — explique de forma curta e honesta o que falta fazer agora.
- NÃO repita literalmente o pedido do dado (ex: não peça o telefone de novo): o sistema reapresenta a pergunta automaticamente logo depois da sua resposta. Sua resposta deve só esclarecer a dúvida.

Estilo: PT-BR, WhatsApp, 2-4 frases, no máx 1 emoji simples, sem markdown pesado.${persona}`;
}

async function runOrchestratorBrain(input: OrchestratorInput): Promise<{
  action: "answer_faq" | "escalate" | "clarify" | "continue";
  reply: string; use_rag: boolean; reason: string; confidence: number;
  modelUsed: string;
}> {
  const { data: coRow } = await input.supabase
    .from("consultants").select("ai_persona").eq("id", input.consultantId).maybeSingle();
  const persona = (coRow as any)?.ai_persona || null;

  let solarContext = "";
  const cid = input.customer?.id;
  const msgLower = (input.message || "").toLowerCase();
  if (
    cid &&
    /telhad|placa|fotovolta|painel solar|kwp|serve\s+meu|cabem/.test(msgLower)
  ) {
    try {
      const { getSolarContextForCustomer } = await import("./solar/analyze-service.ts");
      const ctx = await getSolarContextForCustomer(input.supabase, cid);
      if (ctx) solarContext = `\nDADOS ANÁLISE SOLAR (use se relevante, cite como estimativa):\n${ctx}\n`;
    } catch {
      /* best-effort */
    }
  }

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await aiChatCascade({
      model: input.forceModel?.orchestrator || ORCH_MODEL,
      temperature: 0.4,
      maxTokens: 800,
      jsonSchema: ORCH_SCHEMA,
      messages: [
        { role: "system", content: buildOrchSystem(persona) },
        { role: "user", content:
`PASSO: ${input.step || "?"}
AÇÃO PENDENTE DO BOT (o que o lead precisa fazer agora): ${input.stepGoal || "—"}
NOME LEAD: ${String(input.customer?.name || "").split(/\s+/)[0] || "(?)"}
VALOR CONTA: ${input.customer?.electricity_bill_value || "(?)"}
ESTADO: ${input.customer?.address_state || "(?)"}
${solarContext}${input.customer?.conversation_summary ? `\nRESUMO DA CONVERSA (memória persistente):\n${String(input.customer.conversation_summary).slice(0, 1000)}\n` : ""}
HISTÓRICO RECENTE:
${(input.history || "").slice(-2400)}

MENSAGEM ATUAL DO LEAD: "${(input.message || "").slice(0, 600)}"

Decida.`
        },
      ],
      signal: ctrl.signal,
    });
    clearTimeout(to);
    void trackAIUsage({ supabase: input.supabase, consultantId: input.consultantId, model: r.modelUsed, phase: "orchestrator", usage: r.usage });
    const j = r.json || {};
    return {
      action: (j.action || "continue") as any,
      reply: String(j.reply || ""),
      use_rag: !!j.use_rag,
      reason: String(j.reason || ""),
      confidence: Number(j.confidence) || 0.5,
      modelUsed: r.modelUsed,
    };
  } catch (e) {
    clearTimeout(to);
    console.warn("[orchestrator] brain failed:", (e as Error).message);
    return { action: "continue", reply: "", use_rag: false, reason: "brain_error", confidence: 0, modelUsed: "n/a" };
  }
}

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorOutput> {
  const t0 = Date.now();
  const modelChain: string[] = [];

  const triage = await runTriage(input);
  modelChain.push(`triage:${input.forceModel?.triage || TRIAGE_MODEL}`);

  // PREMIUM: sempre que precisar responder o lead (answer_faq/escalate/clarify),
  // força o cérebro GPT-5.5 a formular — não confia na triagem pra responder.
  if (triage.route === "answer_faq" || triage.route === "escalate" || triage.route === "clarify") {
    triage.needs_orchestrator = true;
  }

  // Caminho barato
  if (!triage.needs_orchestrator) {
    void logAIDecision({
      supabase: input.supabase,
      customerId: input.customer?.id,
      consultantId: input.consultantId,
      phase: "triage",
      toolCalled: triage.route,
      model: input.forceModel?.triage || TRIAGE_MODEL,
      userInput: input.message,
      intentDetected: triage.intent,
      confidence: triage.confidence,
      latencyMs: Date.now() - t0,
      stepBefore: input.step || null,
      replySent: false,
      reasoning: `triage→${triage.route} (cheap path)`,
    });
    return {
      reply: "", route: triage.route, intent: triage.intent,
      confidence: triage.confidence, shouldHandoff: false,
      modelChain, latencyMs: Date.now() - t0,
    };
  }

  // GPT-5.5 decide
  const brain = await runOrchestratorBrain(input);
  modelChain.push(`brain:${brain.modelUsed}`);

  let finalReply = brain.reply;
  let shouldHandoff = brain.action === "escalate";
  let phase: AIPhase = "orchestrator";
  let tool: string = brain.action;

  // Se cérebro pediu RAG, chama Gemini 3.1 Pro especialista
  if (brain.action === "answer_faq" && brain.use_rag) {
    try {
      const firstName = String(input.customer?.name || "").split(/\s+/)[0] || "";
      const faq = await answerFaqWithAI({
        supabase: input.supabase,
        question: input.message,
        leadName: firstName,
        currentStepLabel: input.step || undefined,
        consultantId: input.consultantId,
        recentHistory: input.history,
        model: input.forceModel?.faq || "google/gemini-3.1-pro-preview",
      });
      if (faq.text) finalReply = faq.text;
      if (faq.shouldHandoff) shouldHandoff = true;
      modelChain.push(`rag:gemini-3.1-pro`);
      phase = "faq";
      tool = "answer_faq_rag";
    } catch (e) {
      console.warn("[orchestrator] RAG failed:", (e as Error).message);
    }
  }

  // Embeleza a resposta final. FAQ/RAG → layout arejado + sem push de cadastro
  // nem "clique nas opções" fantasma. Demais rotas → formatReply padrão.
  const prettyReply = (tool === "answer_faq_rag" || brain.action === "answer_faq")
    ? formatFaqReply(finalReply)
    : formatReply(finalReply, { stripCadastroPush: true });

  void logAIDecision({
    supabase: input.supabase,
    customerId: input.customer?.id,
    consultantId: input.consultantId,
    phase, toolCalled: tool,
    model: brain.modelUsed,
    userInput: input.message,
    aiOutput: prettyReply,
    intentDetected: triage.intent,
    confidence: brain.confidence,
    latencyMs: Date.now() - t0,
    stepBefore: input.step || null,
    replySent: !!prettyReply,
    reasoning: brain.reason,
  });

  return {
    reply: prettyReply,
    route: brain.action as OrchestratorRoute,
    intent: triage.intent,
    confidence: brain.confidence,
    shouldHandoff,
    modelChain,
    latencyMs: Date.now() - t0,
  };
}
