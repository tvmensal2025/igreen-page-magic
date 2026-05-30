// Copiloto de fluxo: chat conversacional com contexto completo do fluxo.
// Recebe a lista de passos e a pergunta do usuário, devolve resposta em
// markdown. Usa Gemini com tool calling pra sugerir mudanças concretas
// (que o frontend renderiza como cards "Aplicar" — opcional, v2).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface FlowStepLite {
  id: string;
  position: number;
  title: string;
  step_type: string;
  message_text: string | null;
  is_active: boolean;
  buttons?: { id: string; title: string }[];
  rules?: { intent: string; goto: string }[];
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface Body {
  flowId: string;
  steps: FlowStepLite[];
  messages: ChatMsg[];
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "missing_gemini_key" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await userClient.auth.getUser(jwt);
    if (!userRes?.user?.id) return json({ error: "unauthorized" }, 401);

    const body = (await req.json()) as Body;
    if (!Array.isArray(body?.steps) || !Array.isArray(body?.messages)) {
      return json({ error: "missing_fields" }, 400);
    }

    const flowDump = body.steps
      .sort((a, b) => a.position - b.position)
      .map((s) => {
        const parts = [
          `#${s.position} [${s.step_type}] ${s.title}${s.is_active ? "" : " (inativo)"}`,
          s.message_text ? `  msg: ${truncate(s.message_text, 200)}` : "",
          s.buttons && s.buttons.length
            ? `  botões: ${s.buttons.map((b) => b.title).join(" | ")}`
            : "",
          s.rules && s.rules.length
            ? `  regras: ${s.rules.map((r) => `${r.intent}→${r.goto}`).join("; ")}`
            : "",
        ].filter(Boolean);
        return parts.join("\n");
      })
      .join("\n\n");

    const sys =
      "Você é um copiloto especialista em fluxos de WhatsApp B2C de energia solar (iGreen). " +
      "Você ajuda o admin a entender, melhorar e debugar o fluxo. Responda em PORTUGUÊS, " +
      "em markdown enxuto. Quando sugerir mudanças, seja concreto: cite o número do passo " +
      '(ex: "no passo #3"), o que mudar e por quê. Não invente passos que não existem. ' +
      "Se detectar problemas (regra quebrada, loop, passo sem saída), avise primeiro.";

    const contextMsg =
      `Fluxo atual (${body.steps.length} passos):\n\n${flowDump}\n\n` +
      "Use esse contexto pra responder a próxima pergunta do admin.";

    const contents = [
      { role: "user", parts: [{ text: contextMsg }] },
      { role: "model", parts: [{ text: "Ok, fluxo carregado. Pode perguntar." }] },
      ...body.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    ];

    const r = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: sys }] },
        contents,
        generationConfig: { temperature: 0.6, maxOutputTokens: 1400 },
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("gemini error", r.status, t);
      return json({ error: "ai_error", status: r.status }, 502);
    }

    const data = await r.json();
    const out =
      (data?.candidates?.[0]?.content?.parts?.[0]?.text as string | undefined)?.trim() || "";
    if (!out) return json({ error: "empty_response" }, 502);
    return json({ reply: out });
  } catch (e) {
    console.error("flow-copilot error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
