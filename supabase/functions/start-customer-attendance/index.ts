// start-customer-attendance
// Botão "Iniciar atendimento" do consultor. Envia os 2 balões de abertura
// (saudação + Atendimento iniciado + protocolo + pedido de nome) ao lead.
// Idempotente: se `customers.welcome_sent_at` já existir, retorna 200 sem reenviar.
//
// Canal: Super Admin → Whapi (settings.whapi_token); demais → Evolution.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendWelcomeHeader } from "../_shared/welcome-header.ts";
import { loadChannelEnv } from "../_shared/attendance-channel-env.ts";

interface Body { customerId: string; consultantId: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Partial<Body>;
    const customerId = String(body.customerId || "").trim();
    const consultantId = String(body.consultantId || "").trim();
    if (!customerId || !consultantId) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const { data: customer, error } = await supabase
      .from("customers")
      .select("id, consultant_id")
      .eq("id", customerId)
      .maybeSingle();
    if (error || !customer) return json({ ok: false, error: "customer_not_found" }, 404);
    if (customer.consultant_id && customer.consultant_id !== consultantId) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    const channelEnv = await loadChannelEnv(supabase);
    const result = await sendWelcomeHeader(supabase, {
      customerId,
      consultantId,
      env: channelEnv,
      superadminConsultantId: channelEnv.superadminConsultantId,
    });

    if (!result.ok) {
      // NUNCA 5xx para falha de envio — frontend trata como crash ("non-2xx").
      const soft = [
        "send_failed_greeting",
        "send_failed_protocol",
        "channel_unavailable",
        "rate_limited",
        "no_phone",
        "protocol_generation_failed",
      ];
      if (soft.includes(String(result.code))) {
        return json({
          ok: false,
          error: result.code,
          detail: result.detail,
          fallback: true,
          message: result.code === "channel_unavailable"
            ? "Canal WhatsApp indisponível. Verifique Whapi (super admin) ou Evolution (consultor)."
            : "Não foi possível enviar automaticamente. Envie a saudação manualmente pelo chat.",
        }, 200);
      }
      return json({ ok: false, error: result.code, detail: result.detail }, 200);
    }

    return json({
      ok: true,
      protocol: result.protocol,
      channel: result.channel,
      instance: result.instance,
      skipped: result.skipped,
    });
  } catch (e) {
    // Mesmo em exception, 200 com ok:false — evita toast genérico "non-2xx"
    return json({ ok: false, error: "exception", message: (e as Error).message, fallback: true }, 200);
  }
});
