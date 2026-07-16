/**
 * daily-reheat-cron
 *
 * dryRun=true (default / cron): só planeja e grava fila — ZERO envio.
 * dryRun=false: só envia se TRIPlo cadeado:
 *   toggle daily_reheat + settings.enabled + live_dispatch_enabled + bot_global
 *
 * Preview com toggle OFF: { "dryRun": true, "preview": true }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  cycleDateBRT,
  isWithinCommercialWindow,
  loadDailyReheatSettings,
  planDailyReheat,
} from "../_shared/daily-reheat/plan.ts";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";
import { isBotGloballyEnabled } from "../_shared/bot/global-flag.ts";
import { isQuietHourBRT } from "../_shared/quiet-hours.ts";

// dispatch importado sob demanda (só no live) para o dry-run do cron não depender
// de attendance-flow/velip no cold start.

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

    // Default SEGURO: dry-run
    const dryRun = body.dryRun !== false;
    const preview = body.preview === true;

    const toggleOn = await isAutomationEnabled(supabase, "daily_reheat");
    if (!toggleOn && !preview && dryRun) {
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
        },
      });
      return json({ ok: true, skipped: reason, dryRun, cycleDate, gates });
    }

    const { plans, skippedGuards, skippedCap, scannedA, scannedB } = await planDailyReheat(
      supabase,
      settings,
      { cycleDate },
    );

    const wouldWhapi = plans.filter((p) => p.would_consume_whapi).length;
    const wouldCall = plans.filter((p) => p.would_call).length;
    const wouldSms = plans.filter((p) => p.would_sms).length;
    const candidatesA = plans.filter((p) => p.queue === "A").length;
    const candidatesB = plans.filter((p) => p.queue === "B").length;

    const { data: runRow, error: runErr } = await supabase
      .from("daily_reheat_runs")
      .insert({
        dry_run: dryRun,
        candidates_a: candidatesA,
        candidates_b: candidatesB,
        would_send_whapi: wouldWhapi,
        would_call: wouldCall,
        would_sms: wouldSms,
        skipped_cap: skippedCap,
        skipped_guards: skippedGuards,
        meta: {
          cycle_date: cycleDate,
          preview,
          gates,
          scanned_a: scannedA,
          scanned_b: scannedB,
          daily_whapi_cap: settings.daily_whapi_cap,
          flow_variant: settings.flow_variant,
          pilot_consultant_ids: settings.pilot_consultant_ids,
          sample: plans.slice(0, 15).map((p) => ({
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

    if (plans.length > 0 && runId) {
      const rows = plans.map((p) => ({
        customer_id: p.customer_id,
        consultant_id: p.consultant_id,
        queue: p.queue,
        cycle_date: cycleDate,
        step: p.step,
        status: "planned",
        planned_actions: p.planned_actions,
        run_id: runId,
      }));
      const { error: qErr } = await supabase.from("daily_reheat_queue").upsert(rows, {
        onConflict: "customer_id,cycle_date",
        ignoreDuplicates: true,
      });
      if (qErr) console.warn("[daily-reheat] queue upsert", qErr.message);
    }

    // ── Live dispatch (só com cadeados) ────────────────────────────────────
    let dispatchResult: { dispatched: number; failed: number; details: unknown } | null = null;

    if (!dryRun) {
      const { canLiveDispatch, dispatchPlans } = await import(
        "../_shared/daily-reheat/dispatch.ts"
      );
      if (!canLiveDispatch(gates)) {
        return json({
          ok: false,
          error: "live_blocked_by_gates",
          hint:
            "Para enviar de verdade: toggle daily_reheat ON + settings.enabled + live_dispatch_enabled + bot_global. Cron de produção continua em dryRun.",
          gates,
          dryRun: false,
          cycleDate,
          runId,
          candidatesA,
          candidatesB,
          plannedOnly: true,
        }, 403);
      }

      const env = {
        whapiToken: Deno.env.get("WHAPI_TOKEN") || "",
        whapiBaseUrl: Deno.env.get("WHAPI_BASE_URL") || "https://gate.whapi.cloud",
        evolutionUrl: Deno.env.get("EVOLUTION_API_URL") || "",
        evolutionKey: Deno.env.get("EVOLUTION_API_KEY") || "",
      };
      // Settings table fallbacks for whapi
      const { data: settingsRows } = await supabase.from("settings").select("key, value");
      for (const s of settingsRows || []) {
        if (s.key === "whapi_token" && !env.whapiToken) env.whapiToken = String(s.value || "");
        if (s.key === "whapi_api_url" && s.value) env.whapiBaseUrl = String(s.value);
      }

      dispatchResult = await dispatchPlans(supabase, plans, settings, env);

      await supabase
        .from("daily_reheat_runs")
        .update({
          meta: {
            cycle_date: cycleDate,
            gates,
            live: true,
            dispatched: dispatchResult.dispatched,
            failed: dispatchResult.failed,
            details: dispatchResult.details.slice(0, 30),
          },
        })
        .eq("id", runId);
    }

    console.log(
      JSON.stringify({
        level: "info",
        event: dryRun ? "daily_reheat_dry_run" : "daily_reheat_live",
        run_id: runId,
        cycleDate,
        candidatesA,
        candidatesB,
        wouldWhapi,
        dispatched: dispatchResult?.dispatched ?? 0,
        gates,
        preview,
      }),
    );

    return json({
      ok: true,
      dryRun,
      phase: dryRun ? 0 : 1,
      dispatched: dispatchResult?.dispatched ?? 0,
      failed: dispatchResult?.failed ?? 0,
      cycleDate,
      runId,
      candidatesA,
      candidatesB,
      wouldSendWhapi: wouldWhapi,
      wouldCall,
      wouldSms,
      skippedCap,
      skippedGuards,
      scannedA,
      scannedB,
      gates,
      botGlobalEnabled: botGlobal,
      settingsEnabled: settings.enabled,
      toggleOn,
      preview,
      sample: plans.slice(0, 10),
      dispatchDetails: dispatchResult?.details?.slice(0, 10) ?? [],
    });
  } catch (e) {
    console.error("[daily-reheat] fatal", (e as Error).message);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
