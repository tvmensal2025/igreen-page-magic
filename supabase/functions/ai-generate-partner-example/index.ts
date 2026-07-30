// Gera um exemplo de primeira mensagem de lead com base em uma palavra-chave
// de parceiro indicador. Usado no formulário de Parceiros para o consultor
// validar visualmente se a keyword captura bem o que o lead vai escrever.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiChat } from "../_shared/ai-gateway.ts";

const SYSTEM = `Você gera UM exemplo curto de mensagem que um lead enviaria
no WhatsApp de um consultor da iGreen Energy interessado em economizar na conta
de luz. Regras:
- 1 frase, no máximo 2. PT-BR natural, como o lead escreveria de verdade.
- Sempre começa com um cumprimento ("Olá", "Oi", "Boa tarde", "Bom dia").
- Sempre menciona economizar/reduzir a conta de energia/luz.
- Sempre inclui a palavra-chave fornecida de forma natural no texto.
- Sempre termina pedindo ajuda ("me ajuda", "pode me ajudar?", "queria saber mais").
- Sem emoji, sem markdown, sem aspas.
- Se a palavra-chave for um nome próprio, trate como indicação ("a/o {nome} me indicou").
- Se for um tema (solar, conta alta, desconto), incorpore como assunto.
Devolva APENAS o texto da mensagem, nada mais.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Endpoint consome créditos de IA: exige usuário autenticado.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { keyword, partner_name } = await req.json();
    const kw = typeof keyword === "string" ? keyword.trim() : "";
    if (!kw) {
      return new Response(JSON.stringify({ error: "keyword obrigatória" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (kw.length > 80) {
      return new Response(JSON.stringify({ error: "keyword muito longa" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMsg = `Palavra-chave do parceiro: "${kw}"${
      partner_name ? `\nNome do parceiro indicador: "${partner_name}"` : ""
    }\n\nGere o exemplo de mensagem do lead agora.`;

    const result = await aiChat({
      model: "google/gemini-3-flash-preview",
      temperature: 0.8,
      maxTokens: 200,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
    });

    let example = (result.text || "").trim().replace(/^["']|["']$/g, "");
    if (!example) {
      example = `Olá, queria saber como economizar na minha conta de energia, ${kw}, me ajuda?`;
    }

    return new Response(JSON.stringify({ example }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || "erro desconhecido";
    const status = msg.includes("429") ? 429 : msg.includes("402") ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
