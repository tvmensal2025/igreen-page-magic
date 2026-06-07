// Direct Google Generative Language API helper.
// Server-side only. Reads GEMINI_API_KEY (fallback GOOGLE_AI_API_KEY).
// No dependency on Lovable AI Gateway.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { tryLovableGateway } from "./lovable-gateway.ts";

/**
 * GeminiQuotaExhausted — sentinel error type. Thrown by `geminiGenerate`
 * when the consultant's per-minute Gemini token bucket
 * (`gemini_quota_bucket` table, RPC `consume_gemini_token`) is empty.
 *
 * Callers in `ai-agent-router` and `_shared/ai-faq-answerer` MUST catch
 * this and fall back to a deterministic decision (template text or
 * "REPEAT" choice) rather than retrying. Default capacity is 60 tokens
 * per consultant per minute (see migration §4.6) — large enough for a
 * normal conversation (≤ 1 LLM call per inbound), small enough to
 * prevent a runaway loop from burning the whole quota.
 *
 * This implements bugfix.md §2.38 / Task 35 of the WhatsApp Flow
 * Reliability v2 spec.
 */
export class GeminiQuotaExhausted extends Error {
  constructor(public readonly consultantId: string | undefined) {
    super(`Gemini quota exhausted for consultant ${consultantId || "(none)"}`);
    this.name = "GeminiQuotaExhausted";
  }
}

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Pricing (USD per 1M tokens) — updated May 2026 with frontier models.
const PRICING: Record<string, { in: number; out: number }> = {
  // Gemini 3.x family (frontier — May 2026)
  "gemini-3.1-pro": { in: 4.00, out: 20.0 },
  "gemini-3.5-flash": { in: 0.40, out: 3.00 },
  "gemini-3-flash-preview": { in: 0.30, out: 2.50 },
  // Gemini 2.5 (legacy fallback)
  "gemini-2.5-pro": { in: 1.25, out: 10.0 },
  "gemini-2.5-flash": { in: 0.30, out: 2.50 },
  "gemini-2.5-flash-lite": { in: 0.10, out: 0.40 },
  "gemini-2.5-flash-image-preview": { in: 0.30, out: 2.50 },
  "text-embedding-004": { in: 0.025, out: 0 },
};
const USD_TO_BRL = 5.4;

export type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { mime_type: string; file_uri: string } }
  | { functionCall: { name: string; args: Record<string, any> } }
  | { functionResponse: { name: string; response: Record<string, any> } };

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
  }>;
}

export interface GeminiGenerateOpts {
  model: string;                                  // "gemini-2.5-pro", etc.
  system?: string;
  contents: GeminiContent[];
  tools?: GeminiTool[];
  toolChoice?: "auto" | "any" | "none" | { mode: "ANY"; allowedFunctionNames?: string[] };
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseMimeType?: "text/plain" | "application/json";
  responseSchema?: Record<string, any>;
  thinkingBudget?: number;                        // 0 disables thinking
  signal?: AbortSignal;
  // Telemetry
  functionName?: string;
  consultantId?: string;
  customerId?: string;
  // Retry / fallback
  retries?: number;                               // default 2
  fallbackModel?: string;                         // used on 429 of Pro
}

export interface GeminiResult {
  text: string;
  toolCall?: { name: string; args: Record<string, any> };
  toolCalls?: Array<{ name: string; args: Record<string, any> }>;
  finishReason?: string;
  usage: { promptTokens: number; outputTokens: number; thinkingTokens: number };
  costCents: number;
  modelUsed: string;
  degraded: boolean;
  raw: any;
}

function getApiKey(): string | null {
  const k = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  return k || null;
}

function estimateCostCents(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model] || { in: 0.30, out: 2.50 };
  const usd = (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
  return Math.round(usd * USD_TO_BRL * 100 * 10000) / 10000; // cents w/ 4 decimals
}

async function logUsage(row: {
  function_name: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  thinking_tokens: number;
  latency_ms: number;
  cost_estimate_cents: number;
  outcome: string;
  degraded: boolean;
  consultant_id?: string | null;
  customer_id?: string | null;
  metadata?: any;
}) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const supa = createClient(url, key);
    await supa.from("ai_usage_log").insert(row);
  } catch (e) {
    console.warn("[gemini] usage log failed:", (e as Error).message);
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function geminiGenerate(opts: GeminiGenerateOpts): Promise<GeminiResult> {
  const start = Date.now();
  const apiKey = getApiKey();
  const retries = opts.retries ?? 2;
  let degraded = false;
  let modelToUse = opts.model;
  let lastErr: any = null;

  // ── Per-consultant quota bucket (bugfix.md §2.38 / Task 35) ──
  // The RPC `consume_gemini_token` decrements the consultant's bucket
  // atomically and returns FALSE when empty. We only consult it when a
  // `consultantId` was provided — utility callers that don't pass one
  // (one-off scripts, system health checks) bypass the bucket. The
  // bucket refills at 60 tokens/minute by default; that's enough headroom
  // for a normal lead conversation (≤ 1 LLM call per inbound) but cheap
  // to throttle a runaway prompt loop. On RPC error (network blip,
  // bucket row not yet seeded) we fail-open (let the call through)
  // because the alternative — silencing the bot for a real lead because
  // of a quota subsystem hiccup — is strictly worse than burning a few
  // extra tokens.
  if (opts.consultantId) {
    try {
      const supaUrl = Deno.env.get("SUPABASE_URL");
      const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supaUrl && supaKey) {
        const supa = createClient(supaUrl, supaKey);
        const { data: ok, error } = await supa.rpc("consume_gemini_token", {
          p_consultant: opts.consultantId,
          p_tokens: 1,
        });
        if (!error && ok === false) {
          // Bucket empty → throw the sentinel for the caller to handle.
          if (opts.functionName) {
            logUsage({
              function_name: opts.functionName,
              model: opts.model,
              tokens_in: 0,
              tokens_out: 0,
              thinking_tokens: 0,
              latency_ms: Date.now() - start,
              cost_estimate_cents: 0,
              outcome: "quota_exhausted",
              degraded: true,
              consultant_id: opts.consultantId || null,
              customer_id: opts.customerId || null,
              metadata: { reason: "gemini_quota_exhausted" },
            });
          }
          console.warn(
            `[gemini] quota exhausted for consultant=${opts.consultantId}; throwing GeminiQuotaExhausted`,
          );
          throw new GeminiQuotaExhausted(opts.consultantId);
        }
      }
    } catch (e) {
      // Re-throw the sentinel so the caller can downgrade deterministically.
      if (e instanceof GeminiQuotaExhausted) throw e;
      // Any other failure (RPC missing, network error) → fail-open with a
      // single-line warning so we can spot quota subsystem outages in logs.
      console.warn(
        `[gemini] consume_gemini_token failed (fail-open):`,
        (e as Error)?.message,
      );
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const body: Record<string, any> = {
        contents: opts.contents,
        generationConfig: {
          temperature: opts.temperature ?? 0.5,
          ...(opts.topP !== undefined && { topP: opts.topP }),
          ...(opts.maxOutputTokens && { maxOutputTokens: opts.maxOutputTokens }),
          ...(opts.responseMimeType && { responseMimeType: opts.responseMimeType }),
          ...(opts.responseSchema && { responseSchema: opts.responseSchema }),
          ...(opts.thinkingBudget !== undefined && {
            thinkingConfig: { thinkingBudget: opts.thinkingBudget, includeThoughts: false },
          }),
        },
      };
      if (opts.system) {
        body.systemInstruction = { role: "system", parts: [{ text: opts.system }] };
      }
      if (opts.tools?.length) body.tools = opts.tools;
      if (opts.toolChoice) {
        if (typeof opts.toolChoice === "string") {
          body.toolConfig = { functionCallingConfig: { mode: opts.toolChoice.toUpperCase() } };
        } else {
          body.toolConfig = {
            functionCallingConfig: {
              mode: opts.toolChoice.mode,
              ...(opts.toolChoice.allowedFunctionNames && {
                allowedFunctionNames: opts.toolChoice.allowedFunctionNames,
              }),
            },
          };
        }
      }

      const url = `${API_BASE}/models/${modelToUse}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        // 429 -> backoff or fallback
        if (res.status === 429) {
          if (opts.fallbackModel && modelToUse !== opts.fallbackModel) {
            console.warn(`[gemini] 429 on ${modelToUse}, falling back to ${opts.fallbackModel}`);
            modelToUse = opts.fallbackModel;
            degraded = true;
            continue;
          }
          if (attempt < retries) {
            await sleep(800 * Math.pow(2, attempt));
            continue;
          }
        }
        if (res.status >= 500 && attempt < retries) {
          await sleep(500 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`Gemini ${res.status}: ${errText.slice(0, 500)}`);
      }

      const data = await res.json();
      const cand = data?.candidates?.[0];
      const partsOut: GeminiPart[] = cand?.content?.parts || [];

      let text = "";
      const toolCalls: Array<{ name: string; args: Record<string, any> }> = [];
      for (const p of partsOut) {
        if ("text" in p && typeof (p as any).text === "string") text += (p as any).text;
        if ("functionCall" in p) toolCalls.push({
          name: (p as any).functionCall.name,
          args: (p as any).functionCall.args || {},
        });
      }

      const usage = data?.usageMetadata || {};
      const tokensIn = usage.promptTokenCount || 0;
      const tokensOut = usage.candidatesTokenCount || 0;
      const thinkingTokens = usage.thoughtsTokenCount || 0;
      const totalOut = tokensOut + thinkingTokens;
      const costCents = estimateCostCents(modelToUse, tokensIn, totalOut);
      const latency = Date.now() - start;

      // fire-and-forget log
      if (opts.functionName) {
        logUsage({
          function_name: opts.functionName,
          model: modelToUse,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          thinking_tokens: thinkingTokens,
          latency_ms: latency,
          cost_estimate_cents: costCents,
          outcome: "ok",
          degraded,
          consultant_id: opts.consultantId || null,
          customer_id: opts.customerId || null,
          metadata: { finish: cand?.finishReason, tools: toolCalls.length },
        });
      }

      return {
        text: text.trim(),
        toolCall: toolCalls[0],
        toolCalls,
        finishReason: cand?.finishReason,
        usage: { promptTokens: tokensIn, outputTokens: tokensOut, thinkingTokens },
        costCents,
        modelUsed: modelToUse,
        degraded,
        raw: data,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(400 * Math.pow(2, attempt));
        continue;
      }
    }
  }

  if (opts.functionName) {
    logUsage({
      function_name: opts.functionName,
      model: modelToUse,
      tokens_in: 0,
      tokens_out: 0,
      thinking_tokens: 0,
      latency_ms: Date.now() - start,
      cost_estimate_cents: 0,
      outcome: "error",
      degraded,
      consultant_id: opts.consultantId || null,
      customer_id: opts.customerId || null,
      metadata: { error: String(lastErr?.message || lastErr).slice(0, 500) },
    });
  }
  throw lastErr || new Error("Gemini call failed");
}

// Convenience: simple text generation
export async function geminiText(
  prompt: string,
  opts: Partial<GeminiGenerateOpts> & { model?: string } = {},
): Promise<string> {
  const r = await geminiGenerate({
    model: opts.model || "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    ...opts,
  });
  return r.text;
}

// Convenience: multimodal (image/audio inline)
export async function geminiMultimodal(opts: {
  model?: string;
  prompt: string;
  base64: string;
  mimeType: string;
  system?: string;
  temperature?: number;
  responseMimeType?: "text/plain" | "application/json";
  responseSchema?: Record<string, any>;
  signal?: AbortSignal;
  functionName?: string;
  consultantId?: string;
  customerId?: string;
  fallbackModel?: string;
}): Promise<GeminiResult> {
  return geminiGenerate({
    model: opts.model || "gemini-2.5-flash",
    system: opts.system,
    temperature: opts.temperature ?? 0.0,
    responseMimeType: opts.responseMimeType,
    responseSchema: opts.responseSchema,
    contents: [{
      role: "user",
      parts: [
        { text: opts.prompt },
        { inline_data: { mime_type: opts.mimeType, data: opts.base64 } },
      ],
    }],
    signal: opts.signal,
    functionName: opts.functionName,
    consultantId: opts.consultantId,
    customerId: opts.customerId,
    fallbackModel: opts.fallbackModel,
  });
}

// Embeddings via text-embedding-004
export async function geminiEmbed(text: string, taskType:
  "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" | "SEMANTIC_SIMILARITY" = "SEMANTIC_SIMILARITY",
): Promise<number[]> {
  const apiKey = getApiKey();
  const url = `${API_BASE}/models/text-embedding-004:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType,
    }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.embedding?.values || [];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
