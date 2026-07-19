// send-scheduled-messages — cron (1/min) que executa a agenda manual
// (tabela scheduled_messages, criada pelo consultor no Hub de Agendamentos).
//
// Canal: o do consultor conectado — Whapi se Whapi, Evolution se Evolution
// (`resolveConsultantOutboundChannel`). Não exige Evolution no boot.
//
// Concorrência: RPC claim_scheduled_messages (FOR UPDATE SKIP LOCKED).
// Retry: até MAX_ATTEMPTS reagenda +10min; depois 'failed' com last_error.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { captureError } from "../_shared/sentry.ts";
import { isQuietHourBRT, nextQuietWindowEndISO, logQuietSkip } from "../_shared/quiet-hours.ts";
import { renderTemplateVars } from "../_shared/render-vars.ts";
import { checkSendQuota, registerSend, simulateTyping, typingDurationMs, humanJitterMs } from "../_shared/anti-ban.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { assertCanContact } from "../_shared/contact-suppression.ts";
import { resolveConsultantConnectedWaPhone } from "../_shared/consultant-wa-phone.ts";
import { loadChannelEnv } from "../_shared/attendance-channel-env.ts";
import {
  isUnavailable,
  resolveConsultantOutboundChannel,
} from "../_shared/channel-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10 * 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const cronAuth = await assertCronAuth(req, supabase as any);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

    // Agenda manual (Hub): NÃO depende de bot_global_enabled — consultor agenda
    // mensagem própria; kill switch do bot não deve bloquear execução da agenda.
    if (!(await isAutomationEnabled(supabase, "send_scheduled_messages"))) {
      await logSkipped(supabase, "send_scheduled_messages");
      return new Response(JSON.stringify({ skipped: "automation_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const channelEnv = await loadChannelEnv(supabase);
    if (!channelEnv.whapiToken && !(channelEnv.evolutionUrl && channelEnv.evolutionKey)) {
      return new Response(
        JSON.stringify({
          error: "Nenhum canal WhatsApp configurado (Whapi ou Evolution)",
          pending: "configure_whatsapp_channel",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: reconciled, error: reconcileError } = await supabase
      .rpc("reconcile_stuck_scheduled_messages");
    if (reconcileError) {
      console.warn("[scheduled] reconcile falhou:", reconcileError.message);
    } else if (reconciled) {
      console.log(`[scheduled] ${reconciled} mensagem(ns) destravada(s) de processing`);
    }

    if (isQuietHourBRT()) {
      const nextRun = nextQuietWindowEndISO();
      const { data: deferred, error: deferError } = await supabase
        .from("scheduled_messages")
        .update({ scheduled_at: nextRun })
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .select("id");
      if (deferError) throw deferError;
      logQuietSkip("send-scheduled-messages", { deferred: deferred?.length ?? 0, next_run: nextRun });
      return new Response(
        JSON.stringify({ skipped: "quiet_hours", deferred: deferred?.length ?? 0, next_run: nextRun }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: messages, error: fetchError } = await supabase
      .rpc("claim_scheduled_messages", { p_limit: 50 });

    if (fetchError) throw fetchError;
    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, message: "No pending messages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sentCount = 0;
    let failedCount = 0;
    let retriedCount = 0;
    let skippedPaused = 0;
    let pendingChannel = 0;

    const failOrRetry = async (msg: { id: string; attempt_count?: number }, errText: string) => {
      const attempts = Number(msg.attempt_count ?? 0) + 1;
      const isFinal = attempts >= MAX_ATTEMPTS;
      await supabase
        .from("scheduled_messages")
        .update({
          status: isFinal ? "failed" : "pending",
          attempt_count: attempts,
          last_error: errText.slice(0, 500),
          processing_started_at: null,
          ...(isFinal ? {} : { scheduled_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString() }),
        })
        .eq("id", msg.id);
      if (isFinal) failedCount++;
      else retriedCount++;
    };

    for (const msg of messages) {
      try {
        const phone = msg.remote_jid.split("@")[0].replace(/\D/g, "");

        let customerName: string | null = null;
        let customerNameSource: string | null = null;
        let billValue: number | null = null;
        let representante: string | null = null;
        let representantePhone: string | null = null;
        let customerId: string | undefined;
        let custConsultantId: string | undefined;

        if (phone) {
          let custQuery = supabase
            .from("customers")
            .select("id, name, name_source, electricity_bill_value, consultant_id, bot_paused, assigned_human_id, bot_paused_until, do_not_contact")
            .eq("phone_whatsapp", phone);
          if (msg.consultant_id) {
            custQuery = custQuery.or(
              `consultant_id.eq.${msg.consultant_id},assigned_consultant_id.eq.${msg.consultant_id}`,
            );
          }
          const { data: cust } = await custQuery
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const paused =
            !!cust?.do_not_contact ||
            !!cust?.bot_paused ||
            !!cust?.assigned_human_id ||
            (cust?.bot_paused_until && new Date(cust.bot_paused_until).getTime() > Date.now());
          if (paused) {
            await supabase
              .from("scheduled_messages")
              .update({ status: "skipped", processing_started_at: null })
              .eq("id", msg.id);
            console.log(`⏭️ [scheduled] msg ${msg.id} pulada — pausado/opt-out (phone=${phone})`);
            skippedPaused++;
            continue;
          }
          if (cust?.id || phone) {
            // Agenda MANUAL do consultor: NÃO usa assertBotOutboundAllowed
            // (esse gate checa bot_global_enabled e mataria o envio com kill switch).
            // Mantém só DNC / never-contact.
            const suppression = await assertCanContact(supabase as any, {
              customerId: (cust as { id?: string } | null)?.id,
              phone,
              consultantId: msg.consultant_id || (cust as { consultant_id?: string } | null)?.consultant_id,
              channel: "whatsapp",
            });
            if (!suppression.allowed) {
              await supabase
                .from("scheduled_messages")
                .update({ status: "skipped", processing_started_at: null })
                .eq("id", msg.id);
              console.log(`⏭️ [scheduled] msg ${msg.id} pulada — DNC (${suppression.reason})`);
              skippedPaused++;
              continue;
            }
          }
          customerId = (cust as { id?: string } | null)?.id;
          custConsultantId = (cust as { consultant_id?: string } | null)?.consultant_id;
          customerName = (cust as { name?: string } | null)?.name || null;
          customerNameSource = (cust as { name_source?: string } | null)?.name_source ?? null;
          billValue = (cust as { electricity_bill_value?: number } | null)?.electricity_bill_value ?? null;
          if (custConsultantId) {
            const { data: consultant } = await supabase
              .from("consultants")
              .select("name, display_name")
              .eq("id", custConsultantId)
              .maybeSingle();
            representante = (consultant as { display_name?: string; name?: string } | null)?.display_name
              || (consultant as { name?: string } | null)?.name
              || null;
            representantePhone = await resolveConsultantConnectedWaPhone(supabase, custConsultantId);
          }
        }

        const renderedText = renderTemplateVars(msg.message_text, {
          name: customerName,
          name_source: customerNameSource,
          phone,
          representante,
          representante_phone: representantePhone,
          valor_conta: billValue,
        });

        const channel = await resolveConsultantOutboundChannel(
          supabase,
          msg.consultant_id,
          channelEnv,
          msg.instance_name,
        );
        if (isUnavailable(channel)) {
          pendingChannel++;
          const pendingMsg =
            `pendencia_canal: ${channel.detail}. Conecte o WhatsApp do consultor (Whapi ou Evolution) e aguarde o retry, ou cancele e reagende.`;
          console.warn(`⏳ [scheduled] msg ${msg.id} — ${pendingMsg}`);
          await failOrRetry(msg, pendingMsg);
          continue;
        }

        const quotaKey = channel.instanceName || msg.instance_name;
        const quota = await checkSendQuota(supabase, quotaKey);
        if (!quota.allowed) {
          const retryAt = quota.until || quota.next_allowed_at
            || new Date(Date.now() + 30 * 60_000).toISOString();
          await supabase.from("scheduled_messages")
            .update({ status: "pending", scheduled_at: retryAt, processing_started_at: null })
            .eq("id", msg.id);
          console.log(`⏸️ [scheduled] msg ${msg.id} adiada (anti-ban): ${quota.reason} → ${retryAt}`);
          continue;
        }

        // Typing só Evolution (Whapi já embute typing_time no sendText).
        if (
          channel.kind === "evolution" &&
          channelEnv.evolutionUrl &&
          channelEnv.evolutionKey
        ) {
          await simulateTyping({
            baseUrl: channelEnv.evolutionUrl,
            apiKey: channelEnv.evolutionKey,
            instance: channel.instanceName,
            remoteJid: phone,
            durationMs: typingDurationMs(renderedText),
          });
        }

        const jid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;
        const sendCtx = {
          customerId: customerId || "scheduled",
          consultantId: msg.consultant_id || custConsultantId || "unknown",
          stepId: `scheduled:${msg.id}`,
          idempotencyKey: `scheduled:${msg.id}:${msg.attempt_count ?? 0}`,
          supabase,
        };
        const sendResult = await channel.adapter.sendText(jid, renderedText, sendCtx as never);

        if (sendResult?.ok) {
          await supabase
            .from("scheduled_messages")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              processing_started_at: null,
              // Atualiza instance_name para o canal realmente usado (Whapi ou Evolution).
              instance_name: channel.instanceName,
              last_error: null,
            })
            .eq("id", msg.id);
          await registerSend(supabase, channel.instanceName);
          sentCount++;
          console.log(`✅ [scheduled] msg ${msg.id} enviada via ${channel.kind}/${channel.instanceName}`);
        } else {
          const errText = String((sendResult as { detail?: string })?.detail || "send_failed");
          console.error(`Failed to send scheduled message ${msg.id}:`, errText);
          await failOrRetry(msg, errText);
        }
      } catch (err) {
        console.error(`Error sending message ${msg.id}:`, err);
        await failOrRetry(msg, String((err as Error)?.message || err));
      }

      if (messages.indexOf(msg) < messages.length - 1) {
        await new Promise((r) => setTimeout(r, Math.max(5000, humanJitterMs() * 3)));
      }
    }

    return new Response(
      JSON.stringify({
        sent: sentCount,
        failed: failedCount,
        retried: retriedCount,
        skipped_paused: skippedPaused,
        pending_channel: pendingChannel,
        reconciled: reconciled ?? 0,
        total: messages.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error:", error);
    captureError(error, { tags: { function: "send-scheduled-messages" } });
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
