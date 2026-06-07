// Wrapper enxuto pro Lovable AI Gateway com cascata interna.

export interface ChatMsg { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string }
export interface ToolCallParsed { id: string; name: string; arguments: any }
export interface ChatResult { text: string; toolCalls: ToolCallParsed[]; modelUsed: string }

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const EMBED = "https://ai.gateway.lovable.dev/v1/embeddings";

function key(): string {
  const k = Deno.env.get("LOVABLE_API_KEY");
  if (!k) throw new Error("LOVABLE_API_KEY not configured");
  return k;
}

async function rawCall(body: Record<string, any>, model: string, timeoutMs = 25000): Promise<ChatResult> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(to);
    if ((e as any)?.name === "AbortError") throw new Error(`gateway timeout (${model}) after ${timeoutMs}ms`);
    throw e;
  }
  clearTimeout(to);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gateway ${res.status} (${model}): ${t.slice(0, 300)}`);
  }

  const data = await res.json();
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

export async function chat(opts: {
  model: string;
  messages: ChatMsg[];
  tools?: any[];
  temperature?: number;
  json?: boolean;
  toolChoice?: ToolChoice;
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
  try {
    return await rawCall(body, opts.model);
  } catch (e) {
    // Fallback: alguns proxies não aceitam tool_choice como objeto — degrada pra "required"
    const msg = (e as Error).message || "";
    if (typeof body.tool_choice === "object" && /400|tool_choice|invalid/i.test(msg)) {
      body.tool_choice = "required";
      return await rawCall(body, opts.model);
    }
    throw e;
  }
}

export async function chatCascade(opts: {
  models: string[];
  messages: ChatMsg[];
  tools?: any[];
  temperature?: number;
  json?: boolean;
  toolChoice?: ToolChoice;
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

/**
 * Força o modelo a chamar UMA tool específica. Usado pelos extractors da V2.
 * Devolve `args` (objeto parseado da tool call) e `modelUsed`.
 */
export async function chatForced(opts: {
  model: string;
  messages: ChatMsg[];
  tool: any; // { type:"function", function:{ name, description, parameters } }
  temperature?: number;
}): Promise<{ args: any; modelUsed: string; text: string }> {
  const r = await chat({
    model: opts.model,
    messages: opts.messages,
    tools: [opts.tool],
    temperature: opts.temperature,
    toolChoice: { type: "function", function: { name: opts.tool.function.name } },
  });
  const args = r.toolCalls[0]?.arguments ?? {};
  return { args, modelUsed: r.modelUsed, text: r.text };
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
