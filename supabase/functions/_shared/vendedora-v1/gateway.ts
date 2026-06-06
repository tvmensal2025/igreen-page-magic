// Wrapper enxuto pro Lovable AI Gateway com cascata interna.
// Mantém isolado do _shared/ai-gateway.ts pra evitar acoplamento.

export interface ChatMsg { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string }
export interface ToolCallParsed { id: string; name: string; arguments: any }
export interface ChatResult { text: string; toolCalls: ToolCallParsed[]; modelUsed: string }

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const EMBED = "https://ai.gateway.lovable.dev/v1/embeddings";

function key(): string {
  const k = Deno.env.get("LOVABLE_API_KEY");
  if (!k) throw new Error("LOVABLE_API_KEY not configured");
  return k;
}

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

export async function chat(opts: {
  model: string;
  messages: ChatMsg[];
  tools?: any[];
  toolChoice?: ToolChoice;
  temperature?: number;
  json?: boolean;
}): Promise<ChatResult> {
  const body: Record<string, any> = { model: opts.model, messages: opts.messages };
  if (opts.tools && opts.tools.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? "auto";
  }
  if (opts.json) body.response_format = { type: "json_object" };
  if (opts.temperature != null && !/^openai\/(gpt-5|o[134])/i.test(opts.model)) {
    body.temperature = opts.temperature;
  }
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    // Se o proxy Lovable rejeitar tool_choice como objeto, tenta novamente com "required"
    // (mantém aderência: o modelo é obrigado a chamar uma tool, e validamos qual).
    if (
      res.status === 400 &&
      typeof body.tool_choice === "object" &&
      /tool_choice/i.test(t)
    ) {
      const retryBody = { ...body, tool_choice: "required" };
      const retry = await fetch(GATEWAY, {
        method: "POST",
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify(retryBody),
      });
      if (retry.ok) {
        return parseChatResponse(await retry.json(), opts.model);
      }
    }
    throw new Error(`gateway ${res.status} (${opts.model}): ${t.slice(0, 300)}`);
  }
  return parseChatResponse(await res.json(), opts.model);
}

function parseChatResponse(data: any, model: string): ChatResult {
  const choice = data?.choices?.[0]?.message;
  const text = String(choice?.content ?? "");
  const raw = Array.isArray(choice?.tool_calls) ? choice.tool_calls : [];
  const toolCalls: ToolCallParsed[] = raw.map((tc: any) => {
    let parsed: any = {};
    try { parsed = JSON.parse(tc?.function?.arguments || "{}"); } catch { /* ignore */ }
    return { id: tc?.id || "", name: tc?.function?.name || "", arguments: parsed };
  }).filter((t: ToolCallParsed) => t.name);
  return { text, toolCalls, modelUsed: model };
}

/**
 * Atalho conveniente para forçar a chamada de UMA tool específica.
 * Retorna `null` se o modelo recusar (raro, com tool_choice forçado).
 */
export async function chatForced(opts: {
  model: string;
  messages: ChatMsg[];
  tool: { type: "function"; function: { name: string; description?: string; parameters: any } };
  temperature?: number;
}): Promise<{ args: any | null; modelUsed: string }> {
  const r = await chat({
    model: opts.model,
    messages: opts.messages,
    tools: [opts.tool],
    toolChoice: { type: "function", function: { name: opts.tool.function.name } },
    temperature: opts.temperature,
  });
  const call = r.toolCalls.find((tc) => tc.name === opts.tool.function.name);
  return { args: call?.arguments ?? null, modelUsed: r.modelUsed };
}


export async function chatCascade(opts: {
  models: string[];
  messages: ChatMsg[];
  tools?: any[];
  temperature?: number;
  json?: boolean;
}): Promise<ChatResult> {
  let last: Error | null = null;
  for (const m of opts.models) {
    try {
      const r = await chat({ ...opts, model: m });
      if (r.text.trim().length > 0 || r.toolCalls.length > 0) return r;
      last = new Error(`empty response from ${m}`);
    } catch (e) {
      last = e as Error;
      const msg = (e as Error).message || "";
      if (!/429|5\d\d|empty|timeout/i.test(msg)) throw e;
    }
  }
  throw last || new Error("cascade exhausted");
}

export async function embed(text: string, dims = 1536): Promise<number[]> {
  const res = await fetch(EMBED, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-embedding-001",
      input: text.slice(0, 8000),
      dimensions: dims,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`embed ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const v = data?.data?.[0]?.embedding;
  if (!Array.isArray(v)) throw new Error("embedding vazio");
  return v;
}
