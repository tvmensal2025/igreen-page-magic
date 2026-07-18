/**
 * bot-followup-checker
 *
 * Roda via pg_cron (a cada 30min). Identifica clientes que sumiram no meio
 * da conversa e dispara um follow-up amigável via Whapi.
 *
 * Regras:
 *  - last_bot_interaction_at entre 6h e 48h atrás
 *  - bot_paused_until = null
 *  - followup_count = 0
 *  - conversation_step não está em cadastro/finalizado
 *
 * Após 48h sem resposta ao follow-up: marca deal CRM como 'frio'.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createWhapiSender } from "../_shared/whapi-api.ts";
import { isQuietHourBRT, logQuietSkip } from "../_shared/quiet-hours.ts";
import { filterSendableCustomers } from "../_shared/cron-pause-batch.ts";
import { LEAD_ORIGIN_FILTER } from "../_shared/origin-guard.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { loadAutomationTemplate } from "../_shared/automation-templates.ts";
import {
  finishOutboundEffect,
  finishProactiveTouch,
  markEffectSending,
  reserveOutboundEffect,
  reserveProactiveTouch,
} from "../_shared/journey-effects.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import { assertBotOutboundAllowed } from "../_shared/bot/outbound-gate.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

const TERMINAL_STEPS = new Set([
  "complete", "portal_submitting", "portal_submitted", "registered_igreen",
  "awaiting_signature", "finalizando", "validando_otp", "aguardando_humano",
  "aguardando_avaliacao_atendimento", "atendimento_finalizado",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (isQuietHourBRT()) {
    logQuietSkip("bot-followup-checker");
    return new Response(JSON.stringify({ skipped: "quiet_hours" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const cronAuth = await assertCronAuth(req, supabase);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

    // Toggle próprio (antes pegava carona em process_followups — impossível
    // desligar um sem o outro). Nasce OFF; ligar na Central de Agendamentos.
    if (!(await isAutomationEnabled(supabase, "bot_followup_checker"))) {
      await logSkipped(supabase, "bot_followup_checker");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "bot_followup_checker" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }


    const { data: settingsRows } = await supabase.from("settings").select("*");
    const settings: Record<string, string> = {};
    settingsRows?.forEach((s: any) => { settings[s.key] = s.value; });
    const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
    if (!whapiToken) {
      return new Response(JSON.stringify({ error: "no whapi token" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sender = createWhapiSender(whapiToken);

    const now = Date.now();
    const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();

    // ─── 1. Candidatos a follow-up #1 ────────────────────────────────
    const { data: candidates } = await supabase
      .from("customers")
      .select("id, name, phone_whatsapp, conversation_step, followup_count, last_bot_interaction_at, consultant_id")
      .lte("last_bot_interaction_at", sixHoursAgo)
      .gte("last_bot_interaction_at", fortyEightHoursAgo)
      .eq("followup_count", 0)
      .is("bot_paused_until", null)
      .eq("bot_paused", false)
      .eq("do_not_contact", false)
      .is("assigned_human_id", null)
      // Regra de ouro: carteira iGreen nunca recebe automação. Helper compartilhado.
      .or(LEAD_ORIGIN_FILTER)
      .limit(50);

    // Semana 1 do rollout v3: filtra batch por customer_flow_state.status.
    const candidateAllowed = new Set(
      await filterSendableCustomers(supabase, (candidates ?? []).map((c: any) => c.id), { cronName: "bot-followup-checker:candidates" }),
    );

    let sent = 0;
    for (const c of (candidates || []).filter((c: any) => candidateAllowed.has(c.id))) {
      if (TERMINAL_STEPS.has(c.conversation_step || "")) continue;
      if (!c.phone_whatsapp) continue;

      // Orquestrador atômico (fail-closed) no lugar do check-then-act legado.
      const touch = await reserveProactiveTouch(supabase, c.id, "bot_followup_checker", {
        step: c.conversation_step,
      });
      if (!touch.allowed) continue;

      const gate = await assertBotOutboundAllowed(supabase, {
        customerId: c.id,
        phone: c.phone_whatsapp,
        consultantId: c.consultant_id,
      });
      if (!gate.allowed) {
        await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
        continue;
      }

      // Follow-up #1 é único por cliente (candidatos têm followup_count=0):
      // chave estável — dois crons simultâneos não duplicam.
      const eff = await reserveOutboundEffect(supabase, {
        idempotencyKey: `bot_followup:${c.id}:1`,
        engineKey: "bot_followup_checker",
        channel: "whatsapp",
        customerId: c.id,
        consultantId: c.consultant_id,
        actionKey: "followup_sumiu_1",
      });
      if (!eff.canSend) {
        await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
        continue;
      }

      const firstName = (c.name || "").split(" ")[0] || "";
      const fallback = firstName
        ? `Oi ${firstName}, aqui é da *iGreen*.\n\nVi que sua simulação da conta de luz ficou pendente. Posso retomar de onde paramos — é só responder por aqui.`
        : `Oi, aqui é da *iGreen*.\n\nVi que sua simulação da conta de luz ficou pendente. Posso retomar de onde paramos — é só responder por aqui.`;
      const msg = await loadAutomationTemplate(
        supabase,
        "bot_followup_sumiu",
        fallback,
        { nome: firstName },
        c.consultant_id,
      );
      try {
        await markEffectSending(supabase, eff.effectId);
        await sender.sendText(`${c.phone_whatsapp}@s.whatsapp.net`, msg);
        await finishOutboundEffect(supabase, eff.effectId, "sent");
        await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "done");
        await supabase.from("customers").update({
          followup_count: 1,
          last_followup_at: new Date().toISOString(),
        }).eq("id", c.id);
        await supabase.from("conversations").insert({
          customer_id: c.id,
          message_direction: "outbound",
          message_text: msg,
          message_type: "text",
          conversation_step: c.conversation_step,
          origin: "automation:bot-followup-checker",
        });
        sent++;
      } catch (e) {
        console.error(`followup falhou ${c.id}`, (e as Error).message);
        // Exceção DURANTE a chamada ao provider = ambíguo → unknown (nunca
        // repetir cegamente; reconciliação decide).
        await finishOutboundEffect(supabase, eff.effectId, "unknown", {
          errorCode: String((e as Error).message || "send_exception").slice(0, 120),
        });
        await finishProactiveTouch(supabase, touch.reservationId, touch.claimToken, "released");
      }
    }

    // ─── 2. Marcar como "frio" quem não respondeu ao follow-up ──────
    const { data: cold } = await supabase
      .from("customers")
      .select("id, consultant_id")
      .gte("followup_count", 1)
      .lte("last_followup_at", fortyEightHoursAgo)
      .is("bot_paused_until", null)
      .eq("bot_paused", false)
      .eq("do_not_contact", false)
      .is("assigned_human_id", null)
      // Só leads do bot — carteira iGreen não é "esfriada".
      .or(LEAD_ORIGIN_FILTER)
      .limit(50);

    const coldAllowed = new Set(
      await filterSendableCustomers(supabase, (cold ?? []).map((c: any) => c.id), { cronName: "bot-followup-checker:cold" }),
    );

    let cooled = 0;
    for (const c of (cold || []).filter((c: any) => coldAllowed.has(c.id))) {
      // Marca deal CRM como 'frio' se ainda não estiver finalizado
      const { data: deal } = await supabase
        .from("crm_deals")
        .select("id, stage")
        .eq("customer_id", c.id)
        .eq("consultant_id", c.consultant_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (deal && !["aprovado", "rejeitado", "frio"].includes(deal.stage || "")) {
        await supabase.from("crm_deals")
          .update({ stage: "frio", notes: "Auto-marcado como frio: sem resposta após follow-up." })
          .eq("id", deal.id);
        cooled++;
      }
      // Evita re-processar
      await supabase.from("customers").update({ followup_count: 2 }).eq("id", c.id);
    }

    return new Response(JSON.stringify({ ok: true, followups_sent: sent, cooled_deals: cooled }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("bot-followup-checker error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});