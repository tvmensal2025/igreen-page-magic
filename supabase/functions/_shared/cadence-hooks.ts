/**
 * Ganchos que os webhooks (evolution/whapi) chamam para manter o motor
 * de cadência em sincronia com o comportamento do lead.
 *
 * - `onLeadInboundResponse`: qualquer resposta do lead → reseta stage,
 *   pausa por 24h e agenda re-engajamento futuro.
 * - `onLeadCreated`: garante que existe uma linha em lead_cadence_state.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { computeNextActionAt } from "./cadence-engine.ts";

export async function ensureCadenceState(
  supabase: SupabaseClient,
  customer_id: string,
  consultant_id: string | null,
): Promise<void> {
  try {
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

export async function onLeadInboundResponse(
  supabase: SupabaseClient,
  customer_id: string,
): Promise<void> {
  try {
    const now = new Date();
    const resumeAt = new Date(now.getTime() + 24 * 3600_000).toISOString();
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
