import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveWorker } from "../_shared/portal-worker.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { assertOwnership, resolveCaller } from "../_shared/caller-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isWorkerTransient(status: number, body: string): boolean {
  const text = String(body || "").trim().toLowerCase();
  if (
    /c[oó]digo inv[aá]lido ou expirado/.test(text) ||
    /otp_invalid_or_expired/.test(text) ||
    /otp.*expir/.test(text) ||
    /code.*expired/.test(text)
  ) {
    return false;
  }
  if (text.startsWith("<!doctype") || text.startsWith("<html")) return true;
  if (!text && (status === 502 || status === 503 || status === 504)) return true;
  return status === 503 || status === 504;
}

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

    // ─── AUTH ────────────────────────────────────────────────────────────
    // Chamadores legítimos: whapi-webhook / evolution-webhook (Bearer
    // SERVICE_ROLE_KEY) ou header x-service-secret. Painel admin/consultor
    // dono também pode reenviar o OTP manualmente.
    if (!isServiceRoleAuth(req)) {
      const caller = await resolveCaller(req, supabase as any);
      if (caller instanceof Response) return caller;
      if (caller.mode === "jwt") {
        const deny = await assertOwnership(
          caller,
          { customerId: String(customer_id || "") },
          supabase,
        );
        if (deny) return deny;
      }
    }

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
        id, portal2_idcliente, portal_idconsultor_override,
        consultants:consultant_id(igreen_id),
        referral_partners:referral_partner_id(cli, partner_igreen_id)
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

    const cust = customer as any;
    const overrideRaw = Number(cust?.portal_idconsultor_override || 0);
    const overrideId = Number.isFinite(overrideRaw) && overrideRaw > 0 ? overrideRaw : 0;
    const donoIgreenId = cust?.consultants?.igreen_id
      ? Number(cust.consultants.igreen_id) : null;
    const partnerIgreenId = cust?.referral_partners?.partner_igreen_id
      ? Number(cust.referral_partners.partner_igreen_id) : 0;
    const partnerCli = cust?.referral_partners?.cli
      ? Number(cust.referral_partners.cli) : 0;
    const partnerAsConsultant =
      (Number.isFinite(partnerIgreenId) && partnerIgreenId > 0)
        ? partnerIgreenId
        : (Number.isFinite(partnerCli) && partnerCli > 0 ? partnerCli : 0);
    const idconsultor = overrideId > 0
      ? overrideId
      : (partnerAsConsultant > 0 ? partnerAsConsultant : donoIgreenId);
    const idcliente = cust?.portal2_idcliente ? Number(cust.portal2_idcliente) : null;

    const resolved = await resolveWorker(supabase, customer_id).catch(() => null);
    const portalWorkerUrl = (resolved?.url || Deno.env.get("PORTAL2_WORKER_URL") || "").replace(/\/$/, "");
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
      } else if (isWorkerTransient(res.status, data)) {
        await supabase.from("customers").update({
          last_otp_dispatch_at: new Date().toISOString(),
          last_otp_dispatch_error: `worker_transient HTTP ${res.status}: ${data.slice(0, 200)}`,
        }).eq("id", customer_id);
        return new Response(JSON.stringify({
          success: true,
          mode: "polling",
          error_kind: "worker_transient",
          message: "OTP salvo. Worker instável, watchdog tentará novamente.",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        // Bug pré-existente: `errorKind` não existia neste escopo e estourava
        // ReferenceError, derrubando a marcação de OTP inválido. Agora lemos o
        // `error_kind` do corpo do worker (quando for JSON).
        let errorKind = "";
        try {
          errorKind = String(JSON.parse(data)?.error_kind || "");
        } catch { /* corpo não-JSON: cai no regex abaixo */ }
        const isBadOtp = errorKind === "otp_invalid_or_expired"
          || /c[oó]digo inv[aá]lido ou expirado/i.test(data);
        if (isBadOtp) {
          const { markOtpNeedsConfirm } = await import("../_shared/otp-confirm-flow.ts");
          await markOtpNeedsConfirm(supabase, customer_id, String(otp_code), data.slice(0, 200));
        } else {
          await supabase.from("customers").update({
            last_otp_dispatch_at: new Date().toISOString(),
            last_otp_dispatch_error: `HTTP ${res.status}: ${data.slice(0, 200)}`,
          }).eq("id", customer_id);
        }
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
