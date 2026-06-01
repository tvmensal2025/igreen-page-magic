// Lovable AI Gateway helper (OpenAI-compatible).
// Server-side only. Reads LOVABLE_API_KEY from env.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface AIChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; [k: string]: any }>;
}

export interface AIChatOptions {
  model?: string;
  messages: AIChatMessage[];
  temperature?: number;
  responseFormat?: "text" | "json_object";
  jsonSchema?: { name: string; schema: Record<string, any> };
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AIChatResult {
  text: string;
  json?: any;
  usage?: any;
  raw: any;
}

// Modelos "reasoning"/"thinking" consomem parte do orçamento de tokens em
// reasoning invisível, então o teto precisa ser bem maior para não cortar a
// resposta final. OpenAI gpt-5*/o[134]* também rejeitam `max_tokens` e
// `temperature`!=1, usando `max_completion_tokens` no lugar.
// Gemini 3.x Pro é thinking model mas aceita `max_tokens` e temperature normais
// — só precisa do multiplicador para evitar truncamento.
function isReasoningModel(model: string): boolean {
  return /^(openai\/)?(gpt-5|o[134])/i.test(model);
}
function isThinkingModel(model: string): boolean {
  return isReasoningModel(model)
    || /^google\/gemini-3(\.\d+)?-pro/i.test(model);
}

export async function aiChat(opts: AIChatOptions): Promise<AIChatResult> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");

  const model = opts.model || "google/gemini-3-flash-preview";
  const reasoning = isReasoningModel(model);
  const body: Record<string, any> = {
    model,
    messages: opts.messages,
  };
  if (!reasoning) body.temperature = opts.temperature ?? 0.4;
  if (opts.maxTokens) {
    // Reasoning models gastam tokens "ocultos"; dá folga para a resposta final.
    const tokens = reasoning ? Math.max(opts.maxTokens * 8, 2000) : opts.maxTokens;
    if (reasoning) body.max_completion_tokens = tokens;
    else body.max_tokens = tokens;
  }
  if (opts.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: opts.jsonSchema.name, strict: true, schema: opts.jsonSchema.schema },
    };
  } else if (opts.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Lovable-AIG-SDK": "lovable-shared",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) throw new Error(`AI rate limited (429): ${errText}`);
    if (res.status === 402) throw new Error(`AI credits exhausted (402): ${errText}`);
    throw new Error(`AI gateway ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  let json: any = undefined;
  if ((opts.jsonSchema || opts.responseFormat === "json_object") && typeof text === "string") {
    try { json = JSON.parse(text); } catch { /* ignore */ }
  }
  return { text: typeof text === "string" ? text : "", json, usage: data?.usage, raw: data };
}

// ─── Cascade helpers ────────────────────────────────────────────────────
// Same family, ordered by quality desc. Used by aiChatCascade when a model
// fails with 429/402/timeout.
const FALLBACK_CHAIN: Record<string, string[]> = {
  "openai/gpt-5.5":              ["openai/gpt-5.5", "openai/gpt-5.4", "openai/gpt-5-mini"],
  "openai/gpt-5.4":              ["openai/gpt-5.4", "openai/gpt-5", "openai/gpt-5-mini"],
  "openai/gpt-5":                ["openai/gpt-5", "openai/gpt-5-mini"],
  "openai/gpt-5-mini":           ["openai/gpt-5-mini", "openai/gpt-5-nano"],
  "google/gemini-3.1-pro-preview":["google/gemini-3.1-pro-preview", "google/gemini-2.5-pro", "google/gemini-2.5-flash"],
  "google/gemini-2.5-pro":       ["google/gemini-2.5-pro", "google/gemini-2.5-flash"],
  "google/gemini-3-flash-preview":["google/gemini-3-flash-preview", "google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"],
  "google/gemini-2.5-flash":     ["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"],
};

function isTransient(msg: string): boolean {
  return /(\b429\b|\b402\b|\b5\d\d\b|timeout|aborted|fetch failed|ECONN|ENETDOWN)/i.test(msg);
}

export interface CascadeResult extends AIChatResult { modelUsed: string; attempts: number; }

/**
 * Same as aiChat, but auto-falls-back through FALLBACK_CHAIN on transient
 * errors (429/402/5xx/timeout). Returns the model that actually succeeded.
 */
export async function aiChatCascade(opts: AIChatOptions): Promise<CascadeResult> {
  const start = opts.model || "google/gemini-3-flash-preview";
  const chain = FALLBACK_CHAIN[start] || [start];
  let lastErr: Error | null = null;
  let attempts = 0;
  for (const model of chain) {
    attempts++;
    try {
      const r = await aiChat({ ...opts, model });
      return { ...r, modelUsed: model, attempts };
    } catch (e) {
      lastErr = e as Error;
      if (!isTransient(lastErr.message)) break; // non-transient → stop
      console.warn(`[ai-gateway] cascade fallback: ${model} failed (${lastErr.message.slice(0, 100)})`);
    }
  }
  throw lastErr || new Error("aiChatCascade exhausted with no error");
}


// Multimodal helper for transcription / vision via inline base64.
export async function aiMultimodal(opts: {
  model?: string;
  prompt: string;
  base64: string;
  mimeType: string;
  signal?: AbortSignal;
}): Promise<string> {
  const result = await aiChat({
    model: opts.model || "google/gemini-3-flash-preview",
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: opts.prompt },
          { type: "image_url", image_url: { url: `data:${opts.mimeType};base64,${opts.base64}` } },
        ],
      },
    ],
    signal: opts.signal,
  });
  return result.text;
}