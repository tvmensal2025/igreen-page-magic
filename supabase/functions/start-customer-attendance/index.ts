// start-customer-attendance
// Botão "Iniciar atendimento" do consultor.
// CLASSIFICAÇÃO: envio MANUAL — o consultor abriu o cliente e clicou.
//   Chamadas com JWT de usuário válido NÃO passam pelo kill switch de
//   automação (manual não é automático). O toggle
//   automation_toggles.start_customer_attendance segue bloqueando chamadas
//   sem usuário autenticado (integrações internas/batch sem operador).
// TEMPLATE: se o consultor personalizou 'start_attendance', envia essa msg
//   (com {{saudacao}}, {{consultor}}, {{protocolo}}, {{nome}}) como única mensagem.
//   Caso contrário, envia o cabeçalho padrão (greeting + protocolo + pedido de nome).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendWelcomeHeader } from "../_shared/welcome-header.ts";
import { loadChannelEnv } from "../_shared/attendance-channel-env.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { resolveConsultantMessage } from "../_shared/consultant-template.ts";

interface Body { customerId: string; consultantId: string; restart?: boolean }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function greetingByHour(): string {
  // Horário de Brasília via Intl (não assume offset fixo).
  const h = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false,
  }).format(new Date())) % 24;
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
    const restart = body.restart === true;
    if (!customerId || !consultantId) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    // Manual não é automático: se o JWT pertence a um usuário real (consultor
    // clicou em "Iniciar atendimento"), o envio é manual e NÃO passa pelo kill
    // switch de automação. O toggle continua valendo para chamadas sem usuário
    // (ex.: integrações internas usando anon/service key).
    const { data: authData } = await supabase.auth.getUser(jwt);
    const isManualClick = !!authData?.user?.id;

    if (!isManualClick && !(await isAutomationEnabled(supabase, "start_customer_attendance"))) {
      await logSkipped(supabase, "start_customer_attendance", { customerId, consultantId });
      return json({
        ok: false,
        error: "automation_disabled",
        message: "Abertura de chamado sem operador está DESLIGADA. Ative em Automações.",
        fallback: true,
        fixHint: "toggle",
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

    // Reiniciar atendimento: limpa marcadores para permitir novo welcome+protocolo,
    // mesmo que o cliente não tenha dado nota. Usado pelo botão "Reiniciar".
    if (restart) {
      const full = await supabase
        .from("customers")
        .update({
          welcome_sent_at: null,
          tracking_protocol: null,
          attendance_rating: null,
          attendance_rating_requested_at: null,
          attendance_rating_at: null,
          attendance_auto_close_at: null,
        })
        .eq("id", customerId);
      if (full.error) {
        // Fallback quando colunas opcionais ainda não existem no schema.
        await supabase
          .from("customers")
          .update({ welcome_sent_at: null, tracking_protocol: null })
          .eq("id", customerId);
      }
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

    let result = await sendWelcomeHeader(supabase, {
      customerId,
      consultantId,
      env: channelEnv,
      superadminConsultantId: channelEnv.superadminConsultantId,
      customTemplate,
    });

    // Retry 1x em falha transiente de envio (rede/timeout).
    if (!result.ok && (result.code === "send_failed_greeting" || result.code === "send_failed_protocol")) {
      await new Promise((r) => setTimeout(r, 800));
      result = await sendWelcomeHeader(supabase, {
        customerId,
        consultantId,
        env: channelEnv,
        superadminConsultantId: channelEnv.superadminConsultantId,
        customTemplate,
      });
    }

    if (!result.ok) {
      const code = String(result.code);
      const detail = String(result.detail || "");
      // Mapa código→hint para o front escolher o CTA correto.
      let fixHint: string | null = null;
      let message = "Não foi possível iniciar automaticamente.";
      if (code === "channel_unavailable") {
        if (detail === "whapi_token_missing") {
          fixHint = "whapi_token";
          message = "Whapi do super admin sem token. Configure para enviar automático.";
        } else {
          fixHint = "evolution_instance";
          message = "Sem instância WhatsApp conectada. Conecte para enviar automático.";
        }
      } else if (code === "send_failed_greeting" || code === "send_failed_protocol") {
        fixHint = "instance_offline";
        message = "Instância respondeu offline. Reconecte para reenviar.";
      } else if (code === "no_phone") {
        fixHint = "phone";
        message = "Telefone do cliente inválido. Corrija para enviar.";
      } else if (code === "rate_limited") {
        fixHint = "rate_limit";
        message = "Anti-ban pausou envios agora. Tente em alguns minutos.";
      } else if (code === "protocol_generation_failed") {
        fixHint = "retry";
        message = "Falha ao gerar protocolo. Tente de novo.";
      }
      return json({
        ok: false,
        error: code,
        detail,
        fallback: true,
        fixHint,
        message,
        instance: (result as { instance?: string }).instance,
      }, 200);
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
