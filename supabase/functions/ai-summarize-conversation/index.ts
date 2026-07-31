// Gera/atualiza um resumo curto da conversa do lead.
// Chamada em background pelo ai-sales-agent quando histórico cresce.
// Usa modelo barato (flash-lite) e grava em customers.conversation_summary.
//
// Auth: service_role / x-service-secret / JWT dono do lead (ou admin).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { aiChat } from "../_shared/ai-gateway.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { resolveCaller, assertOwnership } from "../_shared/caller-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Auth antes de qualquer validação/efeito (fail-closed).
    let caller: Awaited<ReturnType<typeof resolveCaller>> | null = null;
    if (!isServiceRoleAuth(req)) {
      caller = await resolveCaller(req, supabase as any);
      if (caller instanceof Response) return caller;
    }

    const { customer_id } = await req.json();
    if (!customer_id) {
      return new Response(JSON.stringify({ error: "customer_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (caller && !(caller instanceof Response)) {
      const deny = await assertOwnership(caller, { customerId: String(customer_id) }, supabase as any);
      if (deny) return deny;
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("id, consultant_id, name, distribuidora, electricity_bill_value, sales_phase, conversation_summary")
      .eq("id", customer_id)
      .maybeSingle();
    if (!customer) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: history } = await supabase
      .from("conversations")
      .select("message_direction, message_text, message_type, created_at")
      .eq("customer_id", customer_id)
      .order("created_at", { ascending: false })
      .limit(80);

    const recent = (history || []).reverse();
    if (recent.length < 6) {
      return new Response(JSON.stringify({ skipped: "too_few_messages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transcript = recent.map((m: any) =>
      `${m.message_direction === "inbound" ? "Lead" : "IA"} (${m.message_type || "text"}): ${(m.message_text || "(mídia)").slice(0, 200)}`
    ).join("\n");

    const prompt = `Resuma em até 6 linhas em PT-BR a conversa abaixo entre uma vendedora (IA) e um lead da iGreen Energy. Inclua: estágio atual, dados que já sabemos do lead (nome, valor da conta, distribuidora se mencionados), objeções levantadas, mídias enviadas, e qual seria o próximo passo natural. Nada de bullets — texto corrido, conciso.\n\nResumo anterior (se houver, atualize-o): ${customer.conversation_summary || "(nenhum)"}\n\nConversa recente:\n${transcript}`;

    const result = await aiChat({
      model: "google/gemini-3-flash-preview",
      temperature: 0.3,
      maxTokens: 350,
      messages: [{ role: "user", content: prompt }],
    });

    const summary = (result.text || "").trim().slice(0, 1500);
    if (summary) {
      await supabase.from("customers").update({
        conversation_summary: summary,
        summary_updated_at: new Date().toISOString(),
      }).eq("id", customer_id);
    }

    return new Response(JSON.stringify({ ok: true, length: summary.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-summarize error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
