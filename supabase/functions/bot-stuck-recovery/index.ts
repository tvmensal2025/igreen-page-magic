// AI Rescue Cron — bot-stuck-recovery.
// Roda a cada 10 min (pg_cron). Para cada lead parado:
//   1) Resolve canal do lead (Whapi OU Evolution) via channel-sender + failover.
//   2) Verifica cooldown (next_rescue_allowed_at).
//   3) Gera texto via Cérebro (mode rescue / followup-hook).
//   4) Envia no canal resolvido. SÓ incrementa rescue_attempts se o envio ok.
//   5) Após N tentativas reais sem resposta, marca stuck_* para fila manual.
//   6) Após 24h, marca abandoned.
//
// Paridade Whapi/Evolution: NÃO usa mais createEvolutionSender nem trata
// whatsapp_instances.status=needs_reconnect como “Zap offline” (falso para Whapi).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isUnavailable,
  resolveChannelForCustomerWithFailover,
} from "../_shared/channel-sender.ts";
import { loadChannelEnv } from "../_shared/attendance-channel-env.ts";
import { checkSendQuota, registerSend } from "../_shared/anti-ban.ts";
import { normalizePhone } from "../_shared/utils.ts";
import { captureError } from "../_shared/sentry.ts";
import { isQuietHourBRT, logQuietSkip } from "../_shared/quiet-hours.ts";
import { isConsultantAIDisabled } from "../_shared/bot/paused.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import {
  finishOutboundEffect,
  finishProactiveTouch,
  markEffectSending,
  reserveOutboundEffect,
  reserveProactiveTouch,
} from "../_shared/journey-effects.ts";
import { LEAD_ORIGIN_FILTER } from "../_shared/origin-guard.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret, x-service-secret",
};

const STAGE1_MIN = 10; // mínimo 10 min idle p/ não pisar em conversa ativa
const STAGE3_MIN = 24 * 60; // 24h → abandono
const MAX_RESCUES_PER_RUN = 30;
const COOLDOWN_AFTER_RESCUE_MIN = 45;
const MAX_ATTEMPTS_BEFORE_STUCK = 3;

const FINALIZAR_STEPS = new Set(["ask_finalizar", "finalizando"]);
const CONTACT_STEPS = new Set(["ask_phone_confirm", "ask_phone", "ask_email"]);

const RESCUABLE_STEPS = new Set([
  "welcome", "menu_inicial", "pos_video",
  "aguardando_conta", "confirmando_dados_conta",
  "ask_tipo_documento", "aguardando_doc_frente", "aguardando_doc_verso",
  "confirmando_dados_doc",
  "ask_name", "ask_cpf", "ask_rg", "ask_birth_date",
  "ask_phone_confirm", "ask_phone", "ask_email",
  "ask_cep", "ask_number", "ask_complement",
  "ask_installation_number", "ask_bill_value",
  "ask_distribuidora",
  "ask_doc_frente_manual", "ask_doc_verso_manual",
  "ask_finalizar",
  "editing_conta_menu", "editing_conta_nome", "editing_conta_endereco",
  "editing_conta_cep", "editing_conta_distribuidora", "editing_conta_instalacao",
  "editing_conta_valor",
  "editing_doc_menu", "editing_doc_nome", "editing_doc_cpf",
  "editing_doc_rg", "editing_doc_nascimento",
  "fechamento", "coleta_doc", "coleta_dados", "objecoes", "cadastro_portal",
]);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (isQuietHourBRT()) {
    logQuietSkip("bot-stuck-recovery");
    return new Response(JSON.stringify({ skipped: "quiet_hours" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const stats = {
    scanned: 0,
    rescued: 0,
    abandoned: 0,
    skipped_cooldown: 0,
    skipped_offline: 0,
    skipped_recent_button: 0,
    skipped_global_off: 0,
    stuck_marked: 0,
    send_failed: 0,
    ai_failed: 0,
  };

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const cronAuth = await assertCronAuth(req, supabase);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

    if (!(await isBotGloballyEnabled(supabase))) {
      return new Response(JSON.stringify({ skipped: "bot_globally_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!(await isAutomationEnabled(supabase, "bot_stuck_recovery"))) {
      await logSkipped(supabase, "bot_stuck_recovery");
      return new Response(
        JSON.stringify({ skipped: "automation_disabled", key: "bot_stuck_recovery" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const channelEnv = await loadChannelEnv(supabase);
    if (!channelEnv.whapiToken && !(channelEnv.evolutionUrl && channelEnv.evolutionKey)) {
      return new Response(
        JSON.stringify({ error: "Nenhum canal WhatsApp configurado (Whapi ou Evolution)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cutoff = new Date(Date.now() - STAGE1_MIN * 60_000).toISOString();
    const nowIso = new Date().toISOString();

    // Body opcional: customer_ids p/ rescue manual via UI
    let customerIds: string[] | null = null;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (Array.isArray(body?.customer_ids) && body.customer_ids.length > 0) {
          customerIds = body.customer_ids.filter((x: unknown) => typeof x === "string");
        }
      }
    } catch { /* ignore */ }

    let query = supabase
      .from("customers")
      .select(
        "id, phone_whatsapp, whatsapp_chat_id, consultant_id, conversation_step, last_bot_reply_at, name, rescue_attempts, last_rescue_at, status, next_rescue_allowed_at, bot_paused, bot_paused_until, customer_origin, ai_rescue_count",
      );

    if (customerIds && customerIds.length > 0) {
      query = query.in("id", customerIds);
    } else {
      query = query
        .lt("last_bot_reply_at", cutoff)
        .in("conversation_step", Array.from(RESCUABLE_STEPS))
        .eq("bot_paused", false)
        .eq("do_not_contact", false)
        .is("assigned_human_id", null)
        .or("bot_paused_until.is.null,bot_paused_until.lt." + nowIso)
        .or(LEAD_ORIGIN_FILTER)
        .not(
          "status",
          "in",
          "(complete,cadastro_concluido,portal_submitting,registered_igreen,approved,active,awaiting_signature,automation_failed,abandoned)",
        )
        .order("last_bot_reply_at", { ascending: true })
        .limit(MAX_RESCUES_PER_RUN);
    }

    const { data: stuck, error } = await query;
    if (error) throw error;

    let stuckList: any[] = stuck || [];
    if (!customerIds || customerIds.length === 0) {
      const { filterSendableCustomers } = await import("../_shared/cron-pause-batch.ts");
      const allowed = new Set(
        await filterSendableCustomers(supabase, stuckList.map((l: any) => l.id), {
          cronName: "bot-stuck-recovery",
        }),
      );
      stuckList = stuckList.filter((l: any) => allowed.has(l.id));
    }

    stats.scanned = stuckList.length;
    console.log(`🔍 ${stats.scanned} leads candidatos (cutoff ${cutoff})`);

    for (const lead of stuckList) {
      const step = lead.conversation_step || "";
      if (!RESCUABLE_STEPS.has(step) || !lead.consultant_id) continue;

      if (lead.next_rescue_allowed_at && lead.next_rescue_allowed_at > nowIso) {
        stats.skipped_cooldown++;
        continue;
      }

      // deno-lint-ignore no-explicit-any
      if (await isConsultantAIDisabled(supabase as any, lead.consultant_id)) {
        stats.skipped_global_off++;
        continue;
      }

      const idleMinutes =
        (Date.now() - new Date(lead.last_bot_reply_at).getTime()) / 60_000;
      const attempts = lead.rescue_attempts || 0;

      if (idleMinutes >= STAGE3_MIN) {
        await supabase.from("customers").update({
          status: "abandoned",
          error_message: `Lead abandonado após 24h sem resposta no step ${step}`,
        }).eq("id", lead.id);
        stats.abandoned++;
        continue;
      }

      if (attempts >= MAX_ATTEMPTS_BEFORE_STUCK) {
        // Sempre para de resgatar após o teto — antes só FINALIZAR/CONTACT
        // marcavam stuck e os demais steps continuavam enviando até 24h.
        let newStatus: string | null = null;
        if (FINALIZAR_STEPS.has(step)) newStatus = "stuck_finalizar";
        else if (CONTACT_STEPS.has(step)) newStatus = "stuck_contact";
        await supabase.from("customers").update({
          ...(newStatus ? { status: newStatus } : {}),
          error_message: `Travado em ${step} após ${attempts} resgates sem resposta`,
          // Empurra cooldown longe para o scan não martelar o mesmo lead.
          next_rescue_allowed_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        }).eq("id", lead.id);
        stats.stuck_marked++;
        continue;
      }

      try {
        const { data: lastOut } = await supabase
          .from("conversations")
          .select("message_type, message_text, created_at")
          .eq("customer_id", lead.id)
          .eq("message_direction", "outbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastOut) {
          const ageMin = (Date.now() - new Date(lastOut.created_at).getTime()) / 60_000;
          const isButtons = lastOut.message_type === "buttons" ||
            /\[bot[oõ]es enviados\]/i.test(lastOut.message_text || "");
          if (isButtons && ageMin < 15) {
            stats.skipped_recent_button++;
            await supabase.from("customers").update({
              next_rescue_allowed_at: new Date(Date.now() + 20 * 60_000).toISOString(),
            }).eq("id", lead.id);
            continue;
          }
        }

        // Canal real do lead (Whapi ou Evolution) — mesmo resolvedor da cadência.
        const channel = await resolveChannelForCustomerWithFailover(
          supabase,
          lead.id,
          channelEnv,
        );
        if (isUnavailable(channel)) {
          console.warn(
            `[bot-stuck-recovery] canal indisponível lead=${lead.id} reason=${channel.reason} detail=${channel.detail}`,
          );
          stats.skipped_offline++;
          continue;
        }

        const { executarFollowupCerebro } = await import("../_shared/cerebro/followup-hook.ts");
        const cerebro = await executarFollowupCerebro({
          supabase,
          customerId: lead.id,
          consultantId: lead.consultant_id,
          channel: channel.kind,
        });

        if (!cerebro.usouCerebro || cerebro.shouldHandoff) {
          await supabase.from("customers").update({
            next_rescue_allowed_at: new Date(
              Date.now() + COOLDOWN_AFTER_RESCUE_MIN * 60_000,
            ).toISOString(),
          }).eq("id", lead.id);
          continue;
        }

        const message = (cerebro.reply || "").trim();
        if (!message || message.length < 3) {
          stats.ai_failed++;
          continue;
        }

        const touch = await reserveProactiveTouch(supabase, lead.id, "bot_stuck_recovery", {
          step,
        });
        if (!touch.allowed) continue;

        const gate = await assertBotOutboundAllowed(supabase, {
          customerId: lead.id,
          phone: lead.phone_whatsapp,
          consultantId: lead.consultant_id,
        });
        if (!gate.allowed) {
          await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
          continue;
        }

        const quota = await checkSendQuota(supabase, channel.instanceName);
        if (!quota.allowed) {
          console.warn(
            `[bot-stuck-recovery] quota blocked ${channel.instanceName}: ${quota.reason}`,
          );
          await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
          stats.skipped_offline++;
          continue;
        }

        // Chave estável por tentativa de resgate (attempts só sobe no sucesso).
        const rescueKey = `rescue:${lead.id}:${step}:${attempts + 1}`;
        const eff = await reserveOutboundEffect(supabase, {
          idempotencyKey: rescueKey,
          engineKey: "bot_stuck_recovery",
          channel: "whatsapp",
          customerId: lead.id,
          consultantId: lead.consultant_id,
          actionKey: `step:${step}`,
        });
        if (!eff.canSend) {
          await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
          continue;
        }

        const digits = normalizePhone(
          (lead as { whatsapp_chat_id?: string | null }).whatsapp_chat_id ||
            lead.phone_whatsapp,
        ).replace(/\D/g, "");
        if (digits.length < 12) {
          stats.send_failed++;
          await finishOutboundEffect(supabase, eff.effectId, "failed_retryable", {
            errorCode: "invalid_phone",
          });
          await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
          continue;
        }
        const jid = `${digits}@s.whatsapp.net`;
        const sendCtx = {
          customerId: lead.id,
          consultantId: lead.consultant_id,
          stepId: `rescue:${step}`,
          idempotencyKey: rescueKey,
          supabase,
        };

        await markEffectSending(supabase, eff.effectId);
        const result = await channel.adapter.sendText(jid, message, sendCtx);

        if (!result.ok) {
          stats.send_failed++;
          await finishOutboundEffect(supabase, eff.effectId, "failed_retryable", {
            errorCode: "send_failed",
          });
          await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
          await supabase.from("customers").update({
            next_rescue_allowed_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          }).eq("id", lead.id);
          continue;
        }

        await finishOutboundEffect(supabase, eff.effectId, "sent");
        await registerSend(supabase, channel.instanceName);
        await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "done");
        stats.rescued++;
        await supabase.from("customers").update({
          last_bot_reply_at: nowIso,
          last_rescue_at: nowIso,
          ai_last_rescue_at: nowIso,
          rescue_attempts: attempts + 1,
          ai_rescue_count: (lead.ai_rescue_count || 0) + 1,
          next_rescue_allowed_at: new Date(
            Date.now() + COOLDOWN_AFTER_RESCUE_MIN * 60_000,
          ).toISOString(),
        }).eq("id", lead.id);
        await supabase.from("conversations").insert({
          customer_id: lead.id,
          message_direction: "outbound",
          message_text: message,
          message_type: "text",
          conversation_step: step,
          origin: `automation:bot-stuck-recovery:${channel.kind}`,
        });
        console.log(
          `✅ Rescue ${lead.id} via ${channel.kind}/${channel.instanceName} step:${step} idle:${Math.round(idleMinutes)}min`,
        );
      } catch (e: any) {
        stats.ai_failed++;
        console.error(`❌ Rescue failed ${lead.id}:`, e?.message);
        captureError(e, {
          tags: { function: "bot-stuck-recovery" },
          extra: { customer_id: lead.id, step },
        });
      }
    }

    const duration = Date.now() - startedAt;
    console.log(`📊 Done in ${duration}ms`, stats);
    return new Response(JSON.stringify({ ok: true, duration_ms: duration, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Bot rescue error:", err);
    captureError(err, { tags: { function: "bot-stuck-recovery" } });
    return new Response(JSON.stringify({ error: String(err?.message || err), stats }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
