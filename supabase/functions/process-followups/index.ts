// Worker de follow-ups — roda via cron a cada 5min.
//
// Para cada lead com next_followup_at vencido:
//  1. Resolve o canal (Whapi/Evolution) pela whatsapp_instances do consultor.
//  2. Roda runFluxoBAI in-process com nudgeHook = customers.followup_hook.
//  3. Envia a resposta pelo sender do canal escolhido.
//  4. Só após envio com sucesso zera next_followup_at e seta last_followup_at.
//     Em erro: reagenda em 10min até max 3 tentativas (followup_count).
//
// Respeita quiet hours (BRT 22h-7h).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { executarFollowupCerebro } from "../_shared/cerebro/followup-hook.ts";
import { isQuietHourBRT } from "../_shared/quiet-hours.ts";
import { LEAD_ORIGIN_FILTER, isLeadEligible } from "../_shared/origin-guard.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import {
  finishOutboundEffect,
  finishProactiveTouch,
  markEffectSending,
  reserveOutboundEffect,
  reserveProactiveTouch,
} from "../_shared/journey-effects.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { loadChannelEnv } from "../_shared/attendance-channel-env.ts";
import {
  ctx,
  isUnavailable,
  resolveChannelForCustomerWithFailover,
} from "../_shared/channel-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_FOLLOWUP_ATTEMPTS = 3;
const RETRY_DELAY_MIN = 10;

// Passos terminais: cliente já concluiu o fluxo (portal/OTP/assinatura) ou está
// em mão humana. Espelha TERMINAL_STEPS do bot-followup-checker. Quem está aqui
// NÃO recebe follow-up automático — já fechou ou saiu do bot.
const TERMINAL_STEPS = new Set([
  "complete", "portal_submitting", "portal_submitted", "registered_igreen",
  "awaiting_signature", "finalizando", "validando_otp", "aguardando_humano",
  "aguardando_avaliacao_atendimento", "atendimento_finalizado",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // deno-lint-ignore no-explicit-any
    const cronAuth = await assertCronAuth(req, supabase as any);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

    if (!(await isAutomationEnabled(supabase, "process_followups"))) {
      await logSkipped(supabase, "process_followups");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "process_followups" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Quiet hours: pula execução (cron volta em 5min).
    if (isQuietHourBRT()) {
      return json({ ok: true, skipped: "quiet_hours" });
    }

    // Claim atômico (RPC). Fallback: SELECT + CAS em next_followup_at.
    let due: any[] | null = null;
    const { data: claimedRows, error: claimErr } = await supabase.rpc("claim_due_followups", {
      p_limit: 50,
    });
    if (!claimErr && Array.isArray(claimedRows)) {
      due = claimedRows;
    } else {
      if (claimErr) {
        console.warn("[process-followups] claim_due_followups fallback CAS", claimErr.message);
      }
      const now = new Date().toISOString();
      const { data: selected, error } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, whatsapp_chat_id, conversation_step, consultant_id, next_followup_at, followup_hook, bot_paused, bot_paused_until, variant_id, followup_count, assigned_human_id, flow_variant, customer_origin")
        .lte("next_followup_at", now)
        .eq("bot_paused", false)
        .eq("do_not_contact", false)
        .or(`bot_paused_until.is.null,bot_paused_until.lte.${now}`)
        .is("assigned_human_id", null)
        .or(LEAD_ORIGIN_FILTER)
        .limit(50);
      if (error) return json({ error: error.message }, 500);
      due = [];
      for (const row of selected || []) {
        const lease = new Date(Date.now() + 15 * 60_000).toISOString();
        const { data: got } = await supabase
          .from("customers")
          .update({ next_followup_at: lease })
          .eq("id", row.id)
          .eq("next_followup_at", row.next_followup_at)
          .select("id")
          .maybeSingle();
        if (got?.id) due.push({ ...row, next_followup_at: lease });
      }
    }

    // Defesa em profundidade: terminal / origem carteira não recebem nudge.
    // RPC de claim não aplica LEAD_ORIGIN_FILTER — revalida e cancela aqui.
    for (const c of (due || [])) {
      if (TERMINAL_STEPS.has(c.conversation_step || "") || !isLeadEligible(c.customer_origin)) {
        await cancelFollowup(
          supabase,
          c.id,
          TERMINAL_STEPS.has(c.conversation_step || "") ? "terminal_step" : "blocked_origin",
        );
      }
    }
    const rows = (due || []).filter((c: any) =>
      !TERMINAL_STEPS.has(c.conversation_step || "") &&
      !(c.bot_paused_until && new Date(c.bot_paused_until).getTime() > Date.now()) &&
      isLeadEligible(c.customer_origin)
    );
    if (rows.length === 0) return json({ ok: true, processed: 0 });

    // Credenciais de canal (Whapi settings + Evolution env)
    const channelEnv = await loadChannelEnv(supabase);

    let okCount = 0;
    let errCount = 0;
    let skipCount = 0;
    const errors: any[] = [];

    for (const c of rows) {
      try {
        if (!c.phone_whatsapp) {
          await cancelFollowup(supabase, c.id, "no_phone");
          skipCount++;
          continue;
        }

        // Orquestrador atômico (fail-closed) no lugar do check-then-act legado.
        const touch = await reserveProactiveTouch(supabase, c.id, "process_followups", {});
        if (!touch.allowed) {
          // Mantém lease (já claimado); não reabrir no mesmo tick.
          skipCount++;
          continue;
        }
        let touchOpen = true;
        const releaseTouch = async () => {
          if (touchOpen) {
            touchOpen = false;
            await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
          }
        };

        // deno-lint-ignore no-explicit-any
        const gate = await assertBotOutboundAllowed(supabase as any, {
          customerId: c.id,
          phone: c.phone_whatsapp,
          consultantId: c.consultant_id,
        });
        if (!gate.allowed) {
          skipCount++;
          await releaseTouch();
          continue;
        }

        const attempts = Number(c.followup_count || 0);
        if (attempts >= MAX_FOLLOWUP_ATTEMPTS) {
          await cancelFollowup(supabase, c.id, "max_attempts");
          skipCount++;
          await releaseTouch();
          continue;
        }

        const channel = await resolveChannelForCustomerWithFailover(
          supabase,
          c.id,
          channelEnv,
        );
        if (isUnavailable(channel)) {
          await rescheduleFollowup(supabase, c.id, 30, attempts);
          skipCount++;
          errors.push({ id: c.id, reason: "no_channel_available", detail: channel.detail });
          await releaseTouch();
          continue;
        }
        const channelTag = `${channel.kind}:${channel.instanceName}`;

        // Cérebro IA é fonte única do nudge (vendedora apagada). Como
        // cerebro_ativo='on' é default global, executarFollowupCerebro sempre
        // assume. Em handoff/empty_reply, reagenda sem cair em código morto.
        const t0 = Date.now();
        let aiResult: any = null;

        const canalFollowup = channel.kind;
        const cerebro = await executarFollowupCerebro({
          supabase,
          customerId: c.id,
          consultantId: c.consultant_id,
          channel: canalFollowup,
        });

        if (!cerebro.usouCerebro || !cerebro.reply) {
          errCount++;
          errors.push({
            id: c.id,
            phase: "cerebro",
            error: cerebro.shouldHandoff ? "handoff" : (cerebro.usouCerebro ? "empty_reply" : "cerebro_skipped"),
          });
          await rescheduleFollowup(supabase, c.id, RETRY_DELAY_MIN, attempts + 1);
          await releaseTouch();
          continue;
        }
        aiResult = {
          reply: cerebro.reply,
          conversationStepUpdate: "cerebro_followup",
        };


        const reply = String(aiResult?.reply || "").trim();
        if (!reply) {
          errCount++;
          errors.push({ id: c.id, phase: "ai", error: "empty_reply" });
          await rescheduleFollowup(supabase, c.id, RETRY_DELAY_MIN, attempts + 1);
          await releaseTouch();
          continue;
        }

        // Efeito idempotente: 1 follow-up por tentativa — dois crons
        // simultâneos leem o mesmo followup_count → mesma chave → 1 vence.
        const eff = await reserveOutboundEffect(supabase, {
          idempotencyKey: `followup:${c.id}:${attempts + 1}`,
          engineKey: "process_followups",
          channel: "whatsapp",
          customerId: c.id,
          consultantId: c.consultant_id,
          actionKey: "cerebro_followup",
        });
        if (!eff.canSend) {
          skipCount++;
          await releaseTouch();
          continue;
        }

        // Envia pelo canal resolvido (Whapi/Evolution)
        const remoteJid = `${(c as any).whatsapp_chat_id || c.phone_whatsapp}@s.whatsapp.net`;
        await markEffectSending(supabase, eff.effectId);
        let sent = false;
        let sendThrew = false;
        try {
          const sendCtx = {
            ...ctx(c.consultant_id || "system", c.id, "process-followups", String(attempts + 1)),
            supabase,
          };
          const r = await channel.adapter.sendText(remoteJid, reply, sendCtx as any);
          sent = !!r.ok;
        } catch (e: any) {
          sendThrew = true;
          errors.push({ id: c.id, phase: "send", channel: channelTag, error: String(e?.message || e).slice(0, 200) });
        }

        if (!sent) {
          errCount++;
          // Exceção durante a chamada = ambíguo (unknown); retorno false = retryable.
          await finishOutboundEffect(supabase, eff.effectId, sendThrew ? "unknown" : "failed_retryable", {
            errorCode: sendThrew ? "send_exception" : "send_failed",
          });
          await rescheduleFollowup(supabase, c.id, RETRY_DELAY_MIN, attempts + 1);
          await releaseTouch();
          continue;
        }

        await finishOutboundEffect(supabase, eff.effectId, "sent");
        touchOpen = false;
        await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "done");

        // SUCESSO: persiste conversa + zera schedule
        await supabase.from("conversations").insert({
          customer_id: c.id,
          message_direction: "outbound",
          message_text: reply,
          message_type: "text",
          conversation_step: aiResult?.conversationStepUpdate || c.conversation_step || "fluxo_b_ai",
          origin: "automation:process-followups",
        });
        await supabase.from("customers").update({
          next_followup_at: null,
          last_followup_at: new Date().toISOString(),
          followup_count: attempts + 1,
          followup_hook: null,
        }).eq("id", c.id);

        okCount++;
        console.log(`[process-followups] sent customer=${c.id} channel=${channelTag} latency=${Date.now() - t0}ms`);
      } catch (e: any) {
        errCount++;
        errors.push({ id: c.id, phase: "loop", error: String(e?.message || e).slice(0, 200) });
      }
    }

    return json({
      ok: true,
      processed: rows.length,
      sent: okCount,
      failed: errCount,
      skipped: skipCount,
      errors: errors.slice(0, 10),
    });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

async function rescheduleFollowup(supabase: any, customerId: string, minutes: number, newCount: number) {
  const next = new Date(Date.now() + minutes * 60_000).toISOString();
  await supabase.from("customers").update({
    next_followup_at: next,
    followup_count: newCount,
  }).eq("id", customerId);
}

async function cancelFollowup(supabase: any, customerId: string, reason: string) {
  await supabase.from("customers").update({
    next_followup_at: null,
    followup_hook: null,
  }).eq("id", customerId);
  console.log(`[process-followups] cancel customer=${customerId} reason=${reason}`);
}