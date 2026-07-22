/**
 * outbound-delivery-reconcile-cron
 *
 * Poll Whapi GET message/status para outbound ainda em queued/pending/sent.
 * - Atualiza conversations.delivery_status (+ outbound_message_log quando possível)
 * - Pending eterno (>15 min) → failed
 * - Não reverte stage da cadência (só corrige log / permite retry via cadence hold)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";
import {
  fetchWhapiMessageAck,
  isPendingStale,
  shouldUpgradeDelivery,
  RECONCILE_MAX_AGE_MS,
  RECONCILE_MIN_AGE_MS,
  logReconcile,
} from "../_shared/outbound-delivery-reconcile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret, x-cron-secret",
};

const BATCH = 40;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!assertCronAuth(req)) {
    return cronAuthUnauthorized(corsHeaders);
  }

  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settingsRows } = await supabase.from("settings").select("key, value");
  const settings: Record<string, string> = {};
  (settingsRows || []).forEach((s: any) => { settings[s.key] = s.value; });
  const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
  const whapiUrl = settings.whapi_api_url || Deno.env.get("WHAPI_API_URL") || "https://gate.whapi.cloud";

  if (!whapiToken) {
    return new Response(JSON.stringify({ ok: false, error: "whapi_token_missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  const minIso = new Date(now - RECONCILE_MAX_AGE_MS).toISOString();
  const maxIso = new Date(now - RECONCILE_MIN_AGE_MS).toISOString();

  const { data: rows, error } = await supabase
    .from("conversations")
    .select("id, customer_id, external_message_id, delivery_status, created_at, origin")
    .eq("message_direction", "outbound")
    .not("external_message_id", "is", null)
    .in("delivery_status", ["queued", "pending", "sent"])
    .gte("created_at", minIso)
    .lte("created_at", maxIso)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let updated = 0;
  let staleFailed = 0;
  let checked = 0;
  let errors = 0;

  for (const row of rows || []) {
    const mid = String((row as any).external_message_id || "").trim();
    if (!mid) continue;
    checked++;
    const ack = await fetchWhapiMessageAck(whapiToken, mid, whapiUrl);
    if (!ack.ok) {
      errors++;
      // Sem resposta da API: se já stale, marca failed (evita mentir sent eterno)
      if (isPendingStale(String((row as any).created_at))) {
        const cur = String((row as any).delivery_status || "");
        if (cur === "queued" || cur === "pending" || cur === "sent") {
          await supabase
            .from("conversations")
            .update({ delivery_status: "failed" })
            .eq("id", (row as any).id);
          staleFailed++;
          logReconcile("outbound_ack_stale_failed_unreachable", {
            conversation_id: (row as any).id,
            message_id_suffix: mid.slice(-10),
            detail: ack.detail,
          });
        }
      }
      continue;
    }

    let next = ack.status;
    if (
      (next === "pending" || next === "queued") &&
      isPendingStale(String((row as any).created_at))
    ) {
      next = "failed";
      staleFailed++;
    }

    const cur = String((row as any).delivery_status || "");
    if (!shouldUpgradeDelivery(cur, next) && next !== "failed") continue;

    const { error: upErr } = await supabase
      .from("conversations")
      .update({ delivery_status: next })
      .eq("id", (row as any).id);
    if (upErr) {
      errors++;
      continue;
    }
    updated++;

    const logStatus =
      next === "failed" ? "failed" : next === "queued" || next === "pending" ? "queued" : "sent";
    try {
      await supabase
        .from("outbound_message_log")
        .update({ result_status: logStatus })
        .eq("external_message_id", mid);
    } catch { /* coluna pode não existir / best-effort */ }

    logReconcile("outbound_ack_reconciled", {
      conversation_id: (row as any).id,
      from: cur,
      to: next,
      origin: (row as any).origin || null,
      message_id_suffix: mid.slice(-10),
    });
  }

  const body = {
    ok: true,
    checked,
    updated,
    stale_failed: staleFailed,
    errors,
    ms: Date.now() - t0,
  };
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
