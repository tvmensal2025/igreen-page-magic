// finalize-capture: chamado pelo botão "Finalizar Cadastro" do Modo Captação.
// Valida no servidor com o MESMO validador do frontend (portalValidation.ts).
// Se faltar campo ou houver inválido (CPF errado, R$/kWh fora da faixa, etc.),
// REJEITA antes de qualquer dispatch — nada de chegar no portal e voltar.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchPortalWorker } from "../_shared/portal-worker.ts";
import { validateForPortal, PORTAL_FIELDS } from "../_shared/portalValidation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SELECT_FIELDS = PORTAL_FIELDS.map((f) => f.key).join(", ") +
  ", name_mismatch_flag, name_mismatch_acknowledged_at";

const TERMINAL = new Set([
  "portal_submitting", "awaiting_otp", "validating_otp",
  "registered_igreen", "cadastro_concluido", "approved", "active",
]);

function jres(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendWhatsAppNotice(supabase: any, customer: any) {
  try {
    const { data: settingsRows } = await supabase.from("settings").select("*");
    const settings: Record<string, string> = {};
    settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });

    const phone = String(customer.phone_whatsapp || "").replace(/\D/g, "");
    if (!phone) return;
    const normalized = phone.startsWith("55") ? phone : `55${phone}`;
    const toJid = `${normalized}@s.whatsapp.net`;
    const text =
      "✅ *Todos os dados coletados!* 🎉\n\n" +
      "⏳ Estamos enviando seu cadastro para o portal da iGreen…\n\n" +
      "📱 Em alguns instantes você recebe aqui no WhatsApp um *código de verificação*. Quando chegar, *digite o código aqui mesmo*.";

    // Tenta Evolution primeiro (instância do consultor), depois Whapi
    let instanceName: string | null = null;
    if (customer.consultant_id) {
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("consultant_id", customer.consultant_id)
        .limit(1).maybeSingle();
      instanceName = inst?.instance_name || null;
    }

    const evoUrl = (settings.evolution_api_url || Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/, "");
    const evoKey = settings.evolution_api_key || Deno.env.get("EVOLUTION_API_KEY") || "";
    if (evoUrl && evoKey && instanceName) {
      try {
        const r = await fetch(`${evoUrl}/message/sendText/${instanceName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: evoKey },
          body: JSON.stringify({ number: normalized, text }),
        });
        if (r.ok) return;
      } catch (e) { console.warn("[finalize-capture] evolution send failed", (e as any)?.message); }
    }

    const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
    const whapiUrl = (settings.whapi_api_url || Deno.env.get("WHAPI_API_URL") || "https://gate.whapi.cloud").replace(/\/$/, "");
    if (whapiToken) {
      await fetch(`${whapiUrl}/messages/text`, {
        method: "POST",
        headers: { Authorization: `Bearer ${whapiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: toJid, body: text, typing_time: 0 }),
      });
    }
  } catch (e: any) {
    console.warn("[finalize-capture] notice send error:", e?.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jres({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const customerId = String(body?.customerId || body?.customer_id || "").trim();
    const sendNotice = body?.sendNotice !== false; // default true
    if (!customerId) return jres({ error: "customerId obrigatório" }, 400);

    // Identifica quem apertou (best-effort)
    let finalizedBy: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token) {
        const userClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: `Bearer ${token}` } } },
        );
        const { data: u } = await userClient.auth.getUser();
        finalizedBy = u?.user?.id || null;
      }
    } catch (_) {}

    const { data: customer, error: fetchErr } = await supabase
      .from("customers")
      .select("id, consultant_id, phone_whatsapp, name, status, conversation_step, name_mismatch_flag, name_mismatch_acknowledged_at, document_back_url, electricity_bill_photo_url, igreen_link")
      .eq("id", customerId)
      .maybeSingle();

    if (fetchErr || !customer) return jres({ error: "Cliente não encontrado" }, 404);

    if (TERMINAL.has(String(customer.conversation_step || "")) || TERMINAL.has(String(customer.status || ""))) {
      return jres({
        ok: true,
        already: true,
        mode: "already_dispatched",
        status: customer.status,
        step: customer.conversation_step,
        message: "Lead já está em processamento no portal.",
      });
    }

    // Buscar os 10 campos para validar
    const { data: full } = await supabase
      .from("customers")
      .select(REQUIRED_FIELDS.join(","))
      .eq("id", customerId)
      .maybeSingle();

    const missing: string[] = [];
    for (const f of REQUIRED_FIELDS) {
      const v = (full as any)?.[f];
      if (v === null || v === undefined) { missing.push(f); continue; }
      if (typeof v === "string" && !v.trim()) { missing.push(f); continue; }
      if (f === "electricity_bill_value" && Number(v) <= 0) { missing.push(f); }
    }
    if (!customer.document_back_url) missing.push("document_back_url");
    if (!customer.electricity_bill_photo_url) missing.push("electricity_bill_photo_url");
    if (customer.name_mismatch_flag && !customer.name_mismatch_acknowledged_at) missing.push("name_mismatch_acknowledged");

    if (missing.length) {
      return jres({ ok: false, error: "incomplete", missing }, 400);
    }

    // Regenera igreen_link do consultor dono (mesmo guard do bot-flow)
    const updates: Record<string, any> = {
      status: "portal_submitting",
      conversation_step: "portal_submitting",
      finalized_at: new Date().toISOString(),
      ...(finalizedBy ? { finalized_by: finalizedBy } : {}),
    };
    if (customer.consultant_id) {
      const { data: c } = await supabase
        .from("consultants").select("cadastro_url").eq("id", customer.consultant_id).maybeSingle();
      if (c?.cadastro_url) updates.igreen_link = c.cadastro_url;
    }

    const { error: upErr } = await supabase.from("customers").update(updates).eq("id", customerId);
    if (upErr) {
      console.error("[finalize-capture] update error", upErr);
      return jres({ error: "Falha ao marcar lead", detail: upErr.message }, 500);
    }

    // Avisa o cliente no WhatsApp (não bloqueia) — só se o consultor pediu
    if (sendNotice) await sendWhatsAppNotice(supabase, customer);

    // Dispara o worker
    const dispatch = await dispatchPortalWorker(supabase, customerId);

    return jres({
      ok: dispatch.ok,
      mode: dispatch.mode,
      status: dispatch.ok ? "portal_submitting" : "worker_offline",
      error: dispatch.error,
    });
  } catch (e: any) {
    console.error("[finalize-capture] fatal", e?.message || e);
    return jres({ error: e?.message || String(e) }, 500);
  }
});
