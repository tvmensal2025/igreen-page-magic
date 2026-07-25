/**
 * sync-ai-audit — Gemini 2.5 Flash analisa sync de carteira (shadow review).
 * Worker manda trace + resultado; edge persiste em sync_audit_traces.
 * Limite: SYNC_AI_AUDIT_LIMIT (default 20) para status ok; falhas sempre auditam.
 * Custo ~$0.0002/run (mesmo do Portal 2).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifySuperAdminOpsAlert } from "../_shared/superadmin-alert.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret, x-worker-token",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DEFAULT_LIMIT = 20;

const SYSTEM_PROMPT = `Você é um engenheiro sênior auditando o SYNC de carteira iGreen
(worker Playwright + API api-vo do escritório).

Você recebe:
1. Contexto da operação (rota HTTP, email mascarado, duração)
2. Resultado resumido (contagens de clientes/rede/boletos, diagnostics)
3. Trace de logs do worker (steps)
4. Erro, se houver

Foque em:
- **Login/WAF/Cloudflare**: 403 blocked, captcha, proxy/Tor, session
- **Cobertura**: 0 clientes quando esperava lista; Kanban truncado vs cadastros-by-day
- **API**: 4xx/5xx, timeouts, endpoints quebrados
- **Dados**: inconsistência óbvia (null em massa, diagnostics.error)
- **Infra**: Redis NÃO se aplica aqui; proxy/egress importa

NÃO invente. Seja específico e acionável.

JSON de resposta:
{
  "summary": "2-3 frases",
  "findings": [
    { "severity": "info|warning|error", "category": "login|waf|api|data|infra",
      "title": "curto", "detail": "o que olhar" }
  ],
  "next_actions": ["ação concreta"]
}
1-5 findings. Se ok: findings=[] e summary curto.`;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

function maskEmail(raw: string | null | undefined): string | null {
  const e = String(raw || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return e || null;
  const [u, d] = e.split("@");
  if (!d) return "***";
  const uu = u.length <= 2 ? "*" : `${u[0]}***${u.slice(-1)}`;
  return `${uu}@${d}`;
}

function authToken(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  return (
    auth.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-worker-secret") ||
    req.headers.get("x-worker-token") ||
    ""
  ).trim();
}

function allowedSecrets(): string[] {
  return [
    Deno.env.get("IGREEN_SYNC_WORKER_SECRET"),
    Deno.env.get("PORTAL2_WORKER_SECRET"),
    Deno.env.get("WORKER_SECRET"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secrets = allowedSecrets();
  const geminiSet = !!(Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY"));

  if (req.method === "GET") {
    return json({
      ok: true,
      domain: "sync",
      worker_secret_configured: secrets.length > 0,
      gemini_configured: geminiSet,
      model: GEMINI_MODEL,
      limit_default: DEFAULT_LIMIT,
    });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = authToken(req);
  if (!secrets.length) {
    return json({ error: "audit_secret_not_configured" }, 503);
  }
  if (!token || !secrets.includes(token)) {
    return json({ error: "audit_secret_mismatch" }, 401);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) return json({ error: "gemini_not_configured" }, 503);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const status = String(body.status || "ok");
  const isError = status === "error" || status === "failed" || !!body.error;
  const limitEnv = Number(Deno.env.get("SYNC_AI_AUDIT_LIMIT"));
  const limit = Number.isFinite(limitEnv) && limitEnv >= 0 ? limitEnv : DEFAULT_LIMIT;

  // Conta só runs que realmente chamaram Gemini (skipped=false).
  const { count: auditedCount } = await supabase
    .from("sync_audit_traces")
    .select("id", { count: "exact", head: true })
    .eq("skipped", false)
    .neq("status", "error"); // falhas não consomem o orçamento de "ok"

  const okCount = auditedCount ?? 0;
  const overLimit = !isError && limit > 0 && okCount >= limit;

  const emailMasked = maskEmail(body.consultant_email as string);
  const route = String(body.route || "unknown");
  const duration_ms = Number(body.duration_ms) || null;
  const consultor_id = body.consultor_id != null ? String(body.consultor_id) : null;
  const input_summary = body.input ?? body.input_summary ?? null;
  const result = body.result ?? null;
  const trace = body.trace ?? lastDebugSteps(body);
  const error = body.error ? String(body.error).slice(0, 2000) : null;

  if (overLimit) {
    await supabase.from("sync_audit_traces").insert({
      consultant_email: emailMasked,
      consultor_id,
      route,
      status,
      duration_ms,
      error,
      input_summary,
      result,
      trace,
      skipped: true,
      skip_reason: `limit_${limit}`,
    });
    return json({ ok: true, skipped: true, reason: "limit", audited_ok: okCount, limit });
  }

  if (limit === 0 && !isError) {
    return json({ ok: true, skipped: true, reason: "disabled" });
  }

  const userText =
    `## Contexto\n` +
    `rota=${route} status=${status} email=${emailMasked || "?"} consultor_id=${consultor_id || "?"}\n` +
    `duration_ms=${duration_ms ?? "?"}\n\n` +
    `## Input\n\`\`\`json\n${JSON.stringify(input_summary, null, 2)?.slice(0, 8000)}\n\`\`\`\n\n` +
    `## Resultado\n\`\`\`json\n${JSON.stringify(result, null, 2)?.slice(0, 12000)}\n\`\`\`\n\n` +
    `## Erro\n${error || "(nenhum)"}\n\n` +
    `## Trace\n\`\`\`json\n${JSON.stringify(trace, null, 2)?.slice(0, 12000)}\n\`\`\``;

  const reqBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1500,
      responseMimeType: "application/json",
    },
  };

  let ai: {
    summary: string | null;
    findings: unknown[];
    next_actions: string[];
    tokens_in: number | null;
    tokens_out: number | null;
  } | null = null;
  let aiError: string | null = null;

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(to);
    }
    if (!res.ok) {
      aiError = `gemini_http_${res.status}: ${(await res.text()).slice(0, 300)}`;
    } else {
      const data = await res.json();
      const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      let parsed: { summary?: string; findings?: unknown[]; next_actions?: string[] } | null =
        null;
      try {
        parsed = JSON.parse(text);
      } catch {
        const m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (m) try {
          parsed = JSON.parse(m[1]);
        } catch {
          parsed = null;
        }
      }
      if (!parsed) parsed = { summary: text.slice(0, 1000), findings: [], next_actions: [] };
      ai = {
        summary: parsed.summary || null,
        findings: parsed.findings || [],
        next_actions: parsed.next_actions || [],
        tokens_in: data?.usageMetadata?.promptTokenCount ?? null,
        tokens_out: data?.usageMetadata?.candidatesTokenCount ?? null,
      };
    }
  } catch (e) {
    aiError = (e as Error).message;
  }

  const cost_usd = ai && ai.tokens_in != null
    ? Number(((ai.tokens_in * 0.075 + (ai.tokens_out || 0) * 0.30) / 1_000_000).toFixed(6))
    : null;

  await supabase.from("sync_audit_traces").insert({
    consultant_email: emailMasked,
    consultor_id,
    route,
    status: isError ? "error" : status,
    duration_ms,
    error: error || aiError,
    input_summary,
    result,
    trace,
    ai_summary: ai?.summary || (aiError ? `[ai_error] ${aiError}` : null),
    ai_findings: ai?.findings || null,
    ai_model: ai ? GEMINI_MODEL : null,
    ai_tokens_in: ai?.tokens_in ?? null,
    ai_tokens_out: ai?.tokens_out ?? null,
    ai_cost_usd: cost_usd,
    skipped: false,
  });

  // WA se sync falhou (ou finding error) — dedup 60min.
  const hasErrorFinding = Array.isArray(ai?.findings) &&
    (ai!.findings as { severity?: string }[]).some((f) => f?.severity === "error");
  if (isError || hasErrorFinding) {
    const sum = (ai?.summary || error || "sync falhou").slice(0, 400);
    await notifySuperAdminOpsAlert(supabase, {
      key: `sync_fail:${route}`,
      severity: "critical",
      dedupMinutes: 60,
      text:
        `🚨 *Sync carteira com falha*\n\n` +
        `Rota: \`${route}\`\n` +
        `Email: ${emailMasked || "?"}\n` +
        `Resumo IA: ${sum}\n\n` +
        `Detalhe em \`sync_audit_traces\` / Easy Panel logs.`,
    });
  }

  return json({
    ok: true,
    skipped: false,
    summary: ai?.summary ?? null,
    findings: ai?.findings ?? [],
    next_actions: ai?.next_actions ?? [],
    model: GEMINI_MODEL,
    tokens_in: ai?.tokens_in ?? null,
    tokens_out: ai?.tokens_out ?? null,
    cost_usd,
    ai_error: aiError,
  });
});

function lastDebugSteps(body: Record<string, unknown>): unknown {
  if (body.trace != null) return body.trace;
  if (Array.isArray(body.steps)) return body.steps;
  return [];
}
