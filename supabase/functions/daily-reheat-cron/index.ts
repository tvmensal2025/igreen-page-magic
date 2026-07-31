/**
 * daily-reheat-cron
 *
 * - Toggle OFF → skipped (sem planejar).
 * - Toggle ON → planeja fila (novo/frio) e avança passos due.
 * - Live (WhatsApp/voz/SMS) só se TODOS os cadeados ON:
 *     daily_reheat + settings.enabled + live_dispatch_enabled + bot_global
 * - body.dryRun === true força só planejamento (teste).
 *
 * Preview com toggle OFF: { "preview": true }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  cycleDateBRT,
  isWithinCommercialWindow,
  loadDailyReheatSettings,
  loadDueQueuePlans,
  planDailyReheat,
} from "../_shared/daily-reheat/plan.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { isQuietHourBRT } from "../_shared/quiet-hours.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function gatesAllowLive(g: {
  toggleOn: boolean;
  settingsEnabled: boolean;
  liveDispatchEnabled: boolean;
  botGlobalEnabled: boolean;
}): boolean {
  return g.toggleOn && g.settingsEnabled && g.liveDispatchEnabled && g.botGlobalEnabled;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const internalSecret = req.headers.get("x-internal-secret") || "";
    let expectedInternal = Deno.env.get("EMBED_INTERNAL_SECRET") || "";
    if (!expectedInternal) {
      const { data: s } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "embed_internal_token")
        .maybeSingle();
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
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) return json({ error: "forbidden" }, 403);
    }

    let body: { dryRun?: boolean; preview?: boolean; time?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const forceDry = body.dryRun === true;
    const preview = body.preview === true;

    const toggleOn = await isAutomationEnabled(supabase, "daily_reheat");
    if (!toggleOn && !preview) {
      await logSkipped(supabase, "daily_reheat", { dryRun: true, source: "cron_or_call" });
      return json({ ok: true, skipped: "automation_disabled", key: "daily_reheat", dryRun: true });
    }

    const botGlobal = await isBotGloballyEnabled(supabase);
    const settings = await loadDailyReheatSettings(supabase);
    const gates = {
      toggleOn,
      settingsEnabled: !!settings.enabled,
      liveDispatchEnabled: !!settings.live_dispatch_enabled,
      botGlobalEnabled: botGlobal,
    };
    const live = !forceDry && gatesAllowLive(gates);
    const dryRun = !live;
    const cycleDate = cycleDateBRT();
    const window = isWithinCommercialWindow(settings);
    const quiet = isQuietHourBRT();

    if (quiet || !window.ok) {
      const reason = quiet ? "quiet_hours" : window.reason || "outside_window";
      await supabase.from("daily_reheat_runs").insert({
        dry_run: dryRun,
        meta: {
          skipped: reason,
          cycle_date: cycleDate,
          preview,
          gates,
          live,
        },
      });
      return json({ ok: true, skipped: reason, dryRun, live, cycleDate, gates });
    }

    const { plans: newPlans, skippedGuards, skippedCap, scannedA, scannedB } =
      await planDailyReheat(supabase, settings, { cycleDate });

    const { data: runRow, error: runErr } = await supabase
      .from("daily_reheat_runs")
      .insert({
        dry_run: dryRun,
        candidates_a: newPlans.filter((p) => p.queue === "A").length,
        candidates_b: newPlans.filter((p) => p.queue === "B").length,
        would_send_whapi: newPlans.filter((p) => p.would_consume_whapi).length,
        would_call: newPlans.filter((p) => p.would_call).length,
        would_sms: newPlans.filter((p) => p.would_sms).length,
        skipped_cap: skippedCap,
        skipped_guards: skippedGuards,
        meta: {
          cycle_date: cycleDate,
          preview,
          gates,
          live,
          scanned_a: scannedA,
          scanned_b: scannedB,
          daily_whapi_cap: settings.daily_whapi_cap,
          flow_variant: settings.flow_variant,
          pilot_consultant_ids: settings.pilot_consultant_ids,
          sample: newPlans.slice(0, 15).map((p) => ({
            customer_id: p.customer_id,
            queue: p.queue,
            step: p.step,
            phone_tail: p.phone_tail,
            actions: p.planned_actions,
            reason: p.reason,
          })),
        },
      })
      .select("id")
      .maybeSingle();

    if (runErr) {
      console.error("[daily-reheat] run insert failed", runErr.message);
      return json({ ok: false, error: runErr.message }, 500);
    }

    const runId = (runRow as { id?: string } | null)?.id;
    const nowIso = new Date().toISOString();

    if (newPlans.length > 0 && runId) {
      const rows = newPlans.map((p) => ({
        customer_id: p.customer_id,
        consultant_id: p.consultant_id,
        queue: p.queue,
        cycle_date: cycleDate,
        step: p.step,
        status: "planned",
        planned_actions: p.planned_actions,
        next_action_at: nowIso,
        run_id: runId,
      }));
      const { error: qErr } = await supabase.from("daily_reheat_queue").upsert(rows, {
        onConflict: "customer_id,cycle_date",
        ignoreDuplicates: true,
      });
      if (qErr) console.warn("[daily-reheat] queue upsert", qErr.message);
    }

    const duePlans = await loadDueQueuePlans(supabase, { cycleDate });

    let dispatchResult: { dispatched: number; failed: number; details: unknown[] } | null = null;

    if (live && duePlans.length > 0) {
      const { dispatchPlans } = await import("../_shared/daily-reheat/dispatch.ts");
      const env = {
        whapiToken: Deno.env.get("WHAPI_TOKEN") || "",
        whapiBaseUrl: Deno.env.get("WHAPI_BASE_URL") || "https://gate.whapi.cloud",
        evolutionUrl: Deno.env.get("EVOLUTION_API_URL") || "",
        evolutionKey: Deno.env.get("EVOLUTION_API_KEY") || "",
      };
      const { data: settingsRows } = await supabase.from("settings").select("key, value");
      for (const s of settingsRows || []) {
        if (s.key === "whapi_token" && !env.whapiToken) env.whapiToken = String(s.value || "");
        if (s.key === "whapi_api_url" && s.value) env.whapiBaseUrl = String(s.value);
        // Whapi é do superadmin: consultores só saem por Evolution.
        if (s.key === "superadmin_consultant_id" && s.value) {
          (env as Record<string, unknown>).superadminConsultantId = String(s.value).replace(/^"|"$/g, "");
        }
      }

      dispatchResult = await dispatchPlans(supabase, duePlans, settings, env);

      if (runId) {
        await supabase
          .from("daily_reheat_runs")
          .update({
            meta: {
              cycle_date: cycleDate,
              gates,
              live: true,
              due: duePlans.length,
              dispatched: dispatchResult.dispatched,
              failed: dispatchResult.failed,
              details: dispatchResult.details.slice(0, 30),
            },
          })
          .eq("id", runId);
      }
    }

    console.log(
      JSON.stringify({
        level: "info",
        event: live ? "daily_reheat_live" : "daily_reheat_plan_only",
        run_id: runId,
        cycleDate,
        newPlans: newPlans.length,
        due: duePlans.length,
        dispatched: dispatchResult?.dispatched ?? 0,
        gates,
        live,
        preview,
      }),
    );

    return json({
      ok: true,
      dryRun,
      live,
      phase: live ? 1 : 0,
      dispatched: dispatchResult?.dispatched ?? 0,
      failed: dispatchResult?.failed ?? 0,
      cycleDate,
      runId,
      candidatesA: newPlans.filter((p) => p.queue === "A").length,
      candidatesB: newPlans.filter((p) => p.queue === "B").length,
      dueCount: duePlans.length,
      wouldSendWhapi: duePlans.filter((p) => p.would_consume_whapi).length,
      wouldCall: duePlans.filter((p) => p.would_call).length,
      wouldSms: duePlans.filter((p) => p.would_sms).length,
      skippedCap,
      skippedGuards,
      scannedA,
      scannedB,
      gates,
      botGlobalEnabled: botGlobal,
      settingsEnabled: settings.enabled,
      toggleOn,
      preview,
      hint: live
        ? "Envio ativo (cadeados ON)."
        : "Só planejamento. Para enviar: áudio no kit + ligar os 3 interruptores do motor.",
      sample: duePlans.slice(0, 10),
      dispatchDetails: dispatchResult?.details?.slice(0, 10) ?? [],
    });
  } catch (e) {
    console.error("[daily-reheat] fatal", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
