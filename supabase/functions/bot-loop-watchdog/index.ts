// bot-loop-watchdog — roda a cada 15 min.
// Detecta leads em loop ou em step órfão usando lint_bot_flow_consistency()
// e escala automaticamente: pausa o bot, cria handoff alert e notifica o consultor.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyHandoff } from "../_shared/notify-consultant.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { isLeadEligible } from "../_shared/origin-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const stats = { scanned: 0, escalated: 0, skipped_recent_alert: 0, errors: 0 };

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    if (!(await isBotGloballyEnabled(supabase))) {
      return new Response(JSON.stringify({ skipped: "bot_globally_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Roda o lint global (todos os consultores)
    const { data: lintRows, error: lintErr } = await supabase
      .rpc("lint_bot_flow_consistency", { _consultant_id: null });

    if (lintErr) {
      console.error("[watchdog] lint falhou:", lintErr.message);
      return new Response(JSON.stringify({ ok: false, error: lintErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = (lintRows || []) as Array<{
      category: string;
      severity: string;
      detail: string;
      consultant_id: string | null;
      customer_id: string | null;
      step: string | null;
      occurrences: number;
    }>;

    // Filtra só os que travam o lead
    const candidates = rows.filter((r) =>
      r.customer_id && r.consultant_id &&
      (r.category === "possible_loop" || r.category === "orphan_flow_step")
    );

    stats.scanned = candidates.length;

    // Semana 1 do rollout v3: filtro batch para também pular customers já
    // pausados via customer_flow_state (evita duplo-alerta na migração).
    const { filterSendableCustomers } = await import("../_shared/cron-pause-batch.ts");
    const candidateIds = candidates.map((c) => c.customer_id!).filter(Boolean);
    const allowedIds = new Set(
      await filterSendableCustomers(supabase, candidateIds, { cronName: "bot-loop-watchdog" }),
    );

    for (const row of candidates) {
      try {
        if (!row.customer_id || !allowedIds.has(row.customer_id)) {
          stats.skipped_recent_alert++;
          continue;
        }
        // Carrega o cliente
        const { data: customer } = await supabase
          .from("customers")
          .select("id, name, phone_whatsapp, conversation_step, bot_paused, bot_paused_reason, bot_paused_at, consultant_id, customer_origin")
          .eq("id", row.customer_id!)
          .maybeSingle();

        if (!customer) continue;

        // Regra de ouro: carteira iGreen nunca é tocada por automação proativa.
        if (!isLeadEligible((customer as any).customer_origin)) {
          stats.skipped_recent_alert++;
          continue;
        }

        // Se já está pausado por loop, não duplica alerta
        if (customer.bot_paused && (customer.bot_paused_reason || "").includes("loop")) {
          stats.skipped_recent_alert++;
          continue;
        }

        // Anti-spam: não cria alerta novo se já houve um nas últimas 6h
        const { count: recentAlerts } = await supabase
          .from("bot_handoff_alerts")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .gte("created_at", new Date(Date.now() - 6 * 60 * 60_000).toISOString());

        if ((recentAlerts || 0) > 0) {
          stats.skipped_recent_alert++;
          continue;
        }

        const reason = row.category === "orphan_flow_step"
          ? "auto_orphan_step_detected"
          : "auto_loop_detected";

        // Pausa o bot + marca step de espera humana
        await supabase
          .from("customers")
          .update({
            bot_paused: true,
            bot_paused_reason: reason,
            bot_paused_at: new Date().toISOString(),
          })
          .eq("id", customer.id);

        // Cria alerta visível no painel
        await supabase.from("bot_handoff_alerts").insert({
          customer_id: customer.id,
          consultant_id: customer.consultant_id,
          reason,
          metadata: {
            step: row.step,
            occurrences: row.occurrences,
            detail: row.detail,
            detected_by: "bot-loop-watchdog",
          },
        });

        // Notifica o consultor (fire-and-forget, com try/catch interno)
        await notifyHandoff(
          customer.consultant_id!,
          {
            id: customer.id,
            name: customer.name,
            phone_whatsapp: customer.phone_whatsapp,
            conversation_step: customer.conversation_step,
          },
          `(detectado automaticamente: ${row.detail})`,
          reason,
        ).catch((e) => console.warn("[watchdog] notifyHandoff:", e?.message || e));

        stats.escalated++;
        console.log(`[watchdog] escalado customer=${customer.id} reason=${reason} step=${row.step}`);
      } catch (e) {
        stats.errors++;
        console.error("[watchdog] erro em row:", (e as Error).message, row);
      }
    }

    console.log(`📊 watchdog done in ${Date.now() - startedAt}ms`, stats);

    return new Response(JSON.stringify({ ok: true, stats }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[watchdog] fatal:", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
