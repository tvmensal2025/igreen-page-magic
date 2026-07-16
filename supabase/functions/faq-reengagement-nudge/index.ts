/**
 * faq-reengagement-nudge — Cron que envia nudge para leads que ficaram
 * 20+ minutos sem responder após interação com FAQ.
 *
 * Execução: a cada 5 minutos via pg_cron ou Supabase Scheduler.
 * Auth: service_role (verify_jwt = false).
 *
 * Regras:
 *  - Só leads com detour_count > 0 (tiveram FAQ detour)
 *  - Bot não pausado (bot_paused = false)
 *  - Último update > 20min atrás (proxy de inatividade)
 *  - Máximo 1 nudge a cada 4 horas por lead
 *  - Respeita quiet hours (21:30-08:00 BRT)
 *  - Máximo 30 leads por execução (rate limiting)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveChannelForCustomer, isUnavailable } from "../_shared/channel-sender.ts";
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";
import { normalizePhone } from "../_shared/utils.ts";
import { isQuietHoursBRT } from "../_shared/bot/nudge-quiet-hours.ts";
import { LEAD_ORIGIN_FILTER } from "../_shared/origin-guard.ts";
import { isAttendanceTerminalStep } from "../_shared/attendance-flow.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { loadAutomationTemplate } from "../_shared/automation-templates.ts";
import { gateProactiveTouch, recordProactiveTouch } from "../_shared/retention-orchestrator.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";

const NUDGE_DELAY_MINUTES = 20;
const NUDGE_COOLDOWN_HOURS = 4;
const MAX_LEADS_PER_RUN = 30;

serve(async (req: Request) => {
  if (isQuietHoursBRT()) {
    return new Response(JSON.stringify({ ok: true, skipped: "quiet_hours" }), { status: 200 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const cronAuth = await assertCronAuth(req, supabase);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason);

  // Antes este cron enviava SEM nenhum kill switch — nem o global nem um
  // toggle próprio. Agora respeita os dois (toggle novo nasce OFF; ligar na
  // Central de Agendamentos).
  if (!(await isBotGloballyEnabled(supabase))) {
    return new Response(JSON.stringify({ ok: true, skipped: "bot_globally_disabled" }), { status: 200 });
  }
  if (!(await isAutomationEnabled(supabase, "faq_reengagement_nudge"))) {
    await logSkipped(supabase, "faq_reengagement_nudge");
    return new Response(JSON.stringify({ ok: true, skipped: "automation_disabled", key: "faq_reengagement_nudge" }), { status: 200 });
  }

  const cutoff = new Date(Date.now() - NUDGE_DELAY_MINUTES * 60 * 1000).toISOString();
  const cooldown = new Date(Date.now() - NUDGE_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  // Busca leads candidatos a nudge.
  // Sinal de inatividade: `last_bot_reply_at` (última resposta do bot) > 20min.
  // Como o bot responde a tudo e não está pausado, um last_bot_reply_at antigo
  // significa que o lead realmente ficou em silêncio. Guardas evitam spam em
  // leads convertidos, em opt-out ou de teste.
  const { data: candidates, error } = await supabase
    .from("customers")
    .select("id, name, phone_whatsapp, consultant_id, conversation_step")
    .eq("bot_paused", false)
    // Lead em pausa temporária ("me chama amanhã") ou em mão humana não
    // recebe nudge — mesmos filtros dos demais crons proativos.
    .or(`bot_paused_until.is.null,bot_paused_until.lte.${new Date().toISOString()}`)
    .is("assigned_human_id", null)
    .eq("is_converted", false)
    .eq("do_not_contact", false)
    .eq("is_test_lead", false)
    .gt("detour_count", 0)
    .not("last_bot_reply_at", "is", null)
    .lt("last_bot_reply_at", cutoff)
    .or(`nudge_sent_at.is.null,nudge_sent_at.lt.${cooldown}`)
    .not("phone_whatsapp", "is", null)
    // Regra de ouro: carteira iGreen nunca recebe nudge automático.
    .or(LEAD_ORIGIN_FILTER)
    .limit(MAX_LEADS_PER_RUN);

  if (error) {
    console.error("[faq-nudge] query failed:", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  if (!candidates || candidates.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 });
  }

  const env = {
    evolutionUrl: Deno.env.get("EVOLUTION_API_URL"),
    evolutionKey: Deno.env.get("EVOLUTION_API_KEY"),
    whapiToken: Deno.env.get("WHAPI_TOKEN") || "",
  };

  let sent = 0;

  for (const lead of candidates) {
    try {
      // Nunca nudge durante pesquisa de atendimento ou após finalização.
      if (isAttendanceTerminalStep((lead as { conversation_step?: string | null }).conversation_step)) {
        console.log(`[faq-nudge] skip attendance step lead=${lead.id} step=${lead.conversation_step}`);
        continue;
      }

      if (!(await gateProactiveTouch(supabase, lead.id, "faq_reengagement_nudge"))) continue;

      const gate = await assertBotOutboundAllowed(supabase, {
        customerId: lead.id,
        phone: lead.phone_whatsapp,
        consultantId: lead.consultant_id,
      });
      if (!gate.allowed) continue;

      const channel = await resolveChannelForCustomer(supabase, lead.id, env);
      if (isUnavailable(channel)) {
        console.warn(`[faq-nudge] canal indisponível lead=${lead.id} instance=${channel.instanceName} reason=${channel.reason}`);
        continue;
      }


      // Anti-ban check
      const quota = await checkSendQuota(supabase, channel.instanceName);
      if (!quota.allowed) {
        console.warn(`[faq-nudge] quota blocked for ${channel.instanceName}: ${quota.reason}`);
        continue;
      }

      const firstName = String(lead.name || "").trim().split(/\s+/)[0] || "";
      const fallback = firstName
        ? `${firstName}, qualquer outra dúvida, é só perguntar. Estou por aqui.`
        : `Qualquer outra dúvida, é só perguntar. Estou por aqui.`;
      const nudgeText = await loadAutomationTemplate(
        supabase,
        "faq_reengagement_nudge",
        fallback,
        { nome: firstName },
        lead.consultant_id,
      );

      const digits = normalizePhone(lead.phone_whatsapp).replace(/\D/g, "");
      if (!digits) {
        console.warn(`[faq-nudge] phone inválido para ${lead.id}`);
        continue;
      }
      const jid = `${digits}@s.whatsapp.net`;
      const sendCtx = {
        customerId: lead.id,
        consultantId: lead.consultant_id,
        stepId: "faq_nudge",
        idempotencyKey: `nudge:${lead.id}:${Math.floor(Date.now() / (4 * 60 * 60 * 1000))}`,
        supabase,
      };

      const result = await channel.adapter.sendText(jid, nudgeText, sendCtx);
      if (!result.ok) {
        console.warn(`[faq-nudge] send failed for ${lead.id}`);
        continue;
      }

      await registerSend(supabase, channel.instanceName);
      await recordProactiveTouch(supabase, lead.id, "faq_reengagement_nudge");

      // Log no conversations
      await supabase.from("conversations").insert({
        customer_id: lead.id,
        message_direction: "outbound",
        message_text: nudgeText,
        message_type: "text",
        conversation_step: lead.conversation_step || "nudge",
        origin: "automation:faq-reengagement-nudge",
      });

      // Marca nudge enviado
      await supabase
        .from("customers")
        .update({ nudge_sent_at: new Date().toISOString() })
        .eq("id", lead.id);

      sent++;
      // Jitter entre envios (2-4s) para anti-ban
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    } catch (e) {
      console.warn(`[faq-nudge] failed for ${lead.id}:`, (e as Error).message);
    }
  }

  console.log(`[faq-nudge] sent=${sent}/${candidates.length}`);
  return new Response(JSON.stringify({ ok: true, sent, total: candidates.length }), { status: 200 });
});
