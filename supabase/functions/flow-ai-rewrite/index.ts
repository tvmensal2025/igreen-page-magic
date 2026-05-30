// Reescreve um pedaço de texto curto (mensagem de passo, título de botão,
// frase de regra) usando Gemini. Ação determina o estilo da reescrita.
// Usado pelo InlineAiButton (✨) no StepInspector.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type Action =
  | "shorten"
  | "expand"
  | "formal"
  | "casual"
  | "fix"
  | "generate"
  | "rewrite";

interface Body {
  text: string;
  action: Action;
  context?: string; // hint extra (ex: "título de botão", "mensagem inicial")
  instruction?: string; // pedido livre do usuário pra action=rewrite/generate
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

function actionPrompt(a: Action, instruction?: string): string {
  switch (a) {
    case "shorten":
      return "Encurte o texto mantendo o sentido. Direto e claro, máximo 2 frases.";
    case "expand":
      return "Expanda o texto com mais detalhe e cordialidade, mas sem encher linguiça. Máximo 4 frases.";
    case "formal":
      return "Reescreva em tom mais formal e profissional, sem perder a clareza.";
    case "casual":
      return "Reescreva em tom mais casual, próximo, como WhatsApp de amigo. Pode usar emoji se fizer sentido.";
    case "fix":
      return "Corrija gramática, pontuação e ortografia. Não mude o sentido.";
    case "generate":
      return `Gere um texto novo seguindo este pedido: ${instruction || "melhore para WhatsApp"}.`;
    case "rewrite":
    default:
      return instruction
        ? `Reescreva atendendo este pedido: ${instruction}.`
        : "Reescreva de forma mais clara e amigável pra WhatsApp.";
  }
}

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
    const text = (body?.text || "").trim();
    const action = body?.action || "rewrite";
    if (!text && action !== "generate") return json({ error: "missing_text" }, 400);

    const sys =
      "Você é um copywriter sênior pra fluxos de WhatsApp B2C de energia solar (iGreen). " +
      "Tom: humano, direto, sem clichê de bot, sem 'estou aqui para ajudar'. " +
      "Mantenha variáveis exatamente como {{nome}}, {{valor_conta}}, {{representante}}. " +
      "Responda APENAS com o texto final, sem aspas, sem explicação, sem markdown.";

    const userMsg = [
      body.context ? `Contexto: ${body.context}.` : "",
      actionPrompt(action, body.instruction),
      action === "generate" ? "" : `\nTexto original:\n${text}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const r = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: userMsg }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
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

    return json({ text: out });
  } catch (e) {
    console.error("flow-ai-rewrite error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
