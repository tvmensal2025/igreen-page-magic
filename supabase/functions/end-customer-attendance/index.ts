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
    let result = await sendAttendanceRatingRequest(supabase, {
      customerId,
      consultantId,
      env: channelEnv,
      superadminConsultantId: channelEnv.superadminConsultantId,
    });

    // Retry 1x só em falha de ENVIO. Com chaves estáveis + skip de closing
    // parcial, não duplica mensagem no WhatsApp.
    if (!result.ok && (result.code === "send_failed_closing" || result.code === "send_failed_rating")) {
      await new Promise((r) => setTimeout(r, 800));
      result = await sendAttendanceRatingRequest(supabase, {
        customerId,
        consultantId,
        env: channelEnv,
        superadminConsultantId: channelEnv.superadminConsultantId,
      });
    }

    if (!result.ok) {
      const code = String(result.code);
      const detail = String(result.detail || "");
      const detailLc = detail.toLowerCase();
      let fixHint: string | null = null;
      let message = "Não foi possível finalizar automaticamente.";

      // Canal fora do ar → lote deve parar. Falha pontual de número → continua.
      const looksChannelDown = /offline|timeout|401|403|token|unauthorized|econnrefused|fetch failed|network|instance.?not|not.?connected|disconnected/i
        .test(detailLc);

      if (code === "channel_unavailable") {
        fixHint = detail === "whapi_token_missing" ? "whapi_token" : "evolution_instance";
        message = detail === "whapi_token_missing"
          ? "Token Whapi ausente. Configure o canal antes de enviar a pesquisa."
          : "Canal WhatsApp indisponível. Conecte a instância para enviar a pesquisa.";
      } else if (code === "rate_limited") {
        fixHint = "rate_limit";
        message = detail
          ? `Limite de envio atingido (${detail}). Aguarde antes de continuar o lote.`
          : "Limite de envio atingido (anti-ban). Aguarde antes de continuar o lote.";
      } else if (code === "send_failed_closing" || code === "send_failed_rating") {
        const etapa = code === "send_failed_closing" ? "mensagem de encerramento" : "pesquisa de satisfação";
        if (looksChannelDown) {
          fixHint = "instance_offline";
          message = detail
            ? `WhatsApp offline ao enviar ${etapa}: ${detail}`
            : `WhatsApp offline ao enviar ${etapa}. Reconecte e tente de novo.`;
        } else {
          // Falha deste número (recusa Whapi, JID inválido, etc.) — não mata o lote inteiro.
          fixHint = "retry";
          message = detail
            ? `Falha ao enviar ${etapa}: ${detail}`
            : `Falha ao enviar ${etapa} para este número. WhatsApp recusou o envio.`;
        }
      } else if (code === "no_phone") {
        fixHint = "phone";
        message = "Telefone do cliente inválido. Corrija para enviar a pesquisa.";
      } else if (code === "attendance_not_started") {
        fixHint = "start_first";
        message = "Atendimento ainda não foi iniciado neste lead. Inicie antes de finalizar.";
      } else if (code === "customer_not_found") {
        message = "Cliente não encontrado no banco.";
      } else if (detail) {
        message = `${message} (${detail})`;
      }

      return json({
        ok: false,
        error: code,
        detail,
        fallback: true,
        fixHint,
        message,
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
