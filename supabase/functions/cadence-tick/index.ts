// cadence-tick — cron 5 min do motor "Zero Lead Perdido"
//
// Varre lead_cadence_state onde next_action_at <= now() e stage está pendente.
// Para cada lead: aplica STAGE_MAP, respeita janela útil, registra em
// cadence_action_log e agenda próximo estágio.
//
// Nesta Fase 1 o dispatcher apenas registra a intenção (status='queued').
// As fases 2-5 conectam cada canal (whatsapp / voice / sms / meta).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { STAGE_MAP, computeNextActionAt, shouldDispatch, type Stage } from "../_shared/cadence-engine.ts";
import { isBusinessHour } from "../_shared/business-window.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Kill-switch global
  const { data: settings } = await supabase
    .from("app_settings")
    .select("cadence_engine_enabled")
    .eq("id", "global")
    .maybeSingle();

  if (!settings?.cadence_engine_enabled) {
    return json({ skipped: "cadence_disabled" });
  }

  const now = new Date();
  const { data: due, error } = await supabase
    .from("lead_cadence_state")
    .select("id, customer_id, consultant_id, stage, attempts_by_channel, paused_until")
    .lte("next_action_at", now.toISOString())
    .not("stage", "in", "(CLOSE_LOST,WON,PAUSED,RETARGET_META)")
    .order("next_action_at", { ascending: true })
    .limit(200);

  if (error) return json({ error: error.message }, 500);
  if (!due || due.length === 0) return json({ processed: 0 });

  let dispatched = 0;
  let deferred = 0;
  let skipped = 0;

  for (const row of due) {
    const stage = row.stage as Stage;

    // Pausa manual (takeover, opt-out, etc)
    if (row.paused_until && new Date(row.paused_until) > now) {
      await supabase
        .from("lead_cadence_state")
        .update({ next_action_at: row.paused_until })
        .eq("id", row.id);
      deferred++;
      continue;
    }

    const def = STAGE_MAP[stage];
    if (!def) { skipped++; continue; }

    // Fora da janela: adia para o próximo slot útil
    if (def.requiresBusinessHours && !isBusinessHour(now)) {
      const nextSlot = computeNextActionAt(stage, now);
      await supabase
        .from("lead_cadence_state")
        .update({ next_action_at: nextSlot?.toISOString() })
        .eq("id", row.id);
      deferred++;
      continue;
    }

    if (!shouldDispatch(stage, now)) { skipped++; continue; }

    // Fase 1: registra a ação como "queued" (canais reais entram nas Fases 2-5)
    const insertRes = await supabase.from("cadence_action_log").insert({
      customer_id: row.customer_id,
      consultant_id: row.consultant_id,
      stage,
      channel: def.channel,
      status: "queued",
      detail: { note: "phase1_orchestrator", scheduled_next: def.next },
    });

    // Ignora conflito de unique (idempotência)
    if (insertRes.error && !String(insertRes.error.message).includes("duplicate")) {
      console.error("cadence log insert failed", insertRes.error);
    }

    // Avança para o próximo estágio
    const nextAt = computeNextActionAt(def.next, now);
    const attempts = (row.attempts_by_channel as Record<string, number>) ?? {};
    attempts[def.channel] = (attempts[def.channel] ?? 0) + 1;

    await supabase
      .from("lead_cadence_state")
      .update({
        stage: def.next,
        last_action_at: now.toISOString(),
        next_action_at: nextAt?.toISOString() ?? null,
        attempts_by_channel: attempts,
      })
      .eq("id", row.id);

    dispatched++;
  }

  return json({ processed: due.length, dispatched, deferred, skipped });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
