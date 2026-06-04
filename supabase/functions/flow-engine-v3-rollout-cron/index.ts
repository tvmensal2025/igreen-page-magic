// ============================================================================
// flow-engine-v3-rollout-cron — Daily metrics report for Engine V3 (Task 33)
//
// Spec:    .kiro/specs/flow-engine-v3-rewrite/{requirements.md,design.md,tasks.md}
// Section: design §"Migration Plan", §"Risks R1", tasks.md Task 33
// Validates: Requirements 14.1, 14.3
//
// Purpose
// -------
// Aggregates the last 24 hours of `engine_logs` rows into a single daily
// summary covering:
//
//   • Total turns (proxied by count of decision-log rows — exactly one per
//     turn per G3, Requirement 4.1).
//   • Per-consultant breakdown joined through `customers` → `consultants`
//     so the report names the consultor responsible for each slice.
//   • Counts by structured `kind` (engine_transition_match, engine_repeat,
//     engine_goto, engine_handoff, engine_safe_text, engine_ai_answer_deferred,
//     engine_ai_decide_deferred, engine_no_match, engine_v3_migration).
//   • G1–G6 guarantee violation counts (sentinel kinds — see design §3).
//   • Number of `paused_system` events (count of `engine_handoff` logs
//     since the runner sets status=paused_system whenever the humano
//     handler fires — design §2.3.5).
//   • Number of `insert_handoff_alert` sentinels emitted (the engine-only
//     legal way to request a `bot_handoff_alerts` insertion — Requirement 6.1).
//
// Output
// ------
// One row inserted into `engine_logs` with `kind = "engine_v3_daily_report"`
// and the full summary in `payload`. We do NOT create a new table — that
// would require user approval. The `engine_logs` row is anchored to a
// representative (customer_id, flow_id) pair from the window (the FK
// constraint on engine_logs requires both NOT NULL); the summary itself
// is in the payload JSONB so the anchoring choice doesn't affect
// dashboards.
//
// Idempotency
// -----------
// Within the same UTC day, only one report row is inserted. The function
// checks for an existing row with kind = "engine_v3_daily_report" AND
// at::date = current_date BEFORE inserting. Re-running the cron returns
// `{ skipped: "already_reported_today" }` without writing.
//
// Dry-run mode
// ------------
// `?dryRun=true` computes the full summary and returns it in the response
// body without inserting anything. Used for smoke-testing the aggregation
// logic before enabling the cron schedule.
//
// Auth
// ----
// `verify_jwt = false` (configured in supabase/config.toml). The function
// uses the service-role key from the runtime environment to read
// engine_logs across all consultants. Defense-in-depth: fails closed when
// SUPABASE_SERVICE_ROLE_KEY is missing.
//
// CORS
// ----
// Standard preflight handler so the function can also be invoked from the
// admin dashboard if needed (e.g. "Run report now" button later).
//
// Coexistence note
// ----------------
// This function is NEW and runs alongside the existing
// `flow-engine-rollout-cron` (different name, different responsibility:
// the older function flips the per-consultant `flow_engine_v3` enum
// state machine; this one only reports). Both can run independently.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { captureError } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// ─── Constants ────────────────────────────────────────────────────────────
const REPORT_KIND = "engine_v3_daily_report";
const WINDOW_HOURS = 24;
const FETCH_PAGE_SIZE = 1000;
const FETCH_MAX_PAGES = 200; // hard cap: ≤ 200k rows / 24h window

// Decision-log kinds (per design §2.6 + Requirement 4.1 — exactly one per turn).
const DECISION_LOG_KINDS = [
  "engine_transition_match",
  "engine_repeat",
  "engine_goto",
  "engine_safe_text",
  "engine_handoff",
  "engine_ai_answer_deferred",
  "engine_ai_decide_deferred",
  "engine_no_match",
] as const;

// Kinds the task explicitly asks us to break down by count.
const REPORTED_KINDS = [
  ...DECISION_LOG_KINDS,
  "engine_v3_migration",
] as const;

// Strict-mode AI sentinels (design §2.3 / Requirement 7).
const AI_DEFERRED_KINDS = [
  "engine_ai_answer_deferred",
  "engine_ai_decide_deferred",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────
interface EngineLogRow {
  id: number;
  at: string;
  kind: string;
  customer_id: string;
  flow_id: string;
  step_id: string | null;
  payload: Record<string, unknown> | null;
  side_effect: { kind?: string; reason?: string } | null;
}

interface ConsultantSlice {
  consultant_id: string;
  consultant_name: string | null;
  turns: number;
  handoffs: number;
  kind_counts: Record<string, number>;
}

interface DailySummary {
  report_date: string; // UTC date YYYY-MM-DD
  window_start_iso: string;
  window_end_iso: string;
  generated_at_iso: string;
  total_logs: number;
  total_turns: number; // = sum of decision-log rows
  kind_counts: Record<string, number>;
  per_consultant: ConsultantSlice[];
  violations: {
    G1_dedupe_blocked: number;
    G3_no_match: number;
    G5_handoff_with_sentinel: number;
    G5_handoff_without_sentinel: number;
    G6_strict_blocked_ai: number;
    G6_ai_deferred_logs: number;
  };
  paused_system_events: number;
  insert_handoff_alert_sentinels: number;
  engine_v3_migration_events: number;
  outbound_limit_exceeded_events: number;
  variant_unsupported_events: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function utcDateOf(iso: string): string {
  // YYYY-MM-DD slice is safe because Date.toISOString() always emits UTC.
  return iso.slice(0, 10);
}

Deno.serve(async (req) => {
  // ─── CORS preflight ────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {

  const generatedAtIso = new Date().toISOString();
  const reportDate = utcDateOf(generatedAtIso);

  // ─── Parse dryRun query param ──────────────────────────────────────────
  const url = new URL(req.url);
  const dryRunParam = url.searchParams.get("dryRun");
  const dryRun = dryRunParam === "true" || dryRunParam === "1";

  // ─── Service-role client ───────────────────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      {
        ok: false,
        error: "missing_service_role_credentials",
        hint: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
      },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log(
    `[flow-engine-v3-rollout-cron] start (date=${reportDate}, dryRun=${dryRun})`,
  );

  // ─── Idempotency guard (design — same UTC day skip) ────────────────────
  // We skip BEFORE expensive aggregation when not in dry-run mode. Dry-run
  // always recomputes, since its purpose is to inspect the live numbers.
  if (!dryRun) {
    const { data: existing, error: existsErr } = await supabase
      .from("engine_logs")
      .select("id, at")
      .eq("kind", REPORT_KIND)
      .gte("at", `${reportDate}T00:00:00Z`)
      .lt("at", `${reportDate}T23:59:59.999Z`)
      .limit(1)
      .maybeSingle();

    if (existsErr) {
      console.warn(
        `[flow-engine-v3-rollout-cron] idempotency check failed:`,
        existsErr.message,
      );
      // Fail-soft: continue and let the insert proceed; worst case is two
      // report rows, which is preferable to skipping a real reporting run.
    } else if (existing) {
      console.log(
        `[flow-engine-v3-rollout-cron] already reported today (id=${existing.id}); skipping`,
      );
      return jsonResponse({
        ok: true,
        skipped: "already_reported_today",
        report_date: reportDate,
        existing_id: existing.id,
      });
    }
  }

  // ─── Compute the 24h window ────────────────────────────────────────────
  const windowEndIso = generatedAtIso;
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 3600_000);
  const windowStartIso = windowStart.toISOString();

  // ─── Fetch engine_logs in batches ──────────────────────────────────────
  // Order by id ASC and use .gt("id", lastId) for stable pagination.
  let lastId = 0;
  const logs: EngineLogRow[] = [];
  for (let page = 0; page < FETCH_MAX_PAGES; page += 1) {
    const { data: rows, error: fetchErr } = await supabase
      .from("engine_logs")
      .select("id, at, kind, customer_id, flow_id, step_id, payload, side_effect")
      .gte("at", windowStartIso)
      .lte("at", windowEndIso)
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(FETCH_PAGE_SIZE);

    if (fetchErr) {
      console.error(
        `[flow-engine-v3-rollout-cron] fetch page ${page} failed:`,
        fetchErr.message,
      );
      return jsonResponse(
        { ok: false, error: "fetch_logs_failed", detail: fetchErr.message },
        500,
      );
    }

    if (!rows || rows.length === 0) break;
    logs.push(...(rows as EngineLogRow[]));
    lastId = (rows as EngineLogRow[])[rows.length - 1].id;
    if (rows.length < FETCH_PAGE_SIZE) break;
  }

  // ─── Resolve customer → consultant mapping ─────────────────────────────
  const uniqueCustomerIds = Array.from(
    new Set(logs.map((l) => l.customer_id).filter(Boolean)),
  );

  const customerToConsultant = new Map<string, string | null>();
  if (uniqueCustomerIds.length > 0) {
    // Chunk the IN list to avoid URL length limits on PostgREST.
    const CHUNK = 200;
    for (let i = 0; i < uniqueCustomerIds.length; i += CHUNK) {
      const slice = uniqueCustomerIds.slice(i, i + CHUNK);
      const { data: rows, error: custErr } = await supabase
        .from("customers")
        .select("id, consultant_id")
        .in("id", slice);
      if (custErr) {
        console.warn(
          `[flow-engine-v3-rollout-cron] customers chunk ${i} failed:`,
          custErr.message,
        );
        continue;
      }
      for (const r of (rows ?? []) as Array<{ id: string; consultant_id: string | null }>) {
        customerToConsultant.set(r.id, r.consultant_id ?? null);
      }
    }
  }

  const uniqueConsultantIds = Array.from(
    new Set(
      Array.from(customerToConsultant.values()).filter(
        (v): v is string => typeof v === "string",
      ),
    ),
  );

  const consultantNames = new Map<string, string | null>();
  if (uniqueConsultantIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < uniqueConsultantIds.length; i += CHUNK) {
      const slice = uniqueConsultantIds.slice(i, i + CHUNK);
      const { data: rows, error: consErr } = await supabase
        .from("consultants")
        .select("id, name")
        .in("id", slice);
      if (consErr) {
        console.warn(
          `[flow-engine-v3-rollout-cron] consultants chunk ${i} failed:`,
          consErr.message,
        );
        continue;
      }
      for (const r of (rows ?? []) as Array<{ id: string; name: string | null }>) {
        consultantNames.set(r.id, r.name ?? null);
      }
    }
  }

  // ─── Aggregate metrics ─────────────────────────────────────────────────
  const summary = aggregate(
    logs,
    customerToConsultant,
    consultantNames,
    {
      reportDate,
      windowStartIso,
      windowEndIso,
      generatedAtIso,
    },
  );

  // ─── Dry-run short-circuit ─────────────────────────────────────────────
  if (dryRun) {
    console.log(
      `[flow-engine-v3-rollout-cron] dry-run done — total_logs=${summary.total_logs} total_turns=${summary.total_turns}`,
    );
    return jsonResponse({ ok: true, dryRun: true, summary });
  }

  // ─── Pick anchor (customer_id, flow_id) for the engine_logs row ────────
  // engine_logs.customer_id and flow_id are NOT NULL with FKs. We use the
  // most recent log row in the window as the anchor when one exists; the
  // anchor choice does not affect the reported metrics (which live in the
  // payload). When the window had zero logs we still want to write the
  // report so dashboards see a "0" day — we fall back to picking any
  // existing engine_logs row from before the window.
  let anchorCustomerId: string | null = null;
  let anchorFlowId: string | null = null;

  if (logs.length > 0) {
    const last = logs[logs.length - 1];
    anchorCustomerId = last.customer_id;
    anchorFlowId = last.flow_id;
  } else {
    const { data: fallback } = await supabase
      .from("engine_logs")
      .select("customer_id, flow_id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fallback) {
      anchorCustomerId = (fallback as { customer_id: string }).customer_id;
      anchorFlowId = (fallback as { flow_id: string }).flow_id;
    }
  }

  if (!anchorCustomerId || !anchorFlowId) {
    // No engine_logs activity ever; no FK-valid anchor. Return summary
    // without writing — operator can re-run once at least one v3 turn
    // has been processed.
    console.log(
      `[flow-engine-v3-rollout-cron] no anchor available; returning summary without write`,
    );
    return jsonResponse({
      ok: true,
      written: false,
      reason: "no_anchor_available",
      summary,
    });
  }

  // ─── Insert the daily report row ───────────────────────────────────────
  const { data: inserted, error: insertErr } = await supabase
    .from("engine_logs")
    .insert({
      at: generatedAtIso,
      kind: REPORT_KIND,
      customer_id: anchorCustomerId,
      flow_id: anchorFlowId,
      step_id: null,
      payload: summary as unknown as Record<string, unknown>,
      side_effect: { kind: "increment_metric", metric: "engine_v3_daily_report" },
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error(
      `[flow-engine-v3-rollout-cron] insert report row failed:`,
      insertErr.message,
    );
    return jsonResponse(
      {
        ok: false,
        error: "insert_report_failed",
        detail: insertErr.message,
        summary,
      },
      500,
    );
  }

  console.log(
    `[flow-engine-v3-rollout-cron] report inserted (id=${(inserted as { id: number }).id}) — total_logs=${summary.total_logs} total_turns=${summary.total_turns}`,
  );

  return jsonResponse({
    ok: true,
    written: true,
    report_id: (inserted as { id: number }).id,
    summary,
  });
});

// ─── Aggregation ───────────────────────────────────────────────────────────

function aggregate(
  logs: EngineLogRow[],
  customerToConsultant: Map<string, string | null>,
  consultantNames: Map<string, string | null>,
  meta: {
    reportDate: string;
    windowStartIso: string;
    windowEndIso: string;
    generatedAtIso: string;
  },
): DailySummary {
  const kindCounts: Record<string, number> = {};
  for (const k of REPORTED_KINDS) kindCounts[k] = 0;

  // Per-consultant accumulators.
  const perConsultant = new Map<string, ConsultantSlice>();

  // Violation counters.
  let g1Dedupe = 0;
  let g3NoMatch = 0;
  let g5HandoffWithSentinel = 0;
  let g5HandoffWithoutSentinel = 0;
  let g6StrictBlocked = 0;
  let g6AiDeferred = 0;
  let pausedSystemEvents = 0;
  let insertHandoffAlertSentinels = 0;
  let engineV3MigrationEvents = 0;
  let outboundLimitExceeded = 0;
  let variantUnsupported = 0;
  let totalTurns = 0;

  const aiDeferredSet = new Set<string>(AI_DEFERRED_KINDS);
  const decisionSet = new Set<string>(DECISION_LOG_KINDS);

  for (const log of logs) {
    // Global kind counts (only those we explicitly report).
    if (Object.prototype.hasOwnProperty.call(kindCounts, log.kind)) {
      kindCounts[log.kind] += 1;
    }

    // Total turns = decision logs (G3 invariant: exactly one per turn).
    if (decisionSet.has(log.kind)) totalTurns += 1;

    // Violation counters.
    if (log.kind === "engine_dedupe_blocked") g1Dedupe += 1;
    if (log.kind === "engine_no_match") g3NoMatch += 1;
    if (log.kind === "engine_handoff") {
      const sentinel = log.side_effect?.kind === "insert_handoff_alert";
      if (sentinel) g5HandoffWithSentinel += 1;
      else g5HandoffWithoutSentinel += 1;
      pausedSystemEvents += 1;
    }
    if (log.kind === "engine_strict_mode_blocked_ai") g6StrictBlocked += 1;
    if (aiDeferredSet.has(log.kind)) g6AiDeferred += 1;
    if (log.side_effect?.kind === "insert_handoff_alert") {
      insertHandoffAlertSentinels += 1;
    }
    if (log.kind === "engine_v3_migration") engineV3MigrationEvents += 1;
    if (log.kind === "engine_outbound_limit_exceeded") outboundLimitExceeded += 1;
    if (log.kind === "engine_variant_unsupported") variantUnsupported += 1;

    // Per-consultant slice.
    const consultantId = customerToConsultant.get(log.customer_id) ?? null;
    if (!consultantId) continue;

    let slice = perConsultant.get(consultantId);
    if (!slice) {
      slice = {
        consultant_id: consultantId,
        consultant_name: consultantNames.get(consultantId) ?? null,
        turns: 0,
        handoffs: 0,
        kind_counts: Object.fromEntries(REPORTED_KINDS.map((k) => [k, 0])),
      };
      perConsultant.set(consultantId, slice);
    }

    if (decisionSet.has(log.kind)) slice.turns += 1;
    if (log.kind === "engine_handoff") slice.handoffs += 1;
    if (Object.prototype.hasOwnProperty.call(slice.kind_counts, log.kind)) {
      slice.kind_counts[log.kind] += 1;
    }
  }

  // Sort per-consultant slices by turns desc for human-readable reports.
  const perConsultantSorted = Array.from(perConsultant.values()).sort(
    (a, b) => b.turns - a.turns,
  );

  return {
    report_date: meta.reportDate,
    window_start_iso: meta.windowStartIso,
    window_end_iso: meta.windowEndIso,
    generated_at_iso: meta.generatedAtIso,
    total_logs: logs.length,
    total_turns: totalTurns,
    kind_counts: kindCounts,
    per_consultant: perConsultantSorted,
    violations: {
      G1_dedupe_blocked: g1Dedupe,
      G3_no_match: g3NoMatch,
      G5_handoff_with_sentinel: g5HandoffWithSentinel,
      G5_handoff_without_sentinel: g5HandoffWithoutSentinel,
      G6_strict_blocked_ai: g6StrictBlocked,
      G6_ai_deferred_logs: g6AiDeferred,
    },
    paused_system_events: pausedSystemEvents,
    insert_handoff_alert_sentinels: insertHandoffAlertSentinels,
    engine_v3_migration_events: engineV3MigrationEvents,
    outbound_limit_exceeded_events: outboundLimitExceeded,
    variant_unsupported_events: variantUnsupported,
  };
}
