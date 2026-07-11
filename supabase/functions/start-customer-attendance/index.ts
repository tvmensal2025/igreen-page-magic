// start-customer-attendance
// Botão "Iniciar atendimento" do consultor.
// GATE: automation_toggles.start_customer_attendance precisa estar ON.
// TEMPLATE: se o consultor personalizou 'start_attendance', envia essa msg
//   (com {{saudacao}}, {{consultor}}, {{protocolo}}, {{nome}}) como única mensagem.
//   Caso contrário, envia o cabeçalho padrão (greeting + protocolo + pedido de nome).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendWelcomeHeader } from "../_shared/welcome-header.ts";
import { loadChannelEnv } from "../_shared/attendance-channel-env.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { resolveConsultantMessage } from "../_shared/consultant-template.ts";

interface Body { customerId: string; consultantId: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function greetingByHour(): string {
  const h = new Date(Date.now() - 3 * 3600_000).getUTCHours(); // BRT
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
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

    // 🚦 Kill switch universal
    if (!(await isAutomationEnabled(supabase, "start_customer_attendance"))) {
      await logSkipped(supabase, "start_customer_attendance", { customerId, consultantId });
      return json({
        ok: false,
        error: "automation_disabled",
        message: "Abrir chamado automático está DESLIGADO. Ative em Admin → Central de Agendamentos → Automações.",
        fallback: true,
      });
    }

    const { data: customer, error } = await supabase
      .from("customers")
      .select("id, consultant_id, name")
      .eq("id", customerId)
      .maybeSingle();
    if (error || !customer) return json({ ok: false, error: "customer_not_found" }, 404);
    if (customer.consultant_id && customer.consultant_id !== consultantId) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    const { data: consultant } = await supabase
      .from("consultants")
      .select("name, display_name")
      .eq("id", consultantId)
      .maybeSingle();
    const consultantName = (consultant as { display_name?: string; name?: string } | null)?.display_name
      || (consultant as { name?: string } | null)?.name || "seu consultor";

    // Resolve template do consultor (fallback = default do admin ou vazio → header padrão).
    const tpl = await resolveConsultantMessage(supabase, consultantId, "start_attendance", {
      saudacao: greetingByHour(),
      consultor: consultantName,
      nome: (customer as { name?: string }).name || "",
      protocolo: "", // será preenchido pela sendWelcomeHeader após assignProtocol
    }, "");

    const channelEnv = await loadChannelEnv(supabase);

    // Se o texto tem {{protocolo}}, precisamos re-render após saber o protocolo.
    // Simplificação: se template usa {{protocolo}}, deixa como marcador literal
    // e a welcome-header o substitui? Não — melhor: primeiro peço um protocolo,
    // depois envio. Mas welcome-header já faz assignProtocol internamente.
    // Solução: passamos o texto AINDA com {{protocolo}} placeholder e a
    // welcome-header substitui antes do envio (patch mínimo).
    const customTemplate = tpl.text
      ? { text: tpl.text, audio_url: tpl.audio_url, typing_delay_ms: tpl.typing_delay_ms }
      : null;

    const result = await sendWelcomeHeader(supabase, {
      customerId,
      consultantId,
      env: channelEnv,
      superadminConsultantId: channelEnv.superadminConsultantId,
      customTemplate,
    });

    if (!result.ok) {
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
      template_source: tpl.source,
    });
  } catch (e) {
    return json({ ok: false, error: "exception", message: (e as Error).message, fallback: true }, 200);
  }
});
