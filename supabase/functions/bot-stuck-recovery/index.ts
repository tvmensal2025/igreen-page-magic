// AI Rescue Cron — substitui o antigo bot-stuck-recovery scriptado.
// Roda a cada 5 min. Para cada lead parado:
//   1) Verifica se a instância Evolution do consultor está online (status != needs_reconnect).
//   2) Verifica cooldown (next_rescue_allowed_at).
//   3) Chama ai-sales-agent com mode:"rescue" — a IA gera mensagem com a persona Camila
//      (sem emoji, sem texto canned), respeitando histórico.
//   4) Envia via Evolution. SÓ incrementa rescue_attempts se o envio retornar true.
//   5) Após N tentativas reais sem resposta, marca stuck_* para fila manual.
//   6) Após 24h, marca abandoned.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createEvolutionSender } from "../_shared/evolution-api.ts";
import { captureError } from "../_shared/sentry.ts";
import { isQuietHourBRT, logQuietSkip } from "../_shared/quiet-hours.ts";
import { isConsultantAIDisabled } from "../_shared/bot/paused.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { gateProactiveTouch, recordProactiveTouch } from "../_shared/retention-orchestrator.ts";
import { LEAD_ORIGIN_FILTER } from "../_shared/origin-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAGE1_MIN = 10;       // mínimo 10 min idle p/ não pisar em conversa ativa
const STAGE3_MIN = 24 * 60;  // 24h → abandono
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
  // Fases finais (antigo ai-closer-cron mesclado aqui)
  "fechamento", "coleta_doc", "coleta_dados", "objecoes", "cadastro_portal",
]);

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
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
    scanned: 0, rescued: 0, abandoned: 0,
    skipped_cooldown: 0, skipped_offline: 0, skipped_recent_button: 0,
    skipped_global_off: 0,
    stuck_marked: 0, send_failed: 0, ai_failed: 0,
  };

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    if (!(await isBotGloballyEnabled(supabase))) {
      return new Response(JSON.stringify({ skipped: "bot_globally_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Toggle granular (nasce OFF). Antes só o kill switch global bloqueava.
    if (!(await isAutomationEnabled(supabase, "bot_stuck_recovery"))) {
      await logSkipped(supabase, "bot_stuck_recovery");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "bot_stuck_recovery" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return new Response(JSON.stringify({ error: "Evolution API não configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const cutoff = new Date(Date.now() - STAGE1_MIN * 60_000).toISOString();
    const nowIso = new Date().toISOString();

    // 1) Cache de instâncias offline → pular consultores inteiros
    const { data: offlineInstances } = await supabase
      .from("whatsapp_instances")
      .select("consultant_id, instance_name, status")
      .eq("status", "needs_reconnect");
    const offlineConsultants = new Set((offlineInstances || []).map((i: any) => i.consultant_id));

    // Body opcional: customer_ids p/ rescue manual via UI
    let customerIds: string[] | null = null;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (Array.isArray(body?.customer_ids) && body.customer_ids.length > 0) {
          customerIds = body.customer_ids.filter((x: any) => typeof x === "string");
        }
      }
    } catch { /* ignore */ }

    let query = supabase
      .from("customers")
      .select("id, phone_whatsapp, consultant_id, conversation_step, last_bot_reply_at, name, rescue_attempts, last_rescue_at, status, next_rescue_allowed_at, bot_paused, bot_paused_until, customer_origin");

    if (customerIds && customerIds.length > 0) {
      query = query.in("id", customerIds);
    } else {
      query = query
        .lt("last_bot_reply_at", cutoff)
        .in("conversation_step", Array.from(RESCUABLE_STEPS))
        .eq("bot_paused", false)
        .is("assigned_human_id", null)
        // Respeita pausa programada (postpone-intent: "te mando amanhã").
        // Sem isso, rescue dispara mesmo após cliente pedir tempo.
        .or("bot_paused_until.is.null,bot_paused_until.lt." + nowIso)
        // Regra de ouro: carteira iGreen nunca recebe resgate automático.
        .or(LEAD_ORIGIN_FILTER)
        .not("status", "in", "(complete,cadastro_concluido,portal_submitting,registered_igreen,approved,active,awaiting_signature,automation_failed,abandoned)")
        .order("last_bot_reply_at", { ascending: true })
        .limit(MAX_RESCUES_PER_RUN);
    }

    const { data: stuck, error } = await query;
    if (error) throw error;

    // Semana 1 do rollout v3: aplica filtro batch só no caminho automático.
    // No caminho manual (customerIds via UI), o operador escolheu — respeita.
    let stuckList: any[] = stuck || [];
    if (!customerIds || customerIds.length === 0) {
      const { filterSendableCustomers } = await import("../_shared/cron-pause-batch.ts");
      const allowed = new Set(
        await filterSendableCustomers(supabase, stuckList.map((l: any) => l.id), { cronName: "bot-stuck-recovery" }),
      );
      stuckList = stuckList.filter((l: any) => allowed.has(l.id));
    }

    stats.scanned = stuckList.length;
    console.log(`🔍 ${stats.scanned} leads candidatos (cutoff ${cutoff})`);

    for (const lead of stuckList) {
      const step = lead.conversation_step || "";
      if (!RESCUABLE_STEPS.has(step) || !lead.consultant_id) continue;

      // Cooldown lock
      if (lead.next_rescue_allowed_at && lead.next_rescue_allowed_at > nowIso) {
        stats.skipped_cooldown++;
        continue;
      }

      // Instância offline → pula sem registrar tentativa (não é falha do lead)
      if (offlineConsultants.has(lead.consultant_id)) {
        stats.skipped_offline++;
        continue;
      }

      // 🛑 Gate global: IA do consultor desligada → silêncio total
      if (await isConsultantAIDisabled(supabase, lead.consultant_id)) {
        stats.skipped_global_off++;
        continue;
      }

      const idleMinutes = (Date.now() - new Date(lead.last_bot_reply_at).getTime()) / 60_000;
      const attempts = lead.rescue_attempts || 0;

      // ESTÁGIO 3: 24h → abandonar
      if (idleMinutes >= STAGE3_MIN) {
        await supabase.from("customers").update({
          status: "abandoned",
          error_message: `Lead abandonado após 24h sem resposta no step ${step}`,
        }).eq("id", lead.id);
        stats.abandoned++;
        continue;
      }

      // Após N tentativas reais → fila manual
      if (attempts >= MAX_ATTEMPTS_BEFORE_STUCK) {
        let newStatus: string | null = null;
        if (FINALIZAR_STEPS.has(step)) newStatus = "stuck_finalizar";
        else if (CONTACT_STEPS.has(step)) newStatus = "stuck_contact";
        if (newStatus) {
          await supabase.from("customers").update({
            status: newStatus,
            error_message: `Travado em ${step} após ${attempts} resgates sem resposta`,
          }).eq("id", lead.id);
          stats.stuck_marked++;
          continue;
        }
      }

      try {
        // Pular se a última saída foi botão interativo nos últimos 15 min — usuário ainda pode clicar
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
          const isButtons = lastOut.message_type === "buttons"
            || /\[bot[oõ]es enviados\]/i.test(lastOut.message_text || "");
          if (isButtons && ageMin < 15) {
            stats.skipped_recent_button++;
            // Estende cooldown p/ não tentar de novo logo
            await supabase.from("customers").update({
              next_rescue_allowed_at: new Date(Date.now() + 20 * 60_000).toISOString(),
            }).eq("id", lead.id);
            continue;
          }
        }

        // Buscar instance_name do consultor
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("instance_name, status")
          .eq("consultant_id", lead.consultant_id)
          .maybeSingle();
        if (!inst?.instance_name || inst.status === "needs_reconnect") {
          stats.skipped_offline++;
          continue;
        }

        // Cérebro IA em modo rescue (nudge de reaquecimento). Substitui
        // a chamada antiga ao ai-sales-agent (vendedora apagada).
        const { executarFollowupCerebro } = await import("../_shared/cerebro/followup-hook.ts");
        const cerebro = await executarFollowupCerebro({
          supabase,
          customerId: lead.id,
          consultantId: lead.consultant_id,
          channel: "evolution",
        });

        if (!cerebro.usouCerebro || cerebro.shouldHandoff) {
          // Sem rescue (handoff/cérebro desligado) — cooldown e segue.
          await supabase.from("customers").update({
            next_rescue_allowed_at: new Date(Date.now() + COOLDOWN_AFTER_RESCUE_MIN * 60_000).toISOString(),
          }).eq("id", lead.id);
          continue;
        }

        const message = (cerebro.reply || "").trim();
        if (!message || message.length < 3) {
          stats.ai_failed++;
          continue;
        }

        if (!(await gateProactiveTouch(supabase, lead.id, "bot_stuck_recovery"))) {
          continue;
        }

        const _raw = createEvolutionSender(EVOLUTION_API_URL, EVOLUTION_API_KEY, inst.instance_name);
        const { wrapSenderWithGuard } = await import("../_shared/sender-guard.ts");
        const sender = wrapSenderWithGuard(_raw, { supabase, instanceName: inst.instance_name });
        const remoteJid = `${lead.phone_whatsapp}@s.whatsapp.net`;
        const sent = await sender.sendText(remoteJid, message);

        if (!sent) {
          // Não conta tentativa em falha de envio. Cooldown curto p/ retentar em 10min.
          stats.send_failed++;
          await supabase.from("customers").update({
            next_rescue_allowed_at: new Date(Date.now() + 10 * 60_000).toISOString(),
          }).eq("id", lead.id);
          continue;
        }

        await recordProactiveTouch(supabase, lead.id, "bot_stuck_recovery");
        stats.rescued++;
        await supabase.from("customers").update({
          last_bot_reply_at: nowIso,
          last_rescue_at: nowIso,
          ai_last_rescue_at: nowIso,
          rescue_attempts: attempts + 1,
          ai_rescue_count: (lead as any).ai_rescue_count ? (lead as any).ai_rescue_count + 1 : 1,
          next_rescue_allowed_at: new Date(Date.now() + COOLDOWN_AFTER_RESCUE_MIN * 60_000).toISOString(),
        }).eq("id", lead.id);
        await supabase.from("conversations").insert({
          customer_id: lead.id,
          message_direction: "outbound",
          message_text: message,
          message_type: "text",
          conversation_step: step,
        });
        console.log(`✅ Rescue ${lead.id} step:${step} idle:${Math.round(idleMinutes)}min`);
      } catch (e: any) {
        stats.ai_failed++;
        console.error(`❌ Rescue failed ${lead.id}:`, e?.message);
        captureError(e, { tags: { function: "bot-stuck-recovery" }, extra: { customer_id: lead.id, step } });
      }
    }

    const duration = Date.now() - startedAt;
    console.log(`📊 Done in ${duration}ms`, stats);
    return new Response(JSON.stringify({ ok: true, duration_ms: duration, ...stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("Bot rescue error:", err);
    captureError(err, { tags: { function: "bot-stuck-recovery" } });
    return new Response(JSON.stringify({ error: String(err?.message || err), stats }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
