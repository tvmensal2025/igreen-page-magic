/**
 * Ganchos que os webhooks (evolution/whapi) chamam para manter o motor
 * de cadência em sincronia com o comportamento do lead.
 *
 * - `onLeadInboundResponse`: qualquer resposta do lead → pausa cadência
 *   e agenda re-engajamento futuro (NÃO envia mensagem).
 * - `onLeadCreated` / `ensureCadenceState`: só cria estado se cadence_engine ON
 *   (criar estado sem motor ligado evita fila fantasma).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { computeNextActionAt } from "./cadence-engine.ts";
import { isAutomationEnabled } from "./automation-gate.ts";
import { loadRetentionSettings } from "./retention-orchestrator.ts";

export async function ensureCadenceState(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customer_id: string,
  consultant_id: string | null,
): Promise<void> {
  try {
    // Só entra na máquina de estados se o motor estiver autorizado.
    if (!(await isAutomationEnabled(supabase, "cadence_engine"))) return;

    const nextAt = computeNextActionAt("GREETED");
    await supabase
      .from("lead_cadence_state")
      .upsert(
        {
          customer_id,
          consultant_id,
          stage: "GREETED",
          next_action_at: nextAt?.toISOString() ?? null,
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
    // Pausa padrão 24h; se settings existirem, usa call_answered_pause como referência
    // de “lead engajado” (mesmo valor configurável).
    let pauseHours = 24;
    try {
      const s = await loadRetentionSettings(supabase);
      pauseHours = s.call_answered_pause_hours || 24;
    } catch { /* defaults */ }

    const resumeAt = new Date(now.getTime() + pauseHours * 3600_000).toISOString();
    await supabase
      .from("lead_cadence_state")
      .update({
        stage: "AI_QUALIFYING",
        last_response_at: now.toISOString(),
        next_action_at: resumeAt,
        paused_reason: null,
        paused_until: null,
      })
      .eq("customer_id", customer_id);
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
