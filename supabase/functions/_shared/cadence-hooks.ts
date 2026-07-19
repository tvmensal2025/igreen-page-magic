/**
 * Ganchos que os webhooks (evolution/whapi) chamam para manter o motor
 * de cadência em sincronia com o comportamento do lead.
 *
 * - `onLeadInboundResponse`: qualquer resposta do lead → pausa cadência
 *   e agenda re-engajamento futuro (NÃO envia mensagem).
 * - `onLeadCreated` / `ensureCadenceState`: só cria estado se cadence_engine ON
 *   (criar estado sem motor ligado evita fila fantasma).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { nextBusinessMorning } from "./cadence-engine.ts";
import { isAutomationEnabled } from "./automation-gate.ts";
import { loadRetentionSettings } from "./retention-orchestrator.ts";
import { isCadenceBcStage } from "./cadence-inbound-router.ts";

export async function ensureCadenceState(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customer_id: string,
  consultant_id: string | null,
): Promise<void> {
  try {
    // Só entra na máquina de estados se o motor estiver autorizado.
    if (!(await isAutomationEnabled(supabase, "cadence_engine"))) return;

    // D+1 manhã útil: GREETED fica aguardando até o próximo dia comercial.
    const nextAt = nextBusinessMorning(new Date());
    await supabase
      .from("lead_cadence_state")
      .upsert(
        {
          customer_id,
          consultant_id,
          stage: "GREETED",
          next_action_at: nextAt.toISOString(),
        },
        { onConflict: "customer_id", ignoreDuplicates: true },
      );
  } catch (err) {
    console.warn("ensureCadenceState failed", err);
  }
}

/**
 * Lead respondeu → para a pressão da cadência (atualiza estado, sem envio).
 * Sempre seguro de chamar: não depende de toggle de envio.
 */
export async function onLeadInboundResponse(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customer_id: string,
): Promise<void> {
  try {
    const now = new Date();

    // Preserva o estágio atual em paused_reason (lead_responded:<STAGE>)
    // para o tick retomar Grupo C no mesmo ponto — sem zerar para COLD_1.
    const { data: cur } = await supabase
      .from("lead_cadence_state")
      .select("stage")
      .eq("customer_id", customer_id)
      .maybeSingle();
    const prevStage = String((cur as { stage?: string } | null)?.stage || "");
    const reason =
      prevStage && prevStage !== "PAUSED"
        ? `lead_responded:${prevStage}`
        : "lead_responded";

    // 0) Jornada canônica: invalida claim em voo e suprime efeitos apenas
    //    'reserved' (nunca sending/sent/unknown). Cancela SMS/ligação futuros
    //    do marco cuja mensagem o lead acabou de responder.
    try {
      await supabase.rpc("on_journey_inbound", { p_customer_id: customer_id });
    } catch { /* RPC pode não existir em ambiente antigo — pausa abaixo segue */ }

    // 1) Pausa a cadência: o lead voltou a falar → bot_flow assume.
    //    Após 72h: onda B recomeça em COLD_1; Grupo C retoma o estágio salvo.
    const resumeAt = new Date(now.getTime() + 72 * 3600_000).toISOString();
    await supabase
      .from("lead_cadence_state")
      .update({
        stage: "PAUSED",
        last_response_at: now.toISOString(),
        next_action_at: resumeAt,
        paused_until: resumeAt,
        paused_reason: reason,
      })
      .eq("customer_id", customer_id);

    // 2) Log da resposta para métricas (view cadence_metrics_daily lê isso).
    await supabase.from("cadence_action_log").insert({
      customer_id,
      stage: "AI_QUALIFYING",
      channel: "system",
      status: "queued",
      detail: {
        reason: "inbound_response",
        resumed_flow: true,
        prev_stage: prevStage || null,
        from_bc: isCadenceBcStage(prevStage),
      },
    }).then(() => {}, () => {});

    // 3) Só marca origem "cadence" e reseta o fluxo quando o lead VINHA
    //    de B/C (COLD/RECALL/SMS/CALL). Em GREETED/NEW/AI_QUALIFYING o
    //    inbound é Grupo A puro — bot-flow/welcome assume, sem nudge B/C.
    if (isCadenceBcStage(prevStage)) {
      await supabase
        .from("customers")
        .update({
          conversation_step: null,
          custom_step_retries: 0,
          last_custom_prompt_at: null,
          ai_followups_count: 0,
          origin_recovery: "cadence",
        })
        .eq("id", customer_id);

      // Libera slots de mídia/áudio para o fluxo reintroduzir welcomes.
      await supabase.from("ai_slot_dispatch_log").delete().eq("customer_id", customer_id);
    }
  } catch (err) {
    console.warn("onLeadInboundResponse failed", err);
  }
}


/**
 * Ligação atendida → pausa cadência (toggle call_answered_pause_cadence).
 */
export async function onCallAnsweredPauseCadence(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customer_id: string | null,
): Promise<void> {
  if (!customer_id) return;
  try {
    if (!(await isAutomationEnabled(supabase, "call_answered_pause_cadence"))) return;
    const s = await loadRetentionSettings(supabase);
    const until = new Date(Date.now() + s.call_answered_pause_hours * 3600_000).toISOString();
    await supabase
      .from("lead_cadence_state")
      .update({
        paused_until: until,
        paused_reason: "call_answered",
        next_action_at: until,
      })
      .eq("customer_id", customer_id);
  } catch (err) {
    console.warn("onCallAnsweredPauseCadence failed", err);
  }
}

export type { SupabaseClient };
