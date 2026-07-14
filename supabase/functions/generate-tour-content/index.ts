import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Você escreve textos curtos e claros em português brasileiro para um TOUR interativo da plataforma iGreen (CRM + WhatsApp + Meta Ads para consultores de energia).

Regras absolutas:
- Público: novo consultor licenciado, leigo em tecnologia.
- Tom: direto, gentil, sem jargão. Trate por "você".
- Título: até 40 caracteres, sem ponto final.
- Texto: até 200 caracteres, 1-2 frases, explicando O QUE É e POR QUE IMPORTA.
- Nunca use termos técnicos (webhook, RLS, edge function, JWT, etc).
- Nunca invente funcionalidades — só use o contexto fornecido.
- Responda SEMPRE JSON válido.`;

const CONTEXT = `A plataforma faz:
- Captação: leads chegam de anúncios do Meta (Facebook/Instagram) e caem numa lista.
- WhatsApp: o consultor conecta seu número via QR code. Um robô com IA atende 24/7, faz o cadastro do cliente no portal iGreen, pausa quando o consultor manda mensagem manual.
- CRM Kanban: cada lead vira um card que se move entre colunas (novo → conversando → cadastrado → ativo).
- Conversão: leads dos últimos 120 dias que esfriaram podem ser reativados.
- Motor de Cadência: se cliente não responde, tenta WhatsApp → ligação → SMS em sequência.
- Meta Ads: cria campanhas do Facebook direto na plataforma, com carteira pré-paga (mínimo 7 dias de orçamento). Protocolo automático YYMMDD-#### identifica cada lead.
- Hub de textos (/admin/agendamentos-central): 15 abas com todas as frases que o robô fala (fluxos, FAQ, follow-up, pós-venda, respostas rápidas, cadência, campanhas, CRM automático, personalidade da IA, calendário de feriados).
- Central de Automações: interruptores grandes para ligar/desligar cada função sem código.
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "LOVABLE_API_KEY ausente" }, 500);

    const auth = req.headers.get("Authorization") || "";
    if (!auth) return json({ error: "Sem autorização" }, 401);

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return json({ error: "Não autenticado" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: roleData } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) return json({ error: "Apenas admins podem gerar conteúdo" }, 403);

    const body = await req.json().catch(() => ({}));
    const mode: "all" | "step" = body?.mode === "step" ? "step" : "all";
    const orderIndex: number | undefined = body?.order_index;

    const { data: stepsData } = await admin
      .from("tour_steps")
      .select("id, order_index, route, selector, title, body, cta_label, cta_href")
      .order("order_index");
    const steps = stepsData || [];
    const toProcess = mode === "step"
      ? steps.filter((s: any) => s.order_index === orderIndex)
      : steps;

    if (toProcess.length === 0) return json({ error: "Nenhum passo encontrado" }, 404);

    async function callAI(prompt: string) {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM },
            { role: "system", content: CONTEXT },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (r.status === 429) throw new Error("Muitas chamadas. Aguarde alguns segundos.");
      if (r.status === 402) throw new Error("Crédito de IA esgotado.");
      if (!r.ok) throw new Error(`IA indisponível: ${(await r.text()).substring(0, 200)}`);
      const j = await r.json();
      return JSON.parse(j?.choices?.[0]?.message?.content || "{}");
    }

    let updated = 0;
    for (const s of toProcess) {
      const context = `Passo ${(s as any).order_index} do tour. Rota: ${(s as any).route}. Contexto atual (pode estar vazio):\nTítulo atual: "${(s as any).title}"\nTexto atual: "${(s as any).body}"\n\nGere um NOVO título e texto para este passo. Retorne JSON: { "title": "…", "body": "…" }`;
      try {
        const out = await callAI(context);
        if (out?.title && out?.body) {
          await admin.from("tour_steps").update({
            title: String(out.title).substring(0, 60),
            body: String(out.body).substring(0, 240),
          }).eq("id", (s as any).id);
          updated++;
        }
      } catch (e) {
        console.error("[gen-tour] step", (s as any).order_index, e);
      }
    }

    // Also generate articles once (all mode)
    let articlesCreated = 0;
    if (mode === "all") {
      const { count } = await admin.from("tour_articles").select("*", { count: "exact", head: true });
      if ((count ?? 0) === 0) {
        const artPrompt = `Crie 7 artigos curtos para a Central de Ajuda, um por categoria: WhatsApp, Campanhas, CRM, Cadência, Pós-venda, Textos e IA, Financeiro. Retorne JSON: { "articles": [ { "category": "WhatsApp", "title": "…", "body": "texto de 3-5 linhas" }, ... ] }`;
        try {
          const out = await callAI(artPrompt);
          const arts = Array.isArray(out?.articles) ? out.articles : [];
          for (let i = 0; i < arts.length; i++) {
            const a = arts[i];
            if (!a?.category || !a?.title) continue;
            const relStep = steps.find((s: any) => {
              const cat = String(a.category).toLowerCase();
              if (cat.includes("whatsapp")) return s.order_index === 3;
              if (cat.includes("campanha")) return s.order_index === 9;
              if (cat.includes("crm")) return s.order_index === 5;
              if (cat.includes("cadên")) return s.order_index === 8;
              if (cat.includes("textos")) return s.order_index === 10;
              return false;
            });
            await admin.from("tour_articles").insert({
              category: a.category,
              title: String(a.title).substring(0, 100),
              body: String(a.body || "").substring(0, 800),
              order_index: i,
              related_tour_step_id: (relStep as any)?.id || null,
            });
            articlesCreated++;
          }
        } catch (e) { console.error("[gen-tour] articles", e); }
      }
    }

    return json({ updated, articles: articlesCreated });
  } catch (e) {
    console.error("[gen-tour]", e);
    return json({ error: (e as Error).message }, 500);
  }
});
