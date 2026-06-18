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

    // Salvar OTP no banco
    const { error: updateErr } = await supabase.from("customers").update({
      otp_code,
      otp_received_at: new Date().toISOString(),
      conversation_step: "validando_otp",
      status: "validating_otp",
      // Conclusão do fluxo: cancela qualquer follow-up agendado. Sem isso, um
      // agendamento órfão ("me chama amanhã") feito antes da conclusão dispararia
      // o process-followups depois que o cliente já entrou no portal.
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

    // Ler configurações para URL do worker
    const { data: settingsRows } = await supabase.from("settings").select("*");
    const settings: Record<string, string> = {};
    settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });

    // Resolve o worker pelo portal_kind do consultor (Portal 2 = autoconexao).
    // Fallback defensivo: se a resolução falhar, mantém o comportamento antigo (Portal 1).
    const resolved = await resolveWorker(supabase, customer_id).catch(() => null);
    const portalWorkerUrl = (resolved?.url || settings.portal_worker_url || Deno.env.get("PORTAL_WORKER_URL") || "").replace(/\/$/, "");
    const workerSecret = resolved?.secret || settings.worker_secret || Deno.env.get("WORKER_SECRET") || "";

    if (!portalWorkerUrl || !workerSecret) {
      console.warn("⚠️ Worker URL ou Secret não configurados. OTP salvo, worker precisa fazer polling.");
      return new Response(JSON.stringify({ success: true, mode: "polling", message: "OTP salvo. Worker fará polling." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enviar OTP ao worker (confirm-otp endpoint)
    try {
      const res = await fetch(`${portalWorkerUrl}/confirm-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${workerSecret}`,
        },
        body: JSON.stringify({ customer_id, otp_code }),
        signal: AbortSignal.timeout(45_000),
      });

      const data = await res.text();
      console.log(`📡 Worker confirm-otp resposta (${res.status}): ${data.substring(0, 300)}`);

      return new Response(data, {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: any) {
      console.error("⚠️ Erro ao enviar OTP ao worker:", e.message);
      return new Response(JSON.stringify({
        success: true,
        mode: "polling",
        message: "OTP salvo. Erro ao notificar worker, mas fará polling.",
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
