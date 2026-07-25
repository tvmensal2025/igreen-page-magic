// Rollout do Flow Engine V3 — SOMENTE MANUAL (humano logado na plataforma).
// Nunca promove flags por pg_cron / chamada anônima. SuperAdmin clica
// "Rodar agora" no RolloutPanel; a sessão JWT + source=manual autoriza.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { notifyConsultant } from "../_shared/notify-consultant.ts";
import { captureError } from "../_shared/audit.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret",
};

type Flag = "off" | "dark" | "canary" | "on";
const ORDER: Flag[] = ["off", "dark", "canary", "on"];

interface Cfg {
  autopilot_enabled: boolean;
  alert_consultant_id: string | null;
  canary_percent: number;
  dark_min_hours: number;
  canary_min_hours: number;
  green_max_paused_ratio: number;
  green_max_delegated_ratio: number;
  green_min_turns_24h: number;
}

interface HealthRow {
  consultant_id: string;
  consultant_name: string;
  flag: Flag;
  turns_24h: number;
  paused_total: number;
  delegated_total: number;
  state_rows_total: number;
  last_tick_at: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const source = String(body?.source || "").trim().toLowerCase();

  // Freio duro: cron/anônimo nunca promove. Só clique manual na UI.
  if (source !== "manual" && source !== "ui" && source !== "sync") {
    return new Response(
      JSON.stringify({
        skipped: "manual_only",
        reason: "V3 só avança com humano logado (Rodar agora / Sync). Cron ignorado.",
        source: source || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;
  if (caller.mode !== "jwt" || !caller.isAdmin) {
    return new Response(
      JSON.stringify({
        error: "forbidden",
        reason: "rollout_requires_admin_session",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ─── carrega config ─────────────────────────────────────────
  const { data: cfgRow } = await admin
    .from("rollout_config")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  const cfg = (cfgRow ?? {}) as Cfg;
  if (!cfg.autopilot_enabled) {
    return new Response(JSON.stringify({ skipped: "autopilot_disabled" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── carrega saúde + consultores ─────────────────────────────
  const { data: healthRows } = await admin
    .from("v_flow_engine_health")
    .select("*");
  const { data: consultants } = await admin
    .from("consultants")
    .select("id, name, flow_engine_v3, approved")
    .eq("approved", true);

  const health = new Map<string, HealthRow>(
    (healthRows ?? []).map((r: any) => [r.consultant_id, r]),
  );

  // Quantos consultores cabem em "canary" (5% do total aprovado, mínimo 1)
  const totalApproved = consultants?.length ?? 0;
  const canaryCap = Math.max(1, Math.ceil((totalApproved * cfg.canary_percent) / 100));
  const currentlyCanaryOrOn = (consultants ?? []).filter(
    (c: any) => c.flow_engine_v3 === "canary" || c.flow_engine_v3 === "on",
  ).length;

  const decisions: Array<{ id: string; name: string; from: Flag; to: Flag; reason: string }> = [];

  for (const c of consultants ?? []) {
    const current = (c.flow_engine_v3 ?? "off") as Flag;
    const h = health.get(c.id);
    const next = decideNext(current, h, cfg, {
      canaryCap,
      currentlyCanaryOrOn,
    });
    if (next.to !== current) {
      decisions.push({ id: c.id, name: c.name, from: current, to: next.to, reason: next.reason });
    }
  }

  // ─── aplica decisões ─────────────────────────────────────────
  for (const d of decisions) {
    const h = health.get(d.id);
    await admin
      .from("consultants")
      .update({ flow_engine_v3: d.to, flow_reliability_v2: d.to })
      .eq("id", d.id);

    await admin.from("rollout_audit").insert({
      consultant_id: d.id,
      flag_kind: "flow_engine_v3",
      from_state: d.from,
      to_state: d.to,
      reason: d.reason,
      metrics_snapshot: h ?? null,
    });

    const isRollback = ORDER.indexOf(d.to) < ORDER.indexOf(d.from);
    if (isRollback) {
      await admin.from("rollout_alerts").insert({
        consultant_id: d.id,
        level: "error",
        title: `Rollback automático: ${d.name}`,
        body: `Flow Engine V3 voltou de ${d.from} para ${d.to}. Motivo: ${d.reason}.`,
      });
      if (cfg.alert_consultant_id) {
        await notifyConsultant(
          cfg.alert_consultant_id,
          "error",
          `Rollback V3 — ${d.name}`,
          `Voltou de *${d.from}* para *${d.to}*\nMotivo: ${d.reason}`,
        ).catch(() => {});
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      total_approved: totalApproved,
      canary_cap: canaryCap,
      decisions,
      triggered_by: caller.consultantId,
      source,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
  } catch (err: any) {
    captureError(err, { tags: { function: "flow-engine-rollout-cron" } });
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});


function decideNext(
  current: Flag,
  h: HealthRow | undefined,
  cfg: Cfg,
  ctx: { canaryCap: number; currentlyCanaryOrOn: number },
): { to: Flag; reason: string } {
  // sem dados de saúde
  if (!h) {
    if (current === "off") return { to: "dark", reason: "no_health_yet_seed_dark" };
    return { to: current, reason: "no_health_data" };
  }

  const turns = h.turns_24h ?? 0;
  const paused = h.paused_total ?? 0;
  const delegated = h.delegated_total ?? 0;
  const pausedRatio = turns > 0 ? paused / turns : 0;
  const delegatedRatio = turns > 0 ? delegated / turns : 0;

  const isRed =
    pausedRatio > cfg.green_max_paused_ratio ||
    delegatedRatio > cfg.green_max_delegated_ratio;
  const hasMinVolume = turns >= cfg.green_min_turns_24h;
  const isGreen = !isRed && hasMinVolume;

  // tempo no estado atual (proxy via last_tick_at do state — não exato, mas suficiente)
  const hoursInState = h.last_tick_at
    ? (Date.now() - new Date(h.last_tick_at).getTime()) / 3_600_000
    : 0;

  switch (current) {
    case "off":
      return { to: "dark", reason: "seed_dark" };

    case "dark": {
      if (isRed) {
        return { to: "off", reason: `red_gate paused=${pausedRatio.toFixed(2)} delegated=${delegatedRatio.toFixed(2)}` };
      }
      if (!isGreen) return { to: "dark", reason: "waiting_min_volume" };
      if (hoursInState < cfg.dark_min_hours) return { to: "dark", reason: `dark_min_${cfg.dark_min_hours}h` };
      if (ctx.currentlyCanaryOrOn >= ctx.canaryCap) {
        return { to: "dark", reason: `canary_cap_reached_${ctx.canaryCap}` };
      }
      return { to: "canary", reason: "promote_to_canary" };
    }

    case "canary": {
      if (isRed) {
        return { to: "dark", reason: `red_gate paused=${pausedRatio.toFixed(2)} delegated=${delegatedRatio.toFixed(2)}` };
      }
      if (!isGreen) return { to: "canary", reason: "waiting_min_volume" };
      if (hoursInState < cfg.canary_min_hours) return { to: "canary", reason: `canary_min_${cfg.canary_min_hours}h` };
      return { to: "on", reason: "promote_to_on" };
    }

    case "on": {
      if (isRed) {
        return { to: "canary", reason: `red_gate_rollback paused=${pausedRatio.toFixed(2)} delegated=${delegatedRatio.toFixed(2)}` };
      }
      return { to: "on", reason: "stable" };
    }
  }
}
