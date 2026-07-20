import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { HELP_SYSTEM_KNOWLEDGE, resolveHelpKnowledge } from "../_shared/help-system-knowledge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYS_PROMPT = `Você é o "Suporte iGreen", assistente do consultor licenciado iGreen Energy dentro do app de campanhas e CRM.

Seu trabalho:
- Responder rápido e direto, em português, com TOM de pessoa que ajuda (não corporativo).
- Sempre que possível, OLHE os dados do consultor abaixo (saldo, conexão FB, campanha, etc) e responda com base neles.
- Se o consultor pedir algo fora do escopo do iGreen Energy, redirecione com gentileza.
- Quando o problema é claro, dê o passo-a-passo numerado em até 8 passos. Sem enrolar.
- Em CADA passo diga ONDE clicar: item do menu esquerdo, nome da aba e nome do botão (iguais aos da tela).
- Termine com "Abra: [nome] — [rota]" quando houver página.
- Se faltar dado para diagnosticar, faça UMA pergunta objetiva.
- Para erros do Facebook (rejeição de anúncio, WhatsApp Business, saldo, conexão expirada, baixo alcance) dê a solução prática.
- NUNCA invente preços, números de telefone, links, botões ou políticas. Se não souber, diga "vou pedir para o suporte humano te chamar".

Regras importantes:
- Para anúncios e carteira, consulte os DADOS ATUAIS DO CONSULTOR antes de informar saldo, mínimo, taxa, situação ou motivo de reprovação.
- Para comissão, pagamento e situação de cliente, explique apenas o que estiver confirmado nos dados ou na documentação publicada.
- Uma resposta manual pode pausar a automação da conversa. Oriente o consultor a conferir o estado atual antes de reativar.
- Nunca afirme que uma automação está ligada, funcionando ou disponível sem evidência nos dados fornecidos.
- Não diga "robô"; diga "assistente automática". Não use a sigla DNC; diga "bloqueado" ou "nunca mais contatar".
- O WhatsApp em uso é Whapi; não peça reconectar Evolution só por status antigo.`;

Deno.serve(async (req) => {
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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

    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (!messages.length) return json({ error: "messages vazio" }, 400);

    // Coleta contexto do consultor (com service role pra bypass RLS)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const ctx: Record<string, unknown> = { consultant_id: user.id };
    let publishedHelp = "";
    try {
      const [{ data: c }, { data: w }, { data: fb }, { data: camp }, { data: articles }] = await Promise.all([
        admin.from("consultants").select("name,license,phone,approved").eq("id", user.id).maybeSingle(),
        admin.from("consultant_wallet").select("balance_cents,total_spent_cents,auto_pause_at_cents").eq("consultant_id", user.id).maybeSingle(),
        admin.from("facebook_connections").select("status,page_name,ad_account_name,ad_account_currency,whatsapp_destination_number,token_expires_at,validation_errors,pixel_id").eq("consultant_id", user.id).maybeSingle(),
        admin.from("facebook_campaigns").select("name,status,daily_budget_cents,leads_count,started_at,rejection_reason").eq("consultant_id", user.id).order("created_at", { ascending: false }).limit(3),
        admin.from("tour_articles").select("category,title,body,video_url").eq("is_active", true).order("order_index"),
      ]);
      ctx.consultor = c;
      ctx.carteira = w ? { saldo_reais: ((w.balance_cents || 0) / 100).toFixed(2), gasto_total_reais: ((w.total_spent_cents || 0) / 100).toFixed(2) } : null;
      ctx.facebook = fb;
      ctx.campanhas_recentes = camp;
      publishedHelp = resolveHelpKnowledge(articles || []);
    } catch (e) {
      console.warn("[support-chat] ctx error", e);
    }

    const fullMessages = [
      { role: "system", content: `${SYS_PROMPT}\n\n${HELP_SYSTEM_KNOWLEDGE}${publishedHelp}` },
      { role: "system", content: "DADOS ATUAIS DO CONSULTOR (use para responder com base na realidade dele):\n" + JSON.stringify(ctx, null, 2) },
      ...messages,
    ];

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: fullMessages, stream: false }),
    });
    if (r.status === 429) return json({ error: "Muitas perguntas seguidas. Espere alguns segundos e tente de novo." }, 429);
    if (r.status === 402) return json({ error: "Crédito de IA esgotado. Avise o admin." }, 402);
    if (!r.ok) {
      const t = await r.text();
      return json({ error: `IA indisponível: ${t.substring(0, 200)}` }, 502);
    }
    const j = await r.json();
    const reply = j?.choices?.[0]?.message?.content || "Desculpe, não consegui formular uma resposta.";
    return json({ reply });
  } catch (e) {
    console.error("[support-chat]", e);
    return json({ error: (e as Error).message }, 500);
  }
});