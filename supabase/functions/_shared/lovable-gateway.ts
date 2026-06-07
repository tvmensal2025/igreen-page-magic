// Lovable AI Gateway adapter — OpenAI-compatible bridge that lets every
// existing `_shared/gemini.ts` caller (text, JSON, audio, image) keep
// working when GEMINI_API_KEY is rate-limited or out of credits.
//
// Usage: `geminiGenerate` calls `tryLovableGateway` first. On success
// returns a payload shaped like the native Gemini response so the caller
// pipeline (text extraction, tool calls, cost log) keeps working
// unchanged. On gateway failure that is recoverable (402/429/5xx,
// missing key, multimodal not supported) it returns null so the caller
// falls back to the direct Gemini API.

import type { GeminiContent, GeminiPart, GeminiTool } from "./gemini.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Maps native Gemini model names to gateway model slugs.
function mapModel(model: string): string {
  if (model.startsWith("google/") || model.startsWith("openai/")) return model;
  const m = model.toLowerCase();
  if (m.includes("gemini-3-flash-preview")) return "google/gemini-3-flash-preview";
  if (m.includes("gemini-3.5-flash")) return "google/gemini-3.5-flash";
  if (m.includes("gemini-3.1-pro")) return "google/gemini-3.1-pro-preview";
  if (m.includes("gemini-3.1-flash-lite")) return "google/gemini-3.1-flash-lite-preview";
  if (m.includes("gemini-2.5-pro")) return "google/gemini-2.5-pro";
  if (m.includes("gemini-2.5-flash-lite")) return "google/gemini-2.5-flash-lite";
  if (m.includes("gemini-2.5-flash")) return "google/gemini-2.5-flash";
  // Sensible default — frontier, fast, cheap.
  return "google/gemini-2.5-flash";
}

// Detects audio mime-types so we can decide whether to keep the request
// in the OpenAI-compatible shape. Gemini via the gateway accepts most
// audio formats including ogg/opus from WhatsApp.
function isAudioMime(mime: string): boolean {
  return /^audio\//i.test(mime);
}
function isImageMime(mime: string): boolean {
  return /^image\//i.test(mime);
}

// Converts the native Gemini "parts" array to OpenAI content blocks.
function partsToContent(parts: GeminiPart[]): any[] {
  const out: any[] = [];
  for (const p of parts) {
    if ("text" in p && typeof (p as any).text === "string") {
      out.push({ type: "text", text: (p as any).text });
    } else if ("inline_data" in p) {
      const { mime_type, data } = (p as any).inline_data;
      if (isImageMime(mime_type)) {
        out.push({
          type: "image_url",
          image_url: { url: `data:${mime_type};base64,${data}` },
        });
      } else if (isAudioMime(mime_type)) {
        // OpenAI-compat audio format wants "wav" | "mp3"; ogg passes through
        // to Gemini server which accepts it. Use raw sub-type after audio/.
        const format = mime_type.split("/")[1]?.split(";")[0]?.trim() || "ogg";
        out.push({
          type: "input_audio",
          input_audio: { data, format },
        });
      } else {
        // Other binary (pdf/video) — gateway not guaranteed; signal caller
        // to fall back to native.
        throw new Error(`unsupported_mime:${mime_type}`);
      }
    } else {
      // functionCall / functionResponse — skip in gateway path; fall back.
      throw new Error("function_parts_not_supported_in_gateway");
    }
  }
  return out;
}

export interface LovableGatewayInvokeArgs {
  model: string;
  system?: string;
  contents: GeminiContent[];
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "text/plain" | "application/json";
  responseSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  // Tools/toolChoice not bridged here — falls back to native when present.
  tools?: GeminiTool[];
}

export interface LovableGatewayInvokeResult {
  text: string;
  modelUsed: string;
  finishReason?: string;
  usage: { promptTokens: number; outputTokens: number; thinkingTokens: number };
  raw: unknown;
}

/**
 * Try a Lovable AI Gateway call. Returns `null` when the gateway is
 * unavailable (missing key, recoverable error, unsupported request) so
 * the caller can fall back to the direct Gemini API.
 *
 * Throws only for non-recoverable errors that should NOT trigger a
 * fallback (currently: nothing — we always prefer to fall back).
 */
export async function tryLovableGateway(
  opts: LovableGatewayInvokeArgs,
): Promise<LovableGatewayInvokeResult | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  // Tools/function-calling not bridged today.
  if (opts.tools && opts.tools.length > 0) return null;

  const messages: any[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });

  try {
    for (const c of opts.contents) {
      const role = c.role === "model" ? "assistant" : "user";
      const blocks = partsToContent(c.parts);
      // If a message has only one text block, collapse to string content for
      // wider OpenAI-compat acceptance.
      if (blocks.length === 1 && blocks[0].type === "text") {
        messages.push({ role, content: blocks[0].text });
      } else {
        messages.push({ role, content: blocks });
      }
    }
  } catch (_e) {
    // unsupported_mime / function parts → fall back to native.
    return null;
  }

  const body: Record<string, unknown> = {
    model: mapModel(opts.model),
    messages,
  };
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (typeof opts.maxOutputTokens === "number") body.max_tokens = opts.maxOutputTokens;
  if (opts.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }

  let res: Response;
  try {
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    console.warn("[lovable-gateway] network error:", (e as Error)?.message);
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 402 (credits) / 429 (rate) / 5xx → fall back to native if possible.
    // 400 from gateway usually means schema mismatch (audio/mime) → fallback.
    console.warn(`[lovable-gateway] ${res.status}: ${text.slice(0, 200)}`);
    return null;
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  const choice = data?.choices?.[0];
  const text = String(choice?.message?.content ?? "").trim();
  if (!text && choice?.message?.tool_calls) {
    // Tool-call only response — caller using native tooling expects native
    // shape; fall back rather than fake it.
    return null;
  }

  const usage = data?.usage || {};
  return {
    text,
    modelUsed: data?.model || mapModel(opts.model),
    finishReason: choice?.finish_reason,
    usage: {
      promptTokens: Number(usage.prompt_tokens) || 0,
      outputTokens: Number(usage.completion_tokens) || 0,
      thinkingTokens: Number(usage.reasoning_tokens) || 0,
    },
    raw: data,
  };
}
