// Intent classifier — regex pre-pass + OpenAI GPT-5-mini (fallback Gemini).
// NO business logic, NO copy generation. Just label the message.

import type { Intent } from "./state-machine.ts";
import { openaiChat } from "../../../_shared/openai.ts";
import { getConfidenceThresholds, logAiDecision } from "../../../_shared/ai-decisions.ts";

const INTENTS: Intent[] = [
  "saudacao",
  "quer_cadastrar",
  "quer_humano",
  "tem_duvida",
  "ja_assistiu_video",
  "nao_quer",
  "afirmacao",
  "negacao",
  "outro",
];

// Cheap deterministic regex pre-pass — handles ~70% of cases without LLM cost.
// Inclui os TÍTULOS reais dos botões do fluxo (whapi/evolution variante D) para
// que cliques que chegam como TEXTO (ex.: "Quero simular", "Falar com Rafael")
// sejam classificados de forma DETERMINÍSTICA (conf 0.95 → execute) em vez de
// caírem no fallback "outro/0.6" (repeat). Validado via ai_decisions: 33% das
// classificações caíam em fallback, quase todas títulos de botão. (2026-05-30)
const RX = {
  quer_cadastrar: /\b(cadastr\w*|quero (me )?(cadastrar|participar)|quero simular|simular|simula[cç][ãa]o|fazer simula|vamos l[áa]|bora|simbora|inscrever|me cadastra|fechado|aceito|quero o desconto|quero economizar)\b/i,
  quer_humano: /\b(humano|atendente|pessoa real|operador|consultor de verdade|falar com algu[eé]m|falar com (o |a )?\w+|falar com rafael|chamar (o |a )?\w+|atendimento)\b/i,
  saudacao: /^(oi+|ol[áa]|bom dia|boa tarde|boa noite|hey|opa)\b/i,
  ja_assistiu_video: /\b(j[áa]? ?vi|assisti|terminei|acabei de ver|vi sim)\b/i,
  afirmacao: /^(sim|s|claro|pode|quero|positivo|👍|✅|1️⃣?|^1$)\b/i,
  negacao: /^(n[ãa]o|n|nao|negativo|👎|❌|2️⃣?|^2$)\b/i,
  tem_duvida: /\?|\b(d[úu]vida|d[úu]vidas|tenho d[úu]vida|ainda tenho d[úu]vida|como funciona|como que funciona|quanto|quanto custa|seguro|confi[áa]vel|golpe)\b/i,
  nao_quer: /\b(n[ãa]o quero|depois|mais tarde|agora n[ãa]o|deixa pra l[áa])\b/i,
};

function regexClassify(text: string): Intent | null {
  const t = text.trim();
  if (!t) return null;
  if (RX.quer_cadastrar.test(t)) return "quer_cadastrar";
  if (RX.quer_humano.test(t)) return "quer_humano";
  if (RX.nao_quer.test(t)) return "nao_quer";
  if (RX.ja_assistiu_video.test(t)) return "ja_assistiu_video";
  if (RX.saudacao.test(t)) return "saudacao";
  if (RX.tem_duvida.test(t)) return "tem_duvida";
  if (RX.afirmacao.test(t)) return "afirmacao";
  if (RX.negacao.test(t)) return "negacao";
  return null;
}

export type ClassifyAction = "execute" | "repeat" | "handoff";

export interface ClassifyResult {
  intent: Intent;
  confidence: number;
  source: "regex" | "openai" | "llm" | "fallback";
  action?: ClassifyAction;
}

const PROMPT = (text: string, step: string) => `Você classifica mensagens de WhatsApp de leads de energia solar brasileiros.
Step atual: ${step}
Mensagem do lead: "${text.trim().slice(0, 400)}"

Considere gírias brasileiras:
- "tá", "tá bom", "fechou", "bora", "simbora", "pode crer", "pode", "demorou", "blz", "beleza", "ok", "show", "claro" = afirmacao
- "nem", "nem rola", "nada", "deixa", "passo" = negacao
- "explica", "como assim", "o que é" = tem_duvida

Opções: ${INTENTS.join(", ")}.
- saudacao: cumprimentos
- quer_cadastrar: aceita iniciar cadastro / quer o desconto
- quer_humano: pede atendente humano
- tem_duvida: faz pergunta sobre o serviço
- ja_assistiu_video: confirma que viu o vídeo
- nao_quer: rejeita ou adia
- afirmacao: confirmação genérica ("sim", "ok", "tá")
- negacao: negação genérica ("não", "nem")
- outro: nada acima

Retorne APENAS JSON: {"intent": "...", "confidence": 0.0-1.0}`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: INTENTS },
    confidence: { type: "number" },
  },
  required: ["intent", "confidence"],
};

async function classifyOpenAI(text: string, step: string): Promise<ClassifyResult | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8_000);
    const res = await openaiChat({
      model: "gpt-5-mini",
      // gpt-5-mini rejeita temperature != 1; usar default.
      jsonSchema: { name: "intent", schema: SCHEMA },
      messages: [{ role: "user", content: PROMPT(text, step) }],
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const parsed = res.json;
    if (!parsed) return null;
    const intent: Intent = INTENTS.includes(parsed.intent) ? parsed.intent : "outro";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    return { intent, confidence, source: "openai" };
  } catch (e) {
    console.warn("[classifier] openai failed:", (e as Error).message);
    return null;
  }
}

async function classifyGemini(text: string, step: string, geminiApiKey: string): Promise<ClassifyResult> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT(text, step) }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                intent: { type: "STRING", enum: INTENTS },
                confidence: { type: "NUMBER" },
              },
              required: ["intent", "confidence"],
            },
          },
        }),
      },
    );
    clearTimeout(to);
    if (!res.ok) return { intent: "outro", confidence: 0, source: "fallback" };
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(raw);
    const intent: Intent = INTENTS.includes(parsed.intent) ? parsed.intent : "outro";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    return { intent, confidence, source: "llm" };
  } catch {
    return { intent: "outro", confidence: 0, source: "fallback" };
  }
}

export async function classifyIntent(
  text: string,
  currentStep: string,
  geminiApiKey: string,
  ctx?: { customerId?: string | null; consultantId?: string | null; traceId?: string | null },
): Promise<ClassifyResult> {
  const t0 = Date.now();
  let result: ClassifyResult;

  const fast = regexClassify(text);
  if (fast) {
    result = { intent: fast, confidence: 0.95, source: "regex" };
  } else if (!text.trim()) {
    result = { intent: "outro", confidence: 0, source: "fallback" };
  } else {
    // 🧪 modo teste/sandbox: pula LLM (gasta 2-3s por turno) e usa regex+default.
    // Simulator é validação de fluxo, não de classifier — IA real nunca é
    // o caminho de teste em mock.
    let isMock = false;
    try {
      const { isMockMode } = await import("../../../_shared/test-mode.ts");
      isMock = isMockMode();
    } catch (_) { /* noop */ }
    if (isMock) {
      result = { intent: "outro", confidence: 0.6, source: "fallback" };
    } else {
      const hasOpenAI = !!Deno.env.get("OPENAI_API_KEY");
      console.log(`[classifier] route step=${currentStep} hasOpenAI=${hasOpenAI} hasGemini=${!!geminiApiKey} textLen=${text.length}`);
      let r: ClassifyResult | null = null;
      if (hasOpenAI) r = await classifyOpenAI(text, currentStep);
      if (!r && geminiApiKey) r = await classifyGemini(text, currentStep, geminiApiKey);
      result = r ?? { intent: "outro", confidence: 0, source: "fallback" };
    }
  }

  // Sprint 1: aplicar thresholds de confiança
  try {
    const { handoff, execute } = await getConfidenceThresholds();
    result.action = result.confidence >= execute
      ? "execute"
      : result.confidence >= handoff
        ? "repeat"
        : "handoff";
  } catch {
    result.action = "execute"; // fail-open
  }

  // Fire-and-forget structured log
  logAiDecision({
    consultantId: ctx?.consultantId ?? null,
    customerId: ctx?.customerId ?? null,
    phase: "intent_classify",
    toolCalled: "classifyIntent",
    model: result.source === "openai" ? "gpt-5-mini" : result.source === "llm" ? "gemini-2.0-flash" : null,
    userInput: text,
    intentDetected: result.intent,
    confidence: result.confidence,
    stepBefore: currentStep,
    source: result.source,
    latencyMs: Date.now() - t0,
    traceId: ctx?.traceId ?? null,
    aiOutput: { action: result.action },
  });

  return result;
}

// Exported for tests
export const __test = { regexClassify };
