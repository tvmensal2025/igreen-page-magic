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
import { createWhapiSender } from "../_shared/whapi-api.ts";
import { createEvolutionSender } from "../_shared/evolution-api.ts";
import { isQuietHourBRT } from "../_shared/quiet-hours.ts";
import { LEAD_ORIGIN_FILTER } from "../_shared/origin-guard.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { gateProactiveTouch, recordProactiveTouch } from "../_shared/retention-orchestrator.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
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
    if (!(await isAutomationEnabled(supabase, "process_followups"))) {
      await logSkipped(supabase, "process_followups");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "process_followups" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }


    // Auth: aceita cron interno (x-internal-secret == embed_internal_token) ou Bearer admin.
    const internalSecret = req.headers.get("x-internal-secret") || "";
    let expectedInternal = Deno.env.get("EMBED_INTERNAL_SECRET") || "";
    if (!expectedInternal) {
      const { data: s } = await supabase.from("settings").select("value").eq("key", "embed_internal_token").maybeSingle();
      expectedInternal = String(s?.value || "");
    }
    const isInternal = !!expectedInternal && !!internalSecret && internalSecret === expectedInternal;

    if (!isInternal) {
      const authz = req.headers.get("authorization") || "";
      const jwt = authz.replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ error: "unauthorized" }, 401);
      const { data: userData } = await supabase.auth.getUser(jwt);
      if (!userData?.user) return json({ error: "unauthorized" }, 401);
      const { data: roleRow } = await supabase
        .from("user_roles").select("role").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
      if (!roleRow) return json({ error: "forbidden" }, 403);
    }

    // Quiet hours: pula execução (cron volta em 5min).
    if (isQuietHourBRT()) {
      return json({ ok: true, skipped: "quiet_hours" });
    }

    const now = new Date().toISOString();
    const { data: due, error } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, conversation_step, consultant_id, next_followup_at, followup_hook, bot_paused, bot_paused_until, variant_id, followup_count, assigned_human_id, flow_variant, customer_origin")
      .lte("next_followup_at", now)
      .eq("bot_paused", false)
      .eq("do_not_contact", false)
      // Pausa temporária ("me chama amanhã" → bot_paused_until) também bloqueia
      // follow-up. Antes só o booleano bot_paused era respeitado.
      .or(`bot_paused_until.is.null,bot_paused_until.lte.${now}`)
      .is("assigned_human_id", null)
      // Regra de ouro: carteira iGreen nunca recebe automação. Helper
      // compartilhado em _shared/origin-guard.ts.
      .or(LEAD_ORIGIN_FILTER)
      .limit(50);
    if (error) return json({ error: error.message }, 500);

    // Defesa em profundidade: mesmo que um agendamento órfão sobreviva, um lead
    // em passo terminal (portal/OTP/assinatura/completo) já concluiu o fluxo e
    // não deve receber nudge. Espelha TERMINAL_STEPS do bot-followup-checker.
    // A checagem de bot_paused_until é repetida aqui caso a query mude no futuro.
    const rows = (due || []).filter((c: any) =>
      !TERMINAL_STEPS.has(c.conversation_step || "") &&
      !(c.bot_paused_until && new Date(c.bot_paused_until).getTime() > Date.now())
    );
    if (rows.length === 0) return json({ ok: true, processed: 0 });

    // Carrega credenciais Whapi global (fallback)
    const { data: settingsRows } = await supabase.from("settings").select("key, value");
    const settings: Record<string, string> = {};
    (settingsRows || []).forEach((s: any) => { settings[s.key] = s.value; });
    const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
    const whapiBaseUrl = settings.whapi_api_url || "https://gate.whapi.cloud";
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL") || "";
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY") || "";

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

        if (!(await gateProactiveTouch(supabase, c.id, "process_followups"))) {
          skipCount++;
          continue;
        }

        const gate = await assertBotOutboundAllowed(supabase, {
          customerId: c.id,
          phone: c.phone_whatsapp,
          consultantId: c.consultant_id,
        });
        if (!gate.allowed) {
          skipCount++;
          continue;
        }

        const attempts = Number(c.followup_count || 0);
        if (attempts >= MAX_FOLLOWUP_ATTEMPTS) {
          await cancelFollowup(supabase, c.id, "max_attempts");
          skipCount++;
          continue;
        }

        // Resolve canal via whatsapp_instances do consultor
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("instance_name, status")
          .eq("consultant_id", c.consultant_id)
          .eq("status", "connected")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let sender: any = null;
        let channelTag = "";
        if (inst?.instance_name && /^whapi/i.test(inst.instance_name) && whapiToken) {
          sender = createWhapiSender(whapiToken, whapiBaseUrl);
          channelTag = "whapi";
        } else if (inst?.instance_name && evolutionUrl && evolutionKey) {
          sender = createEvolutionSender(evolutionUrl, evolutionKey, inst.instance_name);
          channelTag = `evolution:${inst.instance_name}`;
        } else if (whapiToken) {
          // Fallback legado: Whapi global (compatível com bot-followup-checker)
          sender = createWhapiSender(whapiToken, whapiBaseUrl);
          channelTag = "whapi:fallback";
        } else {
          // Sem canal disponível: reagenda em 30min, sem consumir tentativa
          await rescheduleFollowup(supabase, c.id, 30, attempts);
          skipCount++;
          errors.push({ id: c.id, reason: "no_channel_available" });
          continue;
        }

        // Cérebro IA é fonte única do nudge (vendedora apagada). Como
        // cerebro_ativo='on' é default global, executarFollowupCerebro sempre
        // assume. Em handoff/empty_reply, reagenda sem cair em código morto.
        const t0 = Date.now();
        let aiResult: any = null;

        const canalFollowup = channelTag.startsWith("whapi") ? "whapi" : "evolution";
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
          continue;
        }

        // Envia pelo canal escolhido
        const remoteJid = `${c.phone_whatsapp}@s.whatsapp.net`;
        let sent = false;
        try {
          const r = await sender.sendText(remoteJid, reply);
          sent = r === true || (r && (r.ok === true || r.messageId));
          if (sent === undefined || sent === null) sent = true; // whapi sender retorna boolean
        } catch (e: any) {
          errors.push({ id: c.id, phase: "send", channel: channelTag, error: String(e?.message || e).slice(0, 200) });
        }

        if (!sent) {
          errCount++;
          await rescheduleFollowup(supabase, c.id, RETRY_DELAY_MIN, attempts + 1);
          continue;
        }

        await recordProactiveTouch(supabase, c.id, "process_followups");

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