// Extrai fatos persistentes da conversa e faz upsert em customer_memory.
// Chamada em background pelo ai-sales-agent (junto com summarize).
// Usa Gemini Flash-Lite com schema JSON estruturado (function calling).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { aiChat } from "../_shared/ai-gateway.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { resolveCaller, assertOwnership } from "../_shared/caller-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VALID_CATEGORIES = [
  "preferencia",     // melhor horário, canal preferido
  "objecao",         // motivos de recusa, dúvidas recorrentes
  "dado_pessoal",    // nome cônjuge, filhos, profissão
  "contexto_familiar", // moram quantos, casa própria
  "dor",             // problema declarado (conta alta, etc.)
  "historico_compra", // compras/contratos passados, recusas anteriores
  "midia_enviada",   // vídeos/áudios já enviados — evita repetir
  "fato_relevante",  // genérico
];

const FACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      description: "Lista de fatos novos. Vazia se não houver nada novo.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: VALID_CATEGORIES },
          key: { type: "string", description: "Chave curta em snake_case" },
          value: { type: "string", description: "Valor curto e direto (max 200 chars)" },
          confidence: { type: "number" },
          source: { type: "string", enum: ["lead_disse", "ocr", "consultor", "inferido"] },
        },
        required: ["category", "key", "value", "confidence", "source"],
      },
    },
  },
  required: ["facts"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { customer_id } = await req.json();
    if (!customer_id) {
      return new Response(JSON.stringify({ error: "customer_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!isServiceRoleAuth(req)) {
      const caller = await resolveCaller(req, supabase as any);
      if (caller instanceof Response) return caller;
      const deny = await assertOwnership(caller, { customerId: String(customer_id) }, supabase as any);
      if (deny) return deny;
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("id, consultant_id, name, conversation_summary")
      .eq("id", customer_id)
      .maybeSingle();
    if (!customer?.consultant_id) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: history } = await supabase
      .from("conversations")
      .select("message_direction, message_text, message_type, created_at")
      .eq("customer_id", customer_id)
      .order("created_at", { ascending: false })
      .limit(40);

    const recent = (history || []).reverse();
    if (recent.length < 4) {
      return new Response(JSON.stringify({ skipped: "too_few_messages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Memória já existente (para não duplicar)
    const { data: existing } = await supabase
      .from("customer_memory_active")
      .select("category, key, value")
      .eq("customer_id", customer_id)
      .limit(50);
    const existingLine = (existing || []).length
      ? (existing || []).map((f: any) => `- ${f.category}/${f.key}: ${f.value}`).join("\n")
      : "(nenhum fato registrado ainda)";

    const transcript = recent.map((m: any) =>
      `${m.message_direction === "inbound" ? "Lead" : "IA"}: ${(m.message_text || "(mídia)").slice(0, 240)}`
    ).join("\n");

    const sys = `Você extrai FATOS PERSISTENTES sobre um lead da iGreen Energy a partir da conversa. Retorne SOMENTE fatos novos ou que mudaram. Ignore small talk, saudações e info já presente em [JÁ SABEMOS]. Categorias: ${VALID_CATEGORIES.join(", ")}. Use snake_case nas chaves. Confidence baixa (<0.5) para inferências; alta (>0.8) só quando o lead afirmou explicitamente. Se não houver nada novo, retorne {"facts": []}.`;

    const prompt = `[JÁ SABEMOS]\n${existingLine}\n\n[RESUMO ATUAL]\n${customer.conversation_summary || "(sem resumo)"}\n\n[CONVERSA RECENTE]\n${transcript}\n\nExtraia fatos novos.`;

    const result = await aiChat({
      model: "google/gemini-3-flash-preview",
      temperature: 0.2,
      maxTokens: 800,
      jsonSchema: { name: "extract_facts", schema: FACTS_SCHEMA },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: prompt },
      ],
    });

    const facts = (result.json?.facts || []) as any[];
    let upserted = 0;
    for (const f of facts) {
      if (!f?.category || !f?.key || !f?.value) continue;
      if (!VALID_CATEGORIES.includes(f.category)) continue;
      const value = String(f.value).slice(0, 500);
      const key = String(f.key).slice(0, 80).toLowerCase().replace(/\s+/g, "_");
      const confidence = Math.min(1, Math.max(0, Number(f.confidence) || 0.6));
      const source = ["lead_disse", "ocr", "consultor", "inferido"].includes(f.source) ? f.source : "inferido";

      // expires_at: dado_pessoal nunca expira; preferência/objeção 90 dias; resto 180
      let expiresAt: string | null = null;
      if (f.category === "preferencia" || f.category === "objecao") {
        expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
      } else if (f.category !== "dado_pessoal") {
        expiresAt = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString();
      }

      const { error } = await supabase.from("customer_memory").upsert({
        customer_id,
        consultant_id: customer.consultant_id,
        category: f.category,
        key,
        value,
        confidence,
        source,
        last_confirmed_at: new Date().toISOString(),
        expires_at: expiresAt,
        active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "customer_id,category,key" });
      if (!error) upserted++;
    }

    return new Response(JSON.stringify({ ok: true, upserted, examined: facts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-extract-memory error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
