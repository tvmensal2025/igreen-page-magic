/**
 * speed-to-lead-check — cria alerta no painel se lead novo ficou sem 1ª resposta.
 *
 * NÃO envia WhatsApp ao cliente. Só `bot_handoff_alerts` (+ log).
 * Toggle: speed_to_lead_sla.
 * Minutos: retention_settings.speed_to_lead_minutes (default 5).
 * Critério: welcome_sent_at null + do_not_contact false + pelo menos 1 inbound
 * (evita alerta em lead manual parado sem mensagem do cliente).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { loadRetentionSettings } from "../_shared/retention-orchestrator.ts";
import { loadAutomationTemplate } from "../_shared/automation-templates.ts";
import { LEAD_ORIGIN_FILTER } from "../_shared/origin-guard.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

const MAX_PER_RUN = 40;

Deno.serve(async (_req) => {
  if (_req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );


  const cronAuth = await assertCronAuth(_req, supabase as any);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);
  if (!(await isAutomationEnabled(supabase, "speed_to_lead_sla"))) {
    await logSkipped(supabase, "speed_to_lead_sla");
    return json({ skipped: "automation_disabled", key: "speed_to_lead_sla" });
  }

  const settings = await loadRetentionSettings(supabase);
  const minutes = settings.speed_to_lead_minutes;
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  const lookback = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Leads novos sem 1ª resposta (welcome). Exclui bloqueados e quem já recebeu welcome.
  // Sem inbound = não é "cliente mandou e ninguém respondeu" (evita ruído de lead manual parado).
  const { data: candidates, error } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp, consultant_id, created_at, conversation_step, welcome_sent_at")
    .lte("created_at", cutoff)
    .gte("created_at", lookback)
    .eq("bot_paused", false)
    .eq("do_not_contact", false)
    .is("welcome_sent_at", null)
    .is("assigned_human_id", null)
    .or(LEAD_ORIGIN_FILTER)
    .limit(MAX_PER_RUN);

  if (error) {
    console.error("[speed-to-lead] query failed", error.message);
    return json({ ok: false, error: error.message }, 500);
  }

  let alerted = 0;
  let skipped = 0;

  for (const c of candidates || []) {
    try {
      // Só alerta se o lead já falou (inbound). Cadastro manual sem msg ≠ SLA de resposta.
      const { count: inCount } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", c.id)
        .eq("message_direction", "inbound")
        .gte("created_at", c.created_at);

      if ((inCount ?? 0) === 0) {
        skipped++;
        continue;
      }

      // Já teve outbound depois da criação?
      const { count: outCount } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", c.id)
        .eq("message_direction", "outbound")
        .gte("created_at", c.created_at);

      if ((outCount ?? 0) > 0) {
        skipped++;
        continue;
      }

      // Já alertou nas últimas 2h?
      const since = new Date(Date.now() - 2 * 3600_000).toISOString();
      const { count: alertCount } = await supabase
        .from("bot_handoff_alerts")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", c.id)
        .eq("alert_type", "speed_to_lead_sla")
        .gte("created_at", since);

      if ((alertCount ?? 0) > 0) {
        skipped++;
        continue;
      }

      const detail = await loadAutomationTemplate(
        supabase,
        "speed_to_lead_alert",
        `Lead {{nome}} ({{telefone}}) sem 1ª resposta há mais de {{minutos}} min. Priorize o atendimento.`,
        {
          nome: (c.name || "").split(" ")[0] || "sem nome",
          telefone: c.phone_whatsapp || "—",
          minutos: String(minutes),
        },
        c.consultant_id,
      );

      if (!c.consultant_id) {
        skipped++;
        continue;
      }

      await supabase.from("bot_handoff_alerts").insert({
        customer_id: c.id,
        consultant_id: c.consultant_id,
        alert_type: "speed_to_lead_sla",
        reason: detail,
        phone: c.phone_whatsapp,
        user_message: null,
        metadata: {
          minutes,
          conversation_step: c.conversation_step,
          lead_created_at: c.created_at,
        },
      });
      alerted++;
    } catch (e) {
      console.warn("[speed-to-lead] lead failed", c.id, (e as Error).message);
    }
  }

  return json({ ok: true, scanned: (candidates || []).length, alerted, skipped, minutes });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
