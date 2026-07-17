// Gera texto persuasivo para um passo do fluxo usando Google Gemini oficial.
// A e C usam a mesma regra de áudio + texto; B continua sendo somente texto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  consultantId: string;
  stepId: string;
  variant?: "A" | "B" | "C";
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "missing_gemini_key", message: "GEMINI_API_KEY não configurada." }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await userClient.auth.getUser(jwt);
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "unauthorized" }, 401);

    const body = (await req.json()) as Body;
    if (!body?.consultantId || !body?.stepId) {
      return json({ error: "missing_fields" }, 400);
    }
    if (userId !== body.consultantId) {
      const { data: isAdmin } = await supabase.rpc("is_super_admin", { _user_id: userId });
      if (!isAdmin) return json({ error: "forbidden" }, 403);
    }

    const variant = (body.variant || "A").toUpperCase();

    // Passo atual + contexto (anterior/seguinte)
    const { data: step } = await supabase
      .from("bot_flow_steps")
      .select("id, step_key, slot_key, title, summary, message_text, position, flow_id, step_type")
      .eq("id", body.stepId)
      .maybeSingle();
    if (!step) return json({ error: "step_not_found" }, 404);

    const { data: surround } = await supabase
      .from("bot_flow_steps")
      .select("position, title, message_text, step_type")
      .eq("flow_id", (step as any).flow_id)
      .eq("is_active", true)
      .gte("position", Math.max(0, Number((step as any).position) - 2))
      .lte("position", Number((step as any).position) + 1)
      .order("position", { ascending: true });

    // Mídia do slot + transcript (se houver áudio)
    const slotKey = (step as any).slot_key || (step as any).step_key;
    const { data: medias } = await supabase
      .from("ai_media_library")
      .select("kind, label, transcript")
      .eq("consultant_id", body.consultantId)
      .eq("slot_key", slotKey || "")
      .eq("active", true)
      .eq("is_draft", false);
    const audioTranscripts = ((medias || []) as any[])
      .filter((m) => String(m.kind).toLowerCase() === "audio" && m.transcript)
      .map((m) => String(m.transcript).trim())
      .filter(Boolean);
    const hasVideo = ((medias || []) as any[]).some((m) => String(m.kind).toLowerCase() === "video");
    const hasImage = ((medias || []) as any[]).some((m) => String(m.kind).toLowerCase() === "image");

    // Consultor (representante)
    const { data: consultant } = await supabase
      .from("consultants")
      .select("name")
      .eq("id", body.consultantId)
      .maybeSingle();
    const representante = (consultant as any)?.name || "iGreen Energy";

    // A e C compartilham exatamente a mesma regra: áudio + texto.
    const variantBrief =
      variant === "B"
        ? "VARIANTE B (sem áudio): Gere o TEXTO COMPLETO que substitui o áudio. Conteúdo completo do passo + CTA de fechamento forte e direto."
        : "VARIANTE A/C (áudio + texto): Gere uma frase CURTA (1-2 linhas) que COMPLEMENTA o áudio, reforçando o CTA de fechamento sem repetir o áudio.";

    const contextLines = ((surround || []) as any[])
      .map((s) => `  - [pos ${s.position}] ${s.title || "(sem título)"}: ${(s.message_text || "").slice(0, 160)}`)
      .join("\n");

    const audioBlock = audioTranscripts.length
      ? `\nTranscrição do áudio deste passo:\n"""${audioTranscripts.join("\n---\n").slice(0, 1500)}"""`
      : "";
    const mediaInfo = `Mídias no passo: ${hasVideo ? "vídeo " : ""}${hasImage ? "imagem " : ""}${audioTranscripts.length ? "áudio" : ""}`.trim();

    const prompt = `Você é copywriter da iGreen Energy escrevendo mensagem de WhatsApp para um lead.
Tom: consultivo, direto, próximo, gera urgência sutil. Português BR. SEM emojis exagerados (no máx 1).
Use variáveis quando fizer sentido: {{nome}}, {{valor_conta}}, {{representante}}.
Representante: ${representante}.

PASSO ATUAL:
- Título: ${(step as any).title || "(sem título)"}
- Resumo: ${(step as any).summary || "(sem resumo)"}
- Texto atual (referência, pode reescrever): ${(step as any).message_text || "(vazio)"}
- ${mediaInfo}
${audioBlock}

CONTEXTO (passos vizinhos):
${contextLines || "  (nenhum)"}

${variantBrief}

REGRAS:
- Sem saudação ("Oi", "Bom dia") a menos que seja o primeiro passo.
- Máximo 3 linhas curtas. Quebra de linha entre frases.
- Termine com pergunta clara e profissional (ex.: "Posso seguir?", "Qual o próximo passo?", "Ficou claro?"). Evite gíria ("Bora?") e pressão de cadastro.
- Tom brasileiro, direto e profissional — sem urgência artificial.
- NÃO use markdown, NÃO use **negrito**.
- Retorne APENAS o texto final, nada mais.`;

    const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, maxOutputTokens: 400 },
      }),
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      console.error("[ai-generate-step-text] gemini error", resp.status, errTxt);
      if (resp.status === 429) return json({ error: "rate_limit", message: "Limite do Gemini atingido. Tente em alguns segundos." }, 429);
      return json({ error: "gemini_error", message: `Gemini retornou ${resp.status}.`, details: errTxt.slice(0, 300) }, 500);
    }
    const data = await resp.json();
    const text = String(
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("") || ""
    ).trim();
    if (!text) return json({ error: "empty_response", message: "Gemini não retornou texto." }, 500);

    return json({ ok: true, text });
  } catch (e) {
    console.error("[ai-generate-step-text] error", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
