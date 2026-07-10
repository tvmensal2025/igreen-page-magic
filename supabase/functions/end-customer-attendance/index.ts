// end-customer-attendance
// Botão "Finalizar atendimento" do consultor. Envia encerramento + pesquisa 1–5.
// Idempotente: se já pediu avaliação ou já tem nota, retorna 200 sem reenviar.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendAttendanceRatingRequest } from "../_shared/attendance-flow.ts";
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
    const result = await sendAttendanceRatingRequest(supabase, {
      customerId,
      consultantId,
      env: channelEnv,
      superadminConsultantId: channelEnv.superadminConsultantId,
    });

    if (!result.ok) {
      return json({
        ok: false,
        error: result.code,
        detail: result.detail,
        fallback: true,
        message: "Não foi possível enviar a pesquisa automaticamente. Envie manualmente pelo chat.",
      }, 200);
    }

    return json({
      ok: true,
      skipped: result.skipped,
    });
  } catch (e) {
    return json({ ok: false, error: "exception", message: (e as Error).message, fallback: true }, 200);
  }
});
