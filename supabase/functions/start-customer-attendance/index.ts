// start-customer-attendance
// Botão "Iniciar atendimento" do consultor. Envia os 2 balões de abertura
// (saudação + protocolo + pedido de nome) ao lead. Idempotente:
// se `customers.welcome_sent_at` já existir, retorna 200 sem reenviar.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendWelcomeHeader } from "../_shared/welcome-header.ts";

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

    const env = {
      evolutionUrl: Deno.env.get("EVOLUTION_API_URL"),
      evolutionKey: Deno.env.get("EVOLUTION_API_KEY"),
      whapiToken: Deno.env.get("WHAPI_TOKEN") || "",
    };

    const result = await sendWelcomeHeader(supabase, { customerId, consultantId, env });
    if (!result.ok) {
      const status = result.code === "channel_unavailable"
        ? 409
        : result.code === "no_phone"
        ? 400
        : 502;
      return json({ ok: false, error: result.code, detail: result.detail }, status);
    }
    return json({
      ok: true,
      protocol: result.protocol,
      channel: result.channel,
      instance: result.instance,
      skipped: result.skipped,
    });
  } catch (e) {
    return json({ ok: false, error: "exception", message: (e as Error).message }, 500);
  }
});
