// Shared helper para registrar decisões da IA (ai_decisions) e ler settings
// globais (strict_script_mode, thresholds de confiança). Fire-and-forget:
// erros aqui NUNCA devem quebrar o fluxo de mensagens.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface AiDecisionEntry {
  consultantId?: string | null;
  customerId?: string | null;
  phase?: string | null;          // ex: "intent_classify", "bot_flow", "faq"
  toolCalled?: string | null;     // ex: "classifyIntent", "openaiChat"
  model?: string | null;
  userInput?: string | null;
  intentDetected?: string | null;
  confidence?: number | null;
  stepBefore?: string | null;
  stepAfter?: string | null;
  replySent?: string | null;
  suppressed?: boolean | null;
  source?: string | null;         // "regex" | "openai" | "llm" | "fallback" | ...
  latencyMs?: number | null;
  reasoning?: string | null;
  traceId?: string | null;
  aiOutput?: Record<string, any> | null;
  channel?: string | null;        // "evolution" | "whapi" | null
}

function trunc(v: string | null | undefined, n: number): string | null {
  if (v == null) return null;
  return v.length > n ? v.slice(0, n) : v;
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function logAiDecision(entry: AiDecisionEntry): void {
  // fire-and-forget — nunca lança
  try {
    const sb = getAdminClient();
    if (!sb) return;
    const row = {
      consultant_id: entry.consultantId ?? null,
      customer_id: entry.customerId ?? null,
      phase: trunc(entry.phase ?? null, 100),
      tool_called: trunc(entry.toolCalled ?? null, 100),
      model: trunc(entry.model ?? null, 100),
      user_input: trunc(entry.userInput ?? null, 2000),
      intent_detected: trunc(entry.intentDetected ?? null, 100),
      confidence: entry.confidence ?? null,
      step_before: trunc(entry.stepBefore ?? null, 200),
      step_after: trunc(entry.stepAfter ?? null, 200),
      reply_sent: trunc(entry.replySent ?? null, 1000),
      suppressed: entry.suppressed ?? false,
      source: trunc(entry.source ?? null, 50),
      latency_ms: entry.latencyMs ?? null,
      reasoning: trunc(entry.reasoning ?? null, 1000),
      trace_id: trunc(entry.traceId ?? null, 100),
      ai_output: entry.aiOutput ?? null,
      channel: trunc(entry.channel ?? null, 20),
    };
    sb.from("ai_decisions").insert(row).then(({ error }) => {
      if (error) console.warn("[ai-decisions] insert failed:", error.message);
    });
  } catch (e) {
    console.warn("[ai-decisions] threw:", (e as Error).message);
  }
}

// ---------------- Settings cache (60s TTL) ----------------

interface SettingsCache {
  loadedAt: number;
  values: Record<string, string>;
}
let cache: SettingsCache | null = null;
const TTL_MS = 60_000;

async function loadSettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < TTL_MS) return cache.values;
  const sb = getAdminClient();
  if (!sb) return cache?.values ?? {};
  try {
    const { data, error } = await sb.from("settings").select("key,value");
    if (error) throw error;
    const values: Record<string, string> = {};
    for (const row of data ?? []) values[row.key] = String(row.value ?? "");
    cache = { loadedAt: now, values };
    return values;
  } catch (e) {
    console.warn("[ai-decisions] loadSettings failed:", (e as Error).message);
    return cache?.values ?? {};
  }
}

export async function isStrictScriptMode(): Promise<boolean> {
  const s = await loadSettings();
  return (s.strict_script_mode || "false").toLowerCase() === "true";
}

export async function getConfidenceThresholds(): Promise<{ handoff: number; execute: number }> {
  const s = await loadSettings();
  const handoff = parseFloat(s.ai_confidence_threshold_handoff || "0.5");
  const execute = parseFloat(s.ai_confidence_threshold_execute || "0.75");
  return {
    handoff: Number.isFinite(handoff) ? handoff : 0.5,
    execute: Number.isFinite(execute) ? execute : 0.75,
  };
}

export function invalidateSettingsCache() {
  cache = null;
}
