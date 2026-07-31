// ============================================================================
// migrate-engine-v3 — One-shot migration for Engine V3 cutover (Task 32)
//
// Spec:    .kiro/specs/flow-engine-v3-rewrite/{requirements.md,design.md,tasks.md}
// Section: design §2.8 ("Migration Script Pseudocode")
// Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5
//
// Purpose
// -------
// Engine V3's invariant: customers.conversation_step is ALWAYS a UUID
// (post-migration). The legacy engines accepted literal strings (e.g.
// "ask_doc", "sys:ask_documento", "flow:welcome"). This script identifies
// in-progress leads with non-UUID conversation_step values, pauses them
// with reason "engine_v3_migration", and inserts one bot_handoff_alerts
// row per paused lead so a human picks up the conversation. New leads
// (post-migration) start fresh on V3 and are unaffected.
//
// Idempotent
// ----------
// Safe to re-run. The cursor query filters
// `bot_paused = false OR bot_paused IS NULL`, so already-paused rows are
// skipped on subsequent runs (Requirement 10.4). The duplicate-alert
// guard checks for an existing bot_handoff_alerts row with
// reason = "engine_v3_migration" for the customer before inserting.
//
// Dry-run mode
// ------------
// `?dryRun=true` counts how many rows would be touched without writing.
// Returns identical JSON shape with `dryRun: true`.
//
// Auth
// ----
// Service-role JWT only. Configured with `verify_jwt = false` in
// supabase/config.toml so it can be invoked from the dashboard / curl
// during the maintenance window. Defense-in-depth: the function reads
// SUPABASE_SERVICE_ROLE_KEY at startup; without it, the function fails
// closed.
//
// Output
// ------
// JSON: { ok, paused, alreadyUUID, alerts_inserted, errors, dryRun }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Standard RFC 4122 UUID regex (any version, lowercase or uppercase).
// Matches the post-migration invariant: conversation_step ∈ UUIDs ∪ {NULL}.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BATCH_SIZE = 500;
const PAUSE_REASON = "engine_v3_migration";
const ALERT_SOURCE = "migration";

interface CustomerRow {
  id: string;
  consultant_id: string | null;
  conversation_step: string | null;
  bot_paused: boolean | null;
  phone_whatsapp: string | null;
}

interface MigrationResult {
  ok: boolean;
  paused: number;
  alreadyUUID: number;
  alerts_inserted: number;
  logs_inserted: number;
  errors: number;
  dryRun: boolean;
  durationMs: number;
}

function isUUID(value: string | null | undefined): boolean {
  if (!value) return false;
  return UUID_REGEX.test(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // ─── CORS preflight ──────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ─── AUTH: service-role ou admin logado ──────────────────────────────
  // Sem isto, qualquer anônimo pausaria leads em massa (verify_jwt = false).
  if (!isServiceRoleAuth(req)) {
    const adminUrl = Deno.env.get("SUPABASE_URL");
    const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!adminUrl || !adminKey) return jsonResponse(500, { ok: false, error: "misconfigured" });
    const adminClient = createClient(adminUrl, adminKey, { auth: { persistSession: false } });
    const caller = await resolveCaller(req, adminClient);
    if (caller instanceof Response) return caller;
    if (caller.mode === "jwt" && !caller.isAdmin) {
      return jsonResponse(403, { ok: false, error: "forbidden" });
    }
  }


  const startedAt = Date.now();

  // ─── Parse dryRun query param ────────────────────────────────────────
  const url = new URL(req.url);
  const dryRunParam = url.searchParams.get("dryRun");
  const dryRun = dryRunParam === "true" || dryRunParam === "1";

  // ─── Service-role client ─────────────────────────────────────────────
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

  // ─── Counters ────────────────────────────────────────────────────────
  let paused = 0;
  let alreadyUUID = 0;
  let alertsInserted = 0;
  let logsInserted = 0;
  let errors = 0;

  console.log(
    `[migrate-engine-v3] starting (dryRun=${dryRun}, batchSize=${BATCH_SIZE})`,
  );

  // ─── Cursor over customers in batches of 500 ─────────────────────────
  // We re-query with .gt("id", lastId) instead of using OFFSET because
  // OFFSET on a moving result-set is unsafe (rows pause as we iterate,
  // shifting subsequent batches). Ordering by id guarantees stable
  // forward progress: once a row is paused, the next batch's
  // `bot_paused = false` filter excludes it naturally.
  let lastId: string | null = null;
  let processedTotal = 0;

  while (true) {
    let query = supabase
      .from("customers")
      .select("id, consultant_id, conversation_step, bot_paused, phone_whatsapp")
      .not("conversation_step", "is", null)
      .or("bot_paused.is.null,bot_paused.eq.false")
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);

    if (lastId) {
      query = query.gt("id", lastId);
    }

    const { data: batch, error: fetchErr } = await query;
    if (fetchErr) {
      console.error(`[migrate-engine-v3] fetch batch failed:`, fetchErr.message);
      errors += 1;
      break;
    }

    if (!batch || batch.length === 0) break;

    for (const rawRow of batch as CustomerRow[]) {
      lastId = rawRow.id;
      processedTotal += 1;

      // Skip rows that are already UUID-shaped — engine V3 reads them fine.
      if (isUUID(rawRow.conversation_step)) {
        alreadyUUID += 1;
        continue;
      }

      // Dry-run: just count.
      if (dryRun) {
        paused += 1;
        continue;
      }

      // ─── 1. Pause the lead ──────────────────────────────────────────
      const nowIso = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from("customers")
        .update({
          bot_paused: true,
          bot_paused_reason: PAUSE_REASON,
          bot_paused_at: nowIso,
        })
        .eq("id", rawRow.id);

      if (updateErr) {
        console.error(
          `[migrate-engine-v3] update customer ${rawRow.id} failed:`,
          updateErr.message,
        );
        errors += 1;
        continue;
      }
      paused += 1;

      // ─── 2. Idempotency guard for handoff alert ─────────────────────
      // If a previous run already inserted an alert for this customer
      // with reason = "engine_v3_migration", do not duplicate
      // (Requirement 10.4).
      const { data: existingAlert, error: alertCheckErr } = await supabase
        .from("bot_handoff_alerts")
        .select("id")
        .eq("customer_id", rawRow.id)
        .eq("reason", PAUSE_REASON)
        .limit(1)
        .maybeSingle();

      if (alertCheckErr) {
        console.warn(
          `[migrate-engine-v3] alert dedupe check for ${rawRow.id} failed:`,
          alertCheckErr.message,
        );
        // Soft-fail: still try the insert; PK uniqueness is not enforced
        // on (customer_id, reason) so worst case is a duplicate row,
        // which is preferable to a missed alert.
      }

      if (!existingAlert) {
        const { error: alertErr } = await supabase
          .from("bot_handoff_alerts")
          .insert({
            customer_id: rawRow.id,
            consultant_id: rawRow.consultant_id,
            phone: rawRow.phone_whatsapp,
            reason: PAUSE_REASON,
            metadata: {
              source: ALERT_SOURCE,
              original_conversation_step: rawRow.conversation_step,
              migrated_at: nowIso,
            },
          });

        if (alertErr) {
          console.error(
            `[migrate-engine-v3] insert alert for ${rawRow.id} failed:`,
            alertErr.message,
          );
          errors += 1;
        } else {
          alertsInserted += 1;
        }
      }

      // ─── 3. Engine log capturing before/after ───────────────────────
      // engine_logs.flow_id is NOT NULL with FK to bot_flows. Legacy leads
      // (the very rows this migration targets) often pre-date
      // customer_flow_state — they stored state directly in
      // customers.conversation_step. When we cannot resolve a flow_id we
      // skip the engine_log row; the bot_handoff_alerts row already
      // carries the durable audit trail (original conversation_step in
      // metadata). The operator can see the skipped count by comparing
      // `paused` vs `logs_inserted` in the returned JSON.
      const flowId = await resolveFlowId(supabase, rawRow.id);
      if (flowId === null) {
        console.log(
          `[migrate-engine-v3] no flow_id for ${rawRow.id}; skipping engine_log`,
        );
      } else {
        const { error: logErr } = await supabase.from("engine_logs").insert({
          at: nowIso,
          kind: "engine_v3_migration",
          customer_id: rawRow.id,
          flow_id: flowId,
          step_id: null,
          payload: {
            before: {
              conversation_step: rawRow.conversation_step,
              bot_paused: rawRow.bot_paused,
            },
            after: {
              bot_paused: true,
              bot_paused_reason: PAUSE_REASON,
              bot_paused_at: nowIso,
            },
            source: ALERT_SOURCE,
          },
        });

        if (logErr) {
          // Non-fatal: alert + pause are the durable record.
          console.warn(
            `[migrate-engine-v3] insert engine_log for ${rawRow.id} failed:`,
            logErr.message,
          );
        } else {
          logsInserted += 1;
        }
      }
    }

    if (batch.length < BATCH_SIZE) break;
  }

  const durationMs = Date.now() - startedAt;
  const result: MigrationResult = {
    ok: errors === 0,
    paused,
    alreadyUUID,
    alerts_inserted: alertsInserted,
    logs_inserted: logsInserted,
    errors,
    dryRun,
    durationMs,
  };

  console.log(
    `[migrate-engine-v3] done in ${durationMs}ms — processed=${processedTotal} ` +
      `paused=${paused} alreadyUUID=${alreadyUUID} alerts=${alertsInserted} ` +
      `logs=${logsInserted} errors=${errors} dryRun=${dryRun}`,
  );

  return jsonResponse(result);
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the flow_id for a customer by reading customer_flow_state.
 * Returns null when the customer has no canonical flow row (legacy lead).
 *
 * The engine_logs table requires flow_id NOT NULL with an FK to bot_flows;
 * when the customer has no flow assigned we skip the engine_log insert
 * rather than synthesize a fake row. The pause and bot_handoff_alerts
 * record remains the durable audit trail in that case.
 */
async function resolveFlowId(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  customerId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("customer_flow_state")
      .select("flow_id")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) return null;
    return (data?.flow_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}
