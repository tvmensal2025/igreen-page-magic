import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createEvolutionSender } from "../_shared/evolution-api.ts";
import { captureError } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * worker-callback: Endpoint chamado pelo Worker da VPS para notificar eventos.
 *
 * Actions:
 *  - otp_required:        Portal pediu OTP → muda step para aguardando_otp
 *  - signing_ready:       Link de validação facial pronto → envia ao cliente
 *  - registration_complete: Cadastro finalizado no portal
 *  - error:               Falha na automação
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Autenticar via Bearer token
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");

    const { data: settingsRows } = await supabase.from("settings").select("*");
    const settings: Record<string, string> = {};
    settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });

    const workerSecret = settings.worker_secret || Deno.env.get("WORKER_SECRET") || "";
    if (!workerSecret || token !== workerSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { action, customer_id, signing_url, error_message } = body;

    if (!customer_id) {
      return new Response(JSON.stringify({ error: "customer_id obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`🔔 worker-callback: action=${action} customer=${customer_id}`);

    // Buscar cliente + consultor
    const { data: customer, error: fetchErr } = await supabase
      .from("customers")
      .select("id, phone_whatsapp, name, status, conversation_step, consultant_id")
      .eq("id", customer_id)
      .single();

    if (fetchErr || !customer) {
      return new Response(JSON.stringify({ error: "Cliente não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Montar sender Evolution API (preferido) com fallback para Whapi
    const evolutionUrl = (settings.evolution_api_url || Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/$/, "");
    const evolutionKey = settings.evolution_api_key || Deno.env.get("EVOLUTION_API_KEY") || "";

    let instanceName: string | null = null;
    if (customer.consultant_id) {
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("consultant_id", customer.consultant_id)
        .limit(1)
        .single();
      instanceName = inst?.instance_name || null;
    }

    let phone = String(customer.phone_whatsapp || "").replace(/\D/g, "");
    if (!phone.startsWith("55")) phone = "55" + phone;
    const remoteJid = `${phone}@s.whatsapp.net`;

    async function sendWhatsApp(message: string) {
      // Tentar Evolution API primeiro
      if (evolutionUrl && evolutionKey && instanceName) {
        const _raw = createEvolutionSender(evolutionUrl, evolutionKey, instanceName);
        const { wrapSenderWithGuard } = await import("../_shared/sender-guard.ts");
        const { sendText } = wrapSenderWithGuard(_raw, { supabase, instanceName });
        const ok = await sendText(remoteJid, message);
        if (ok) return;
      }
      // Fallback: Whapi
      const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
      const whapiUrl = (settings.whapi_api_url || Deno.env.get("WHAPI_API_URL") || "https://gate.whapi.cloud").replace(/\/$/, "") + "/";
      if (!whapiToken) { console.error("❌ Nenhum canal de envio configurado"); return; }
      try {
        await fetch(`${whapiUrl}messages/text`, {
          method: "POST",
          headers: { Authorization: `Bearer ${whapiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ to: remoteJid, body: message, typing_time: 0 }),
        });
      } catch (e: any) {
        console.error("❌ Erro enviar WhatsApp:", e.message);
      }
    }

    const updates: Record<string, any> = {};

    switch (action) {
      case "otp_required": {
        updates.status = "awaiting_otp";
        updates.conversation_step = "aguardando_otp";
        await supabase.from("customers").update(updates).eq("id", customer_id);
        await sendWhatsApp(
          "📱 *Código de verificação necessário!*\n\n" +
          "Você vai receber um código no seu *WhatsApp*.\n\n" +
          "Quando receber, *digite o código aqui* para continuarmos o cadastro."
        );
        break;
      }

      case "signing_ready": {
        if (!signing_url) {
          return new Response(JSON.stringify({ error: "signing_url obrigatório" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        updates.status = "awaiting_signature";
        updates.conversation_step = "aguardando_assinatura";
        updates.link_assinatura = signing_url;
        await supabase.from("customers").update(updates).eq("id", customer_id);
        await sendWhatsApp(
          "✅ *Cadastro quase finalizado!*\n\n" +
          "🔗 Falta apenas a *validação facial*.\n\n" +
          `Clique no link abaixo e siga as instruções:\n${signing_url}\n\n` +
          "📸 Será necessário tirar uma selfie.\n\n" +
          "Se tiver dúvidas, responda aqui!"
        );
        break;
      }

      case "registration_complete": {
        updates.status = "registered_igreen";
        updates.conversation_step = "cadastro_em_analise";
        if (body.igreen_code) updates.igreen_code = body.igreen_code;
        if (body.igreen_link) updates.igreen_link = body.igreen_link;
        // Se ainda estava em captação manual, encerra automaticamente pra sumir da fila.
        updates.capture_closed_at = new Date().toISOString();
        await supabase.from("customers").update(updates).eq("id", customer_id);
        await sendWhatsApp(
          "🎉 *Parabéns! Seu cadastro na iGreen Energy foi concluído!*\n\n" +
          "☀️ Em breve você começará a economizar na sua conta de luz.\n\n" +
          "Um consultor entrará em contato com mais detalhes. Obrigado!"
        );
        break;
      }

      case "error": {
        // F05: não sobrescrever handoff Portal2 (needs_human / ia_reprovada) com automation_failed
        const { data: cur } = await supabase
          .from("customers")
          .select("status, portal2_status, portal2_error_kind, bot_paused, bot_paused_reason")
          .eq("id", customer_id)
          .maybeSingle();
        const portalHuman =
          cur?.portal2_status === "needs_human" ||
          cur?.portal2_error_kind === "ia_reprovada" ||
          cur?.status === "needs_human";
        if (portalHuman) {
          updates.status = "needs_human";
          updates.conversation_step = "aguardando_humano";
          updates.bot_paused = true;
          updates.bot_paused_reason = cur?.bot_paused_reason || "portal_ia_reprovada";
          // F05: nunca regravar lixo legado Playwright (fase1-cep) no error_message
          if (error_message) {
            const msg = String(error_message);
            if (!/fase1[-_]?cep/i.test(msg)) {
              updates.error_message = msg.slice(0, 500);
            }
          }
        } else {
          updates.status = "automation_failed";
          updates.error_message = error_message || "Erro desconhecido na automação";
        }
        await supabase.from("customers").update(updates).eq("id", customer_id);
        await sendWhatsApp(
          portalHuman
            ? "Recebi seus dados ✅\n\nA validação pediu uma revisão humana antes de concluir. Um consultor vai te chamar por aqui em breve 👍"
            : "⚠️ Tivemos um problema técnico ao processar seu cadastro.\n\n" +
              "Não se preocupe! Um consultor vai entrar em contato para concluir manualmente.\n\n" +
              "Obrigado pela paciência! 🙏"
        );
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Action desconhecida: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ success: true, action, customer_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("❌ worker-callback erro:", e.message || e);
    captureError(e, { tags: { function: "worker-callback" } });
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
