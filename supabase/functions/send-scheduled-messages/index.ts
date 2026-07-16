// send-scheduled-messages — cron (1/min) que executa a agenda manual
// (tabela scheduled_messages, criada pelo consultor no Hub de Agendamentos).
//
// Concorrência: usa a RPC claim_scheduled_messages (FOR UPDATE SKIP LOCKED)
// para reivindicar mensagens atomicamente — dois ticks simultâneos nunca
// enviam a mesma mensagem. Linhas presas em 'processing' (worker morreu no
// meio) são destravadas pela RPC reconcile_stuck_scheduled_messages.
//
// Retry: falha de envio consome uma tentativa (attempt_count) e reagenda
// +10min; na 3ª falha vira 'failed' definitivo com last_error preenchido.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { captureError } from "../_shared/sentry.ts";
import { isQuietHourBRT, nextQuietWindowEndISO, logQuietSkip } from "../_shared/quiet-hours.ts";
import { renderTemplateVars } from "../_shared/render-vars.ts";
import { checkSendQuota, registerSend, simulateTyping, typingDurationMs, humanJitterMs } from "../_shared/anti-ban.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";

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
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");

    if (!evolutionUrl || !evolutionKey) {
      return new Response(JSON.stringify({ error: "Evolution API not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const cronAuth = await assertCronAuth(req, supabase);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);


    // Agenda manual (Hub): NÃO depende de bot_global_enabled — consultor agenda
    // mensagem própria; kill switch do bot não deve bloquear execução da agenda.
    if (!(await isAutomationEnabled(supabase, "send_scheduled_messages"))) {
      await logSkipped(supabase, "send_scheduled_messages");
      return new Response(JSON.stringify({ skipped: "automation_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Destrava mensagens presas em 'processing' (worker anterior morreu).
    const { data: reconciled, error: reconcileError } = await supabase
      .rpc("reconcile_stuck_scheduled_messages");
    if (reconcileError) {
      console.warn("[scheduled] reconcile falhou:", reconcileError.message);
    } else if (reconciled) {
      console.log(`[scheduled] ${reconciled} mensagem(ns) destravada(s) de processing`);
    }

    // Em horário de silêncio: adia mensagens devidas para 08:00 BRT e sai.
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

    // Claim atômico: marca como 'processing' e retorna as linhas reivindicadas.
    // Outro worker rodando em paralelo recebe um conjunto disjunto (SKIP LOCKED).
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

    // Falha consome tentativa; até MAX_ATTEMPTS reagenda +10min, depois 'failed'.
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

        // 🛑 Regra de ouro: humano assumiu → IA NÃO manda nada
        let customerName: string | null = null;
        let billValue: number | null = null;
        let representante: string | null = null;
        if (phone) {
          // Prioriza customer do consultor que criou o agendamento (evita colisão multi-tenant).
          let custQuery = supabase
            .from("customers")
            .select("id, name, electricity_bill_value, consultant_id, bot_paused, assigned_human_id, bot_paused_until, do_not_contact")
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
            const gate = await assertBotOutboundAllowed(supabase, {
              customerId: (cust as { id?: string } | null)?.id,
              phone,
              consultantId: msg.consultant_id || (cust as { consultant_id?: string } | null)?.consultant_id,
            });
            if (!gate.allowed) {
              await supabase
                .from("scheduled_messages")
                .update({ status: "skipped", processing_started_at: null })
                .eq("id", msg.id);
              console.log(`⏭️ [scheduled] msg ${msg.id} pulada — gate (${gate.reason})`);
              skippedPaused++;
              continue;
            }
          }
          customerName = (cust as any)?.name || null;
          billValue = (cust as any)?.electricity_bill_value ?? null;
          if ((cust as any)?.consultant_id) {
            const { data: consultant } = await supabase
              .from("consultants")
              .select("name")
              .eq("id", (cust as any).consultant_id)
              .maybeSingle();
            representante = (consultant as any)?.name || null;
          }
        }

        // ✅ Renderiza {{nome}}, {nome}, {NOME}, {{valor_conta}} etc. antes de enviar.
        const renderedText = renderTemplateVars(msg.message_text, {
          name: customerName,
          phone,
          representante,
          valor_conta: billValue,
        });

        // 🛡️ Anti-ban guard — não é falha: devolve para pending com novo horário.
        const quota = await checkSendQuota(supabase, msg.instance_name);
        if (!quota.allowed) {
          const retryAt = quota.until || quota.next_allowed_at
            || new Date(Date.now() + 30 * 60_000).toISOString();
          await supabase.from("scheduled_messages")
            .update({ status: "pending", scheduled_at: retryAt, processing_started_at: null })
            .eq("id", msg.id);
          console.log(`⏸️ [scheduled] msg ${msg.id} adiada (anti-ban): ${quota.reason} → ${retryAt}`);
          continue;
        }

        // Humaniza: "digitando..."
        await simulateTyping({
          baseUrl: evolutionUrl, apiKey: evolutionKey,
          instance: msg.instance_name, remoteJid: phone,
          durationMs: typingDurationMs(renderedText),
        });

        const res = await fetch(`${evolutionUrl}/message/sendText/${msg.instance_name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: evolutionKey },
          body: JSON.stringify({ number: phone, text: renderedText }),
        });

        if (res.ok) {
          await supabase
            .from("scheduled_messages")
            .update({ status: "sent", sent_at: new Date().toISOString(), processing_started_at: null })
            .eq("id", msg.id);
          await registerSend(supabase, msg.instance_name);
          sentCount++;
        } else {
          const errText = await res.text();
          console.error(`Failed to send scheduled message ${msg.id}:`, errText);
          await failOrRetry(msg, errText || `http_${res.status}`);
        }
      } catch (err) {
        console.error(`Error sending message ${msg.id}:`, err);
        await failOrRetry(msg, String((err as Error)?.message || err));
      }

      // Intervalo mínimo do warmup + jitter humano
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
        reconciled: reconciled ?? 0,
        total: messages.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
