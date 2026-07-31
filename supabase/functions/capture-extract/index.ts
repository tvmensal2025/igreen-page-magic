// capture-extract: IA sugere preenchimento de campos da Ficha (Modo Captação)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveCaller, assertOwnership } from "../_shared/caller-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const FIELDS = [
  "name", "cpf", "rg", "data_nascimento",
  "phone_landline", "email", "cep",
  "address_number", "electricity_bill_value",
] as const;

function isEmpty(v: any, key: string) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && !v.trim()) return true;
  if (key === "electricity_bill_value" && Number(v) <= 0) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // Client service_role (bypass RLS) — usado também como `admin` na guarda de autorização.
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Parse do corpo uma única vez; reutilizado pela guarda e pelo fluxo abaixo.
    const body = await req.json();
    const { customer_id, source_message_id } = body ?? {};

    // ─── Guarda de autenticação/posse (IDOR) — ANTES de qualquer efeito colateral ───
    const caller = await resolveCaller(req, sb);
    if (caller instanceof Response) return caller; // 401
    if (!customer_id) {
      return new Response(JSON.stringify({ error: "customer_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const deny = await assertOwnership(caller, { customerId: customer_id }, sb);
    if (deny) return deny; // 400/403

    const { data: customer } = await sb.from("customers")
      .select("id, consultant_id, capture_mode, name, cpf, rg, data_nascimento, phone_landline, email, cep, address_number, electricity_bill_value")
      .eq("id", customer_id).maybeSingle();

    if (!customer) return new Response(JSON.stringify({ error: "customer not found" }), { status: 404, headers: corsHeaders });
    if (customer.capture_mode !== "manual") {
      return new Response(JSON.stringify({ skipped: "not_manual_mode" }), { headers: corsHeaders });
    }

    const missing = FIELDS.filter((k) => isEmpty((customer as any)[k], k));
    if (missing.length === 0) {
      return new Response(JSON.stringify({ skipped: "all_filled" }), { headers: corsHeaders });
    }

    const { data: msgs } = await sb.from("conversations")
      .select("message_direction, message_text, created_at")
      .eq("customer_id", customer_id)
      .order("created_at", { ascending: false })
      .limit(8);

    const transcript = (msgs || []).reverse()
      .filter((m) => m.message_text && !m.message_text.startsWith("["))
      .map((m) => `${m.message_direction === "inbound" ? "Cliente" : "Consultor"}: ${m.message_text}`)
      .join("\n");

    if (!transcript.trim()) {
      return new Response(JSON.stringify({ skipped: "no_text" }), { headers: corsHeaders });
    }

    const sys = `Você extrai dados cadastrais de uma conversa de WhatsApp em PT-BR.
Retorne APENAS um JSON válido com os campos que conseguir extrair com alta confiança.
Campos faltantes: ${missing.join(", ")}.
Formatos:
- cpf/rg: apenas dígitos
- data_nascimento: YYYY-MM-DD
- cep: 8 dígitos
- phone_landline: dígitos com DDD
- electricity_bill_value: número decimal em reais
- email: minúsculas
NÃO invente. Se não tiver certeza, omita o campo.
Inclua sempre "confidence": { campo: 0..1 }`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Conversa:\n${transcript}\n\nExtraia os campos disponíveis em JSON.` },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      console.warn("[capture-extract] AI error", aiRes.status, await aiRes.text());
      return new Response(JSON.stringify({ skipped: `ai_${aiRes.status}` }), { headers: corsHeaders });
    }

    const aiJson = await aiRes.json();
    let extracted: any = {};
    try {
      extracted = JSON.parse(aiJson.choices?.[0]?.message?.content || "{}");
    } catch (e) {
      console.warn("[capture-extract] parse fail", e);
      return new Response(JSON.stringify({ skipped: "parse" }), { headers: corsHeaders });
    }

    const conf = extracted.confidence || {};
    const autoApplied: string[] = [];
    const suggested: string[] = [];
    const directUpdate: Record<string, any> = {};

    for (const field of missing) {
      const value = extracted[field];
      if (value === undefined || value === null || value === "") continue;
      const c = Number(conf[field] ?? 0.7);
      if (c < 0.6) continue;

      // Normalização leve
      let normalized: any = value;
      if (field === "cpf" || field === "rg" || field === "cep" || field === "phone_landline") {
        normalized = String(value).replace(/\D/g, "");
      } else if (field === "email") {
        normalized = String(value).trim().toLowerCase();
      } else if (field === "electricity_bill_value") {
        const n = Number(String(value).replace(",", "."));
        if (!Number.isFinite(n) || n <= 0) continue;
        normalized = n;
      } else {
        normalized = String(value).trim();
      }

      // IA confiante (>=0.85): grava direto em customers, sem pedir confirmação ao cliente.
      if (c >= 0.85) {
        directUpdate[field] = normalized;
        autoApplied.push(field);
        continue;
      }

      // Confiança média: vai pra fila de sugestões para o consultor revisar.
      const { data: existing } = await sb.from("capture_field_suggestions")
        .select("id").eq("customer_id", customer_id).eq("field_name", field).eq("status", "pending").maybeSingle();
      if (existing) continue;

      await sb.from("capture_field_suggestions").insert({
        customer_id,
        consultant_id: customer.consultant_id,
        field_name: field,
        suggested_value: String(normalized),
        confidence: Math.min(1, Math.max(0, c)),
        source_message_id: source_message_id || null,
      });
      suggested.push(field);
    }

    if (Object.keys(directUpdate).length > 0) {
      const { error: upErr } = await sb.from("customers").update(directUpdate).eq("id", customer_id);
      if (upErr) {
        console.warn("[capture-extract] direct update fail", upErr.message);
      } else {
        // Trilha auditável: auto-apply também grava suggestion com status accepted.
        const nowIso = new Date().toISOString();
        const trailRows = autoApplied.map((field) => ({
          customer_id,
          consultant_id: customer.consultant_id,
          field_name: field,
          suggested_value: String(directUpdate[field]),
          confidence: Math.min(1, Math.max(0, Number(conf[field] ?? 0.85))),
          source_message_id: source_message_id || null,
          status: "accepted",
          resolved_at: nowIso,
        }));
        const { error: trailErr } = await sb.from("capture_field_suggestions").insert(trailRows);
        if (trailErr) {
          console.warn("[capture-extract] audit trail fail", trailErr.message);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, auto_applied: autoApplied, suggested }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[capture-extract] fatal", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
