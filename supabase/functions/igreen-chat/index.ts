import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { HELP_SYSTEM_KNOWLEDGE, resolveHelpKnowledge } from "../_shared/help-system-knowledge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FALLBACK_KNOWLEDGE = "Você é a assistente virtual da iGreen Energy. Responda em português brasileiro de forma simpática e objetiva.";

async function loadKnowledge(supabaseUrl: string, supabaseKey: string): Promise<string> {
  let baseKnowledge = FALLBACK_KNOWLEDGE;
  let extraKnowledge = "";
  let coverageData = "";
  let helpKnowledge = HELP_SYSTEM_KNOWLEDGE;

  try {
    if (!supabaseUrl || !supabaseKey) return `${baseKnowledge}\n\n${helpKnowledge}`;
    const sb = createClient(supabaseUrl, supabaseKey);

    const { data: sections } = await sb
      .from("ai_knowledge_sections")
      .select("title, content")
      .eq("is_active", true)
      .is("consultant_id", null)  // apenas seções globais no chat interno
      .order("position", { ascending: true });

    if (sections && sections.length > 0) {
      baseKnowledge = sections.map((s: { title: string; content: string }) =>
        `==========================================================\n${s.title}\n==========================================================\n\n${s.content}`
      ).join("\n\n");
    }

    const { data: articles } = await sb
      .from("tour_articles")
      .select("category, title, body, video_url")
      .eq("is_active", true)
      .order("order_index", { ascending: true });
    helpKnowledge += resolveHelpKnowledge(articles || []);

    const { data: extraData } = await sb.from("settings").select("value").eq("key", "ai_knowledge_extra").maybeSingle();
    if (extraData?.value) {
      extraKnowledge = `\n\n==========================================================\nCONHECIMENTO EXTRA (atualizado pelo administrador)\n==========================================================\n\n${extraData.value}`;
    }

    const { data: coverageRows } = await sb.rpc("get_coverage_summary" as any);
    if (coverageRows && Array.isArray(coverageRows) && coverageRows.length > 0) {
      const lines = (coverageRows as any[]).map((r: any) =>
        `- ${r.distribuidora} | ${r.uf} | Cidades confirmadas: ${r.cidades} (${r.total_clientes} clientes ativos)`
      );
      coverageData = `\n\n==========================================================\nDADOS REAIS DE COBERTURA (fonte: banco de dados atualizado)\n==========================================================\n\nEstas são as distribuidoras e cidades onde a iGreen TEM clientes ativos confirmados:\n\n${lines.join("\n")}`;
    } else {
      const { data: rawCoverage } = await sb
        .from("customers")
        .select("distribuidora, address_state, address_city")
        .not("distribuidora", "is", null)
        .not("address_state", "is", null)
        .eq("status", "active");

      if (rawCoverage && rawCoverage.length > 0) {
        const coverageMap = new Map<string, { cities: Set<string>; count: number }>();
        for (const c of rawCoverage) {
          const key = `${c.distribuidora}|${c.address_state}`;
          if (!coverageMap.has(key)) coverageMap.set(key, { cities: new Set(), count: 0 });
          const entry = coverageMap.get(key)!;
          if (c.address_city) entry.cities.add(c.address_city);
          entry.count++;
        }
        const lines: string[] = [];
        for (const [key, val] of coverageMap.entries()) {
          const [dist, uf] = key.split("|");
          const cityList = [...val.cities].sort().slice(0, 20).join(", ");
          lines.push(`- ${dist} | ${uf} | Cidades: ${cityList} (${val.count} clientes)`);
        }
        if (lines.length > 0) {
          coverageData = `\n\n==========================================================\nDADOS REAIS DE COBERTURA (fonte: banco de dados atualizado)\n==========================================================\n\nEstas são as distribuidoras e cidades onde a iGreen TEM clientes ativos confirmados:\n\n${lines.join("\n")}`;
        }
      }
    }
  } catch (e) {
    console.error("Failed to load knowledge:", e);
  }

  return `${baseKnowledge}\n\n${helpKnowledge}${extraKnowledge}${coverageData}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, history, stream } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prioriza Lovable AI Gateway (mais estável, sem limites de free-tier do Google)
    // Fallback para Google AI direto se Lovable AI não estiver disponível
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const googleKey = Deno.env.get("GOOGLE_AI_API_KEY");
    const apiKey = lovableKey || googleKey;
    const useLovable = !!lovableKey;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ reply: "Desculpe, o assistente está temporariamente indisponível. Entre em contato pelo WhatsApp do consultor. 💚" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const fullKnowledge = await loadKnowledge(supabaseUrl, supabaseKey);

    // Formato Gemini (nativo)
    const geminiContents: any[] = [];
    if (history && Array.isArray(history)) {
      for (const msg of history.slice(-14)) {
        geminiContents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.text }],
        });
      }
    }
    geminiContents.push({ role: "user", parts: [{ text: message }] });

    // Formato OpenAI-compat (Lovable AI Gateway)
    const openaiMessages: any[] = [
      { role: "system", content: fullKnowledge },
    ];
    if (history && Array.isArray(history)) {
      for (const msg of history.slice(-14)) {
        openaiMessages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.text,
        });
      }
    }
    openaiMessages.push({ role: "user", content: message });

    // Streaming mode
    if (stream) {
      const res = useLovable
        ? await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: openaiMessages,
              stream: true,
              temperature: 0.4,
              max_tokens: 1500,
            }),
          })
        : await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                system_instruction: { parts: [{ text: fullKnowledge }] },
                contents: geminiContents,
                generationConfig: { temperature: 0.4, maxOutputTokens: 1500, topP: 0.85 },
              }),
            }
          );

      if (!res.ok) {
        const errorBody = await res.text();
        console.error(`AI streaming error (${useLovable ? "Lovable" : "Google"}):`, res.status, errorBody);
        if (res.status === 429) {
          return new Response(
            JSON.stringify({ reply: "Estou recebendo muitas perguntas no momento 🥵 Tente novamente em alguns segundos. 💚" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (res.status === 402) {
          return new Response(
            JSON.stringify({ reply: "O assistente precisa de créditos para continuar. Avise o administrador. 💚" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ reply: "Desculpe, não consegui processar sua pergunta agora. Tente novamente em instantes. 💚" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Se for Lovable AI, converte SSE OpenAI -> formato Gemini que o frontend já entende
      if (useLovable && res.body) {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();

        (async () => {
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let idx: number;
              while ((idx = buffer.indexOf("\n")) !== -1) {
                let line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                if (line.endsWith("\r")) line = line.slice(0, -1);
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") {
                  await writer.write(encoder.encode("data: [DONE]\n\n"));
                  continue;
                }
                try {
                  const j = JSON.parse(payload);
                  const delta = j?.choices?.[0]?.delta?.content;
                  if (delta) {
                    const geminiShaped = {
                      candidates: [{ content: { parts: [{ text: delta }] } }],
                    };
                    await writer.write(encoder.encode(`data: ${JSON.stringify(geminiShaped)}\n\n`));
                  }
                } catch { /* skip partial */ }
              }
            }
          } finally {
            await writer.close();
          }
        })();

        return new Response(readable, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }

      return new Response(res.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    // Non-streaming mode (fallback)
    const res = useLovable
      ? await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: openaiMessages,
            temperature: 0.4,
            max_tokens: 1500,
          }),
        })
      : await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: fullKnowledge }] },
              contents: geminiContents,
              generationConfig: { temperature: 0.4, maxOutputTokens: 1500, topP: 0.85 },
            }),
          }
        );

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`AI error (${useLovable ? "Lovable" : "Google"}):`, res.status, errorBody);
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ reply: "Estou recebendo muitas perguntas no momento 🥵 Tente novamente em alguns segundos. 💚" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (res.status === 402) {
        return new Response(
          JSON.stringify({ reply: "O assistente precisa de créditos para continuar. Avise o administrador. 💚" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ reply: "Desculpe, não consegui processar sua pergunta agora. Tente novamente em instantes. 💚" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();
    const reply = useLovable
      ? (data?.choices?.[0]?.message?.content || "Desculpe, não entendi. Pode reformular? 😊")
      : (data?.candidates?.[0]?.content?.parts?.[0]?.text || "Desculpe, não entendi. Pode reformular? 😊");

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({ reply: "Ocorreu um erro. Tente novamente. 💚" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
