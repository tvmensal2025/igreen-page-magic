// flow-d-stuck-watchdog — Task 7 da spec `captacao-fluxo-d-conversao`.
//
// Detecta leads em Fluxo D que ficaram parados >30 segundos em algum step
// não-finalista, gerando alerta `flow_d_stuck` em `bot_handoff_alerts`.
// Schedule recomendado: a cada 5 minutos.
//
// Critério de stuck (Requirement 2.5):
//   - flow_variant = 'D'
//   - status NOT IN ('approved','cancelled')
//   - conversation_step não é finalista (não está em FINAL_STEPS)
//   - updated_at < now() - interval '30 seconds'
//   - last_alert_at IS NULL OR last_alert_at < now() - interval '15 minutes'
//     (debounce: não floodar o consultor com o mesmo lead)
//
// Cap em 200 leads por execução pra não saturar.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonLog, captureError } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 200;
const MIN_STUCK_SECONDS = 30;
const ALERT_DEBOUNCE_MINUTES = 15;

// Steps finais — não geram alerta de stuck. Manter sincronizado com pipeline
// determinístico em `bot-flow.ts`.
const FINAL_STEPS = new Set<string>([
  "complete",
  "completed",
  "lost",
  "ask_email",
  "finalizar",
  "finalizado",
  "cadastro_completo",
  "aguardando_humano",
]);

interface CustomerRow {
  id: string;
  consultant_id: string;
  conversation_step: string | null;
  flow_variant: string | null;
  updated_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const stuckBoundary = new Date(Date.now() - MIN_STUCK_SECONDS * 1000).toISOString();

  // 1. Carrega leads candidatos.
  const { data: candidates, error: fetchErr } = await supabase
    .from("customers")
    .select("id, consultant_id, conversation_step, flow_variant, updated_at")
    .eq("flow_variant", "D")
    .not("status", "in", "(approved,cancelled)")
    .not("conversation_step", "is", null)
    .lt("updated_at", stuckBoundary)
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("[flow-d-stuck-watchdog] fetch falhou:", fetchErr.message);
    return new Response(JSON.stringify({ ok: false, error: fetchErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = ((candidates as CustomerRow[]) || []).filter((r) => {
    const step = (r.conversation_step ?? "").toLowerCase();
    return step.length > 0 && !FINAL_STEPS.has(step);
  });

  if (rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, alerted: 0, ms: Date.now() - t0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Para cada lead, checa se já tem alerta `flow_d_stuck` recente; se não, insere.
  const debounceBoundary = new Date(Date.now() - ALERT_DEBOUNCE_MINUTES * 60 * 1000).toISOString();
  const customerIds = rows.map((r) => r.id);

  const { data: recentAlerts } = await supabase
    .from("bot_handoff_alerts")
    .select("customer_id, created_at")
    .eq("alert_type", "flow_d_stuck")
    .in("customer_id", customerIds)
    .gte("created_at", debounceBoundary);

  const debouncedSet = new Set(((recentAlerts as Array<{ customer_id: string }>) || []).map((a) => a.customer_id));

  const toInsert = rows
    .filter((r) => !debouncedSet.has(r.id))
    .map((r) => ({
      customer_id: r.id,
      consultant_id: r.consultant_id,
      alert_type: "flow_d_stuck",
      conversation_step: r.conversation_step,
      reason: `Lead em Fluxo D parado há mais de ${MIN_STUCK_SECONDS}s no passo "${r.conversation_step}"`,
      created_at: new Date().toISOString(),
    }));

  let alerted = 0;
  if (toInsert.length > 0) {
    // Em chunks de 50 para não estourar payload da Edge Function.
    for (let i = 0; i < toInsert.length; i += 50) {
      const chunk = toInsert.slice(i, i + 50);
      const { error: insErr } = await supabase.from("bot_handoff_alerts").insert(chunk);
      if (insErr) {
        // Tenta payload reduzido (compat com schemas antigos sem `severity`/`reason`).
        const minimal = chunk.map((c) => ({
          customer_id: c.customer_id,
          alert_type: c.alert_type,
          conversation_step: c.conversation_step,
          created_at: c.created_at,
        }));
        const { error: insErr2 } = await supabase.from("bot_handoff_alerts").insert(minimal);
        if (insErr2) {
          console.warn(`[flow-d-stuck-watchdog] insert chunk falhou:`, insErr2.message);
          continue;
        }
      }
      alerted += chunk.length;
    }
  }

  jsonLog("info", "flow_d_stuck_watchdog_run", {
    processed: rows.length,
    alerted,
    debounced: debouncedSet.size,
    ms: Date.now() - t0,
  });

  return new Response(JSON.stringify({
    ok: true,
    processed: rows.length,
    alerted,
    debounced: debouncedSet.size,
    ms: Date.now() - t0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    captureError(err, { tags: { function: "flow-d-stuck-watchdog" } });
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
