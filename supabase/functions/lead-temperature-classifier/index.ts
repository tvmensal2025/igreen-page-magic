// lead-temperature-classifier
// Analisa as últimas mensagens de um lead e classifica:
//   temperature, loss_reason, main_doubt, main_objection, summary,
//   next_action, next_msg_draft, conversion_chance, signals
// Grava em public.lead_insights (upsert).
//
// Modos:
//   POST { customer_id }                      → classifica 1 lead
//   POST { customer_ids: [...] }              → batch (até 25)
//   POST { consultant_id, scope: "stale_24h" } → re-classifica tudo do consultor
//                                                que está needs_reclassify=true ou
//                                                classified_at < now()-24h
//
// IMPORTANTE: dry_run=true por padrão NÃO envia nada. Só lê + grava insights.
// O envio de mensagens é responsabilidade de OUTRA função (F4).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const MODEL = "google/gemini-3-flash-preview";

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "classify_lead",
    description: "Analisa a conversa de um lead da iGreen (energia solar por assinatura) e devolve diagnóstico de conversão.",
    parameters: {
      type: "object",
      properties: {
        temperature: {
          type: "string",
          enum: ["hot", "warm", "cold", "dead", "objection", "rescue"],
          description: "hot=pronto pra fechar (mandou conta/CPF, perguntando como pagar). warm=engajado, faltam dados. cold=respondeu pouco, sem demonstrar interesse forte. dead=disse não / parou há 7+ dias. objection=tem dúvida/medo claro que está travando. rescue=lead que mandou algo (PDF/áudio/pergunta) e ficou sem resposta nossa.",
        },
        loss_reason: { type: "string", description: "Em até 60 caracteres: principal motivo de não ter avançado (silêncio_do_lead, desconfiança, preço, sem_conta_de_luz, etc). null se for hot." },
        main_doubt: { type: "string", description: "Principal dúvida do lead em 1 frase curta. null se não houver." },
        main_objection: { type: "string", description: "Principal objeção (golpe, fidelidade, preço, etc) em 1 frase. null se não houver." },
        summary: { type: "string", description: "Resumo da conversa em 1-2 frases para o consultor entender em 3 segundos." },
        next_action: { type: "string", description: "Próxima ação concreta e curta. Ex: 'Pedir foto da conta', 'Responder objeção golpe', 'Follow-up 24h'." },
        next_msg_template_shortcut: { type: "string", description: "Atalho do template recomendado, se algum se aplica. Opções: /oi1 /oi2 /oi3 /fup1h /fup24h /fup72h /fup7d /golpe /fidelidade /preco /comofunciona /problema /depois /jadesconto /medo /quemsomos. null se nenhum se aplica." },
        next_msg_draft: { type: "string", description: "Mensagem pronta personalizada (50-200 caracteres) que o consultor pode mandar agora. Use o nome do lead se souber." },
        conversion_chance: { type: "integer", description: "Chance de virar venda nos próximos 7 dias, 0-100." },
        signals: {
          type: "object",
          description: "Sinais detectados na conversa.",
          properties: {
            sent_bill: { type: "boolean" },
            mentioned_value: { type: "boolean" },
            asked_price: { type: "boolean" },
            mentioned_scam_fear: { type: "boolean" },
            asked_how_it_works: { type: "boolean" },
            said_no: { type: "boolean" },
            we_ghosted_them: { type: "boolean", description: "true se a ÚLTIMA mensagem foi do lead e nós não respondemos" },
          },
        },
      },
      required: ["temperature", "summary", "next_action", "next_msg_draft", "conversion_chance", "signals"],
    },
  },
};

async function callGemini(messagesText: string, leadName: string | null) {
  const sys = `Você é um especialista em conversão no WhatsApp para iGreen Energy (energia solar por assinatura, desconto de 15-20% na conta de luz, sem obra, sem fidelidade, regulada pela ANEEL Lei 14.300). Analise a conversa abaixo e classifique o lead. Seja direto e prático — o consultor vai ler isso em 3 segundos. Responda em português do Brasil.`;
  const user = `Lead: ${leadName ?? "(sem nome)"}\n\nConversa (mais recente embaixo):\n${messagesText}\n\nClassifique agora.`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "classify_lead" } },
    }),
  });

  if (!r.ok) {
    if (r.status === 429) throw new Error("rate_limited");
    if (r.status === 402) throw new Error("no_credits");
    const t = await r.text();
    throw new Error(`gemini_${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error("no_tool_call");
  const args = JSON.parse(call.function.arguments);
  return { args, tokens: data?.usage?.total_tokens ?? null };
}

async function classifyOne(sb: any, customerId: string) {
  const { data: customer } = await sb
    .from("customers")
    .select("id, consultant_id, name, customer_origin, lead_source")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) return { customer_id: customerId, skipped: "not_found" };

  const { data: msgs } = await sb
    .from("conversations")
    .select("message_direction, message_text, created_at, media_type")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(30);

  const recent = (msgs ?? []).reverse();
  if (recent.length === 0) return { customer_id: customerId, skipped: "no_messages" };

  const formatted = recent
    .map((m: any) => {
      const who = m.message_direction === "outbound" ? "NÓS" : "LEAD";
      const ts = new Date(m.created_at).toLocaleString("pt-BR");
      const body = m.media_type && m.media_type !== "text" ? `[${m.media_type}] ${m.message_text ?? ""}` : (m.message_text ?? "");
      return `[${ts}] ${who}: ${body.slice(0, 400)}`;
    })
    .join("\n");

  const { args, tokens } = await callGemini(formatted, customer.name);

  const upsert = {
    customer_id: customerId,
    consultant_id: customer.consultant_id,
    temperature: args.temperature,
    loss_reason: args.loss_reason ?? null,
    main_doubt: args.main_doubt ?? null,
    main_objection: args.main_objection ?? null,
    summary: args.summary,
    next_action: args.next_action,
    next_msg_draft: args.next_msg_draft,
    next_msg_template_shortcut: args.next_msg_template_shortcut ?? null,
    conversion_chance: Math.max(0, Math.min(100, args.conversion_chance ?? 0)),
    signals: args.signals ?? {},
    model_used: MODEL,
    tokens_used: tokens,
    classified_at: new Date().toISOString(),
    messages_count_at_classify: recent.length,
    needs_reclassify: false,
  };

  const { error } = await sb.from("lead_insights").upsert(upsert, { onConflict: "customer_id" });
  if (error) return { customer_id: customerId, error: error.message };
  return { customer_id: customerId, temperature: args.temperature, chance: upsert.conversion_chance };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));

    let ids: string[] = [];
    if (body.customer_id) ids = [body.customer_id];
    else if (Array.isArray(body.customer_ids)) ids = body.customer_ids.slice(0, 25);
    else if (body.consultant_id && (body.scope === "stale_24h" || body.scope === "all_unclassified")) {
      const { data } = await sb
        .from("customers")
        .select("id, lead_insights(classified_at, needs_reclassify)")
        .eq("consultant_id", body.consultant_id)
        .neq("customer_origin", "igreen_sync")
        .limit(1000);
      const cutoff = Date.now() - 24 * 3600 * 1000;
      const onlyUnclassified = body.scope === "all_unclassified";
      ids = (data ?? [])
        .filter((c: any) => {
          const li = c.lead_insights;
          if (!li || (Array.isArray(li) && li.length === 0)) return true;
          const row = Array.isArray(li) ? li[0] : li;
          if (!row.classified_at) return true;
          if (onlyUnclassified) return false;
          if (row.needs_reclassify) return true;
          return new Date(row.classified_at).getTime() < cutoff;
        })
        .map((c: any) => c.id)
        .slice(0, 25);
    }

    if (ids.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "no targets" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    for (const id of ids) {
      try {
        results.push(await classifyOne(sb, id));
      } catch (e) {
        results.push({ customer_id: id, error: (e as Error).message });
        if ((e as Error).message === "rate_limited" || (e as Error).message === "no_credits") break;
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classifier error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
