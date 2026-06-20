import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveWorker } from "../_shared/portal-worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * submit-otp: Recebe OTP do webhook e repassa ao Worker da VPS.
 *
 * Body: { customer_id, otp_code }
 * O worker vai inserir o código no portal iGreen e retornar o resultado.
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

    const body = await req.json().catch(() => ({}));
    const { customer_id, otp_code } = body;

    if (!customer_id || !otp_code) {
      return new Response(JSON.stringify({ error: "customer_id e otp_code são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`🔐 submit-otp: customer=${customer_id}, code=${otp_code}`);

    // Carrega dados para montar payload correto do worker-portal-2.
    const { data: customer } = await supabase
      .from("customers")
      .select(`
        id, portal2_idcliente,
        consultants:consultant_id(igreen_id),
        referral_partners:referral_partner_id(partner_igreen_id)
      `)
      .eq("id", customer_id)
      .maybeSingle();

    // Salvar OTP no banco
    const { error: updateErr } = await supabase.from("customers").update({
      otp_code,
      otp_received_at: new Date().toISOString(),
      conversation_step: "validando_otp",
      status: "validating_otp",
      next_followup_at: null,
      followup_hook: null,
    }).eq("id", customer_id);

    if (updateErr) {
      console.error("❌ Erro ao salvar OTP:", updateErr);
      return new Response(JSON.stringify({ error: "Erro ao salvar OTP" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const donoIgreenId = (customer as any)?.consultants?.igreen_id
      ? Number((customer as any).consultants.igreen_id) : null;
    const partnerIgreenId = (customer as any)?.referral_partners?.partner_igreen_id
      ? Number((customer as any).referral_partners.partner_igreen_id) : null;
    const idconsultor = Number.isFinite(partnerIgreenId as number) && (partnerIgreenId as number) > 0
      ? (partnerIgreenId as number) : donoIgreenId;
    const idcliente = (customer as any)?.portal2_idcliente ? Number((customer as any).portal2_idcliente) : null;

    const resolved = await resolveWorker(supabase, customer_id).catch(() => null);
    const portalWorkerUrl = (resolved?.url || Deno.env.get("PORTAL2_WORKER_URL") || Deno.env.get("PORTAL_WORKER_URL") || "").replace(/\/$/, "");
    const workerSecret = resolved?.secret || Deno.env.get("PORTAL2_WORKER_SECRET") || Deno.env.get("WORKER_SECRET") || "";

    if (!portalWorkerUrl || !workerSecret) {
      console.warn("⚠️ Worker URL ou Secret não configurados. OTP salvo, watchdog reenviará.");
      return new Response(JSON.stringify({ success: true, mode: "polling", message: "OTP salvo." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!idconsultor || !idcliente) {
      console.warn(`⚠️ submit-otp customer=${customer_id} sem idconsultor/idcliente — watchdog reenviará`);
      await supabase.from("customers").update({
        last_otp_dispatch_at: new Date().toISOString(),
        last_otp_dispatch_error: !idcliente ? "missing_portal2_idcliente" : "missing_idconsultor",
      }).eq("id", customer_id);
      return new Response(JSON.stringify({ success: true, mode: "polling", message: "OTP salvo, aguarda watchdog." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const res = await fetch(`${portalWorkerUrl}/confirm-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ idconsultor, idcliente, code: otp_code, customer_id }),
        signal: AbortSignal.timeout(45_000),
      });

      const data = await res.text();
      console.log(`📡 Worker confirm-otp resposta (${res.status}): ${data.substring(0, 300)}`);
      if (res.ok) {
        await supabase.from("customers").update({
          last_otp_dispatch_at: new Date().toISOString(),
          last_otp_dispatch_error: null,
          portal_retry_count: 0,
        }).eq("id", customer_id);
      } else {
        await supabase.from("customers").update({
          last_otp_dispatch_at: new Date().toISOString(),
          last_otp_dispatch_error: `HTTP ${res.status}: ${data.slice(0, 200)}`,
        }).eq("id", customer_id);
      }

      return new Response(data, {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: any) {
      console.error("⚠️ Erro ao enviar OTP ao worker:", e.message);
      await supabase.from("customers").update({
        last_otp_dispatch_at: new Date().toISOString(),
        last_otp_dispatch_error: (e?.message || String(e)).slice(0, 200),
      }).eq("id", customer_id);
      return new Response(JSON.stringify({
        success: true,
        mode: "polling",
        message: "OTP salvo. Erro ao notificar worker, watchdog tentará novamente.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e: any) {
    console.error("❌ submit-otp erro:", e.message || e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
