// Edge function: portal2-ai-audit
//
// Usado pelo worker-portal-2 pra analisar traces de cadastro com Gemini sem
// precisar expor GEMINI_API_KEY no container do worker. O worker manda o
// trace + input + result, recebe de volta { summary, findings, next_actions }.
//
// Auth: header `Authorization: Bearer ${WORKER_SECRET}` (mesma chave do worker
// HTTP). Rejeita JWT comum pra evitar uso fora do worker.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `Você é um engenheiro sênior auditando o cadastro automatizado de um cliente
no sistema iGreen Energy (energia por assinatura) via API.

Você recebe:
1. Dados de entrada do cliente (CPF, endereço, dados da fatura, etc.)
2. Trace completo das chamadas HTTP feitas pra API iGreen
3. Resultado final (sucesso com idcliente, ou falha com mensagem de erro)

Sua tarefa: identificar problemas, anomalias ou pontos cegos que mereçam
atenção humana. Foque em:

- **Dados ausentes ou inconsistentes**: campos vazios que deveriam estar
  preenchidos, conflitos entre OCR e dados digitados.
- **Erros de API**: respostas 4xx/5xx, mensagens de validação reveladoras,
  campos rejeitados pelo backend que indicam regra de negócio nova.
- **Decisões automáticas duvidosas**: estimativas de consumo, escolha de
  bonus rule, normalização de concessionária quando há ambiguidade.
- **Performance**: calls lentas (>10s) que podem indicar instabilidade.
- **Robustez**: pontos onde o código rodou sem erro mas o input estava
  estranho (ex: nome com acento corrompido, CEP genérico sem cidade).

NÃO repita o que aconteceu literalmente — analise. Seja específico, técnico
e acionável. Cite números (status HTTP, durações, valores) quando relevante.

Responda em JSON com este shape:
{
  "summary": "string — 2-3 frases descrevendo o que rolou e o veredicto geral",
  "findings": [
    {
      "severity": "info|warning|error",
      "category": "data|api|business_rule|performance|robustness",
      "title": "string curta",
      "detail": "string — o que aconteceu, por que é relevante, o que olhar"
    }
  ],
  "next_actions": ["string — sugestões concretas pro time"]
}

Seja conciso. 1-5 findings é o ideal. Se rodou tudo perfeito, retorne
findings=[] e summary curtinho.`;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Health-check: GET sem corpo pra worker testar conectividade/secret no boot.
  if (req.method === "GET") {
    const workerSecretSet = !!(Deno.env.get("PORTAL2_WORKER_SECRET") || Deno.env.get("WORKER_SECRET"));
    const geminiSet = !!(Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY"));
    return json({ ok: true, worker_secret_configured: workerSecretSet, gemini_configured: geminiSet });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Auth: aceita PORTAL2_WORKER_SECRET (preferido) ou WORKER_SECRET (compat).
  // Aceita também via header alternativo x-worker-secret pra quem não quer
  // mexer no Authorization (alguns gateways tratam Authorization como JWT).
  const auth = req.headers.get("authorization") || "";
  const token = (auth.replace(/^Bearer\s+/i, "") || req.headers.get("x-worker-secret") || "").trim();
  const workerSecret = (Deno.env.get("PORTAL2_WORKER_SECRET") || Deno.env.get("WORKER_SECRET") || "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

  if (!workerSecret && !serviceKey) {
    console.error("[portal2-ai-audit] PORTAL2_WORKER_SECRET ausente — defina no Supabase Functions Secrets");
    return json({ error: "audit_secret_not_configured", hint: "set PORTAL2_WORKER_SECRET in Supabase Functions Secrets" }, 503);
  }
  if (!token) {
    return json({ error: "missing_authorization", hint: "send Authorization: Bearer <PORTAL2_WORKER_SECRET>" }, 401);
  }
  if (token !== workerSecret && token !== serviceKey) {
    console.warn("[portal2-ai-audit] secret mismatch — worker WORKER_SECRET ≠ Supabase PORTAL2_WORKER_SECRET");
    return json({ error: "audit_secret_mismatch", hint: "worker WORKER_SECRET must equal Supabase PORTAL2_WORKER_SECRET" }, 401);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) return json({ error: "gemini_not_configured", hint: "set GEMINI_API_KEY in Supabase Functions Secrets" }, 503);


  let body: { input: unknown; result: unknown; trace: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object" || !("trace" in body)) {
    return json({ error: "missing_trace" }, 400);
  }

  const userText =
    `## Dados de entrada\n\`\`\`json\n${JSON.stringify(body.input, null, 2)}\n\`\`\`\n\n` +
    `## Resultado\n\`\`\`json\n${JSON.stringify(body.result, null, 2)}\n\`\`\`\n\n` +
    `## Trace de chamadas (${(body.trace as unknown[])?.length || 0} eventos)\n\`\`\`json\n${JSON.stringify(body.trace, null, 2)}\n\`\`\``;

  const reqBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1500,
      responseMimeType: "application/json",
    },
  };

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
  } catch (e) {
    return json({ error: "gemini_fetch_failed", detail: String(e) }, 502);
  } finally { clearTimeout(to); }

  if (!res.ok) {
    const txt = await res.text();
    return json({ error: "gemini_status", status: res.status, body: txt.slice(0, 500) }, 502);
  }
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  let parsed: { summary?: string; findings?: unknown[]; next_actions?: string[] } | null = null;
  try { parsed = JSON.parse(text); } catch {
    const m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (m) try { parsed = JSON.parse(m[1]); } catch { parsed = null; }
  }
  // Gemini às vezes retorna JSON dentro de campo "summary" como string. Re-parse.
  if (parsed && typeof parsed.summary === "string") {
    const inner = parsed.summary.trim();
    if (inner.startsWith("{")) {
      try {
        const reparsed = JSON.parse(inner);
        if (reparsed && typeof reparsed === "object" && (reparsed.summary || reparsed.findings)) {
          parsed = reparsed;
        }
      } catch { /* ignore */ }
    }
  }
  if (!parsed) parsed = { summary: text.slice(0, 1000), findings: [], next_actions: [] };

  return json({
    summary: parsed.summary || null,
    findings: parsed.findings || [],
    next_actions: parsed.next_actions || [],
    model: GEMINI_MODEL,
    tokens_in: data?.usageMetadata?.promptTokenCount ?? null,
    tokens_out: data?.usageMetadata?.candidatesTokenCount ?? null,
  });
});
