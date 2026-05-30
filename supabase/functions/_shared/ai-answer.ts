// AI Answer — helper que faz a IA responder a UMA pergunta do lead
// usando o perfil/provider configurado para o consultor.
//
// Diferente do `aiDecideFallback` (que escolhe próximo step), aqui a IA
// produz texto natural pro lead. Usado pelo bloco duvidas_ia.
//
// Pipeline:
//   1. Pega knowledge da iGreen (ai_knowledge_extra) + customer profile
//   2. Monta prompt com system + question
//   3. Chama Gemini ou OpenAI conforme provider configurado
//   4. Sanitiza resposta (não vaza números/URLs ungrounded)
//   5. Retorna texto pronto pra enviar ao lead

import { sanitizeHumanReply, type GroundingContext } from "./grounding.ts";
import { pickModel, type AiProfile, type AiProvider } from "./ai-config.ts";

export interface GenerateAiAnswerInput {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  consultantId: string;
  systemPrompt: string;
  userQuestion: string;
  knowledgeContext?: {
    customer?: Record<string, any>;
    extraKnowledge?: string;
  };
  profile: AiProfile;
  provider: AiProvider;
  timeoutMs?: number;
}

const GEMINI_API_KEY =
  (typeof Deno !== "undefined" ? Deno.env.get("GEMINI_API_KEY") : "") ||
  (typeof Deno !== "undefined" ? Deno.env.get("GOOGLE_AI_API_KEY") : "") ||
  "";

const OPENAI_API_KEY =
  (typeof Deno !== "undefined" ? Deno.env.get("OPENAI_API_KEY") : "") || "";

const LOVABLE_API_KEY =
  (typeof Deno !== "undefined" ? Deno.env.get("LOVABLE_API_KEY") : "") || "";

async function callGemini(
  model: string,
  systemPrompt: string,
  userText: string,
  apiKey: string,
  timeoutMs: number,
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 200,
        },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof txt === "string" ? txt.trim() : null;
  } catch (_) {
    return null;
  }
}

async function callOpenAI(
  model: string,
  systemPrompt: string,
  userText: string,
  apiKey: string,
  timeoutMs: number,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const reasoning = /^(gpt-5|o[134])/i.test(model);
    const body: Record<string, any> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    };
    if (reasoning) {
      // Reasoning models precisam de muito mais tokens — parte é gasta em
      // tokens internos de raciocínio antes do conteúdo da resposta.
      body.max_completion_tokens = 2000;
    } else {
      body.max_tokens = 400;
      body.temperature = 0.4;
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content;
    return typeof txt === "string" ? txt.trim() : null;
  } catch (_) {
    return null;
  }
}

async function callLovableGateway(
  model: string,
  systemPrompt: string,
  userText: string,
  apiKey: string,
  timeoutMs: number,
): Promise<string | null> {
  // Lovable AI Gateway aceita modelos Gemini E OpenAI via formato OpenAI-compatible.
  // Modelo Gemini precisa do prefixo `google/`.
  const fullModel = model.startsWith("google/") || model.startsWith("openai/")
    ? model
    : (model.startsWith("gemini") ? `google/${model}` : `openai/${model}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const reasoning = /^(openai\/)?(gpt-5|o[134])/i.test(fullModel);
    const body: Record<string, any> = {
      model: fullModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    };
    if (reasoning) {
      body.max_completion_tokens = 2000;
    } else {
      body.max_tokens = 400;
      body.temperature = 0.4;
    }
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content;
    return typeof txt === "string" ? txt.trim() : null;
  } catch (_) {
    return null;
  }
}

/**
 * Gera resposta de IA para a dúvida do lead. Tenta primary → fallback →
 * gateway alternativo. Aplica sanitização anti-alucinação no final.
 */
export async function generateAiAnswer(
  input: GenerateAiAnswerInput,
): Promise<string | null> {
  const { task, profile, provider, systemPrompt, userQuestion, timeoutMs } = {
    task: "duvida_handler" as const,
    profile: input.profile,
    provider: input.provider,
    systemPrompt: input.systemPrompt,
    userQuestion: input.userQuestion,
    timeoutMs: input.timeoutMs || 8000,
  };

  // Carrega knowledge base do consultor para grounding
  let extraKnowledge = "";
  try {
    const { data: ke } = await input.supabase
      .from("settings")
      .select("value")
      .eq("key", "ai_knowledge_extra")
      .maybeSingle();
    extraKnowledge = String((ke as any)?.value || "");
  } catch (_) {}

  const augmentedSystem = systemPrompt + (
    extraKnowledge
      ? `\n\nBASE DE CONHECIMENTO:\n${extraKnowledge.slice(0, 3000)}`
      : ""
  );

  const { primary, fallback } = pickModel(task, profile, provider);

  // Estratégia: chama Gemini diretamente quando provider=google + key disponível.
  // Senão usa Lovable Gateway que tem ambos.
  let answer: string | null = null;

  if (provider === "google" && GEMINI_API_KEY) {
    answer = await callGemini(primary, augmentedSystem, userQuestion, GEMINI_API_KEY, timeoutMs);
    if (!answer && fallback !== primary) {
      answer = await callGemini(fallback, augmentedSystem, userQuestion, GEMINI_API_KEY, timeoutMs);
    }
  } else if (provider === "openai" && OPENAI_API_KEY) {
    answer = await callOpenAI(primary, augmentedSystem, userQuestion, OPENAI_API_KEY, timeoutMs);
    if (!answer && fallback !== primary) {
      answer = await callOpenAI(fallback, augmentedSystem, userQuestion, OPENAI_API_KEY, timeoutMs);
    }
  }

  // Lovable gateway fallback
  if (!answer && LOVABLE_API_KEY) {
    answer = await callLovableGateway(primary, augmentedSystem, userQuestion, LOVABLE_API_KEY, timeoutMs);
    if (!answer && fallback !== primary) {
      answer = await callLovableGateway(fallback, augmentedSystem, userQuestion, LOVABLE_API_KEY, timeoutMs);
    }
  }

  if (!answer) return null;

  // Sanitização anti-alucinação
  const groundingCtx: GroundingContext = {
    customer: input.knowledgeContext?.customer,
    knowledgeSections: extraKnowledge
      ? [{ title: "iGreen Knowledge", body: extraKnowledge }]
      : [],
    allowedDomains: ["igreen.energy", "igreenclub.com.br"],
  };
  const sanitized = sanitizeHumanReply(answer, groundingCtx);
  return sanitized || answer.slice(0, 280);
}
