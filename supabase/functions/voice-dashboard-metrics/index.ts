// voice-dashboard-metrics — agregações para o dashboard da aba Ligação.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (s: number, b: unknown) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;
  if (caller.mode !== "jwt") return json(403, { error: "forbidden" });

  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: logs } = await admin
    .from("voice_call_logs")
    .select("status, velip_time_sec, velip_cost, velip_dtmf, created_at")
    .eq("consultant_id", caller.consultantId)
    .gte("created_at", since)
    .limit(5000);

  const rows = (logs as Array<Record<string, unknown>>) || [];
  let answered = 0, noAnswer = 0, failed = 0, totalCost = 0, totalDurSec = 0;
  const heatmap: Record<string, number> = {}; // "dow-hour" -> answered count
  const dtmfAgg: Record<string, Record<string, number>> = {};
  const failReasons: Record<string, number> = {};

  for (const r of rows) {
    const s = String(r.status || "").toLowerCase();
    const cost = Number(r.velip_cost || 0);
    const dur = Number(r.velip_time_sec || 0);
    totalCost += Number.isFinite(cost) ? cost : 0;
    if (s === "completed" || s === "answered") {
      answered++;
      totalDurSec += Number.isFinite(dur) ? dur : 0;
      const d = new Date(String(r.created_at));
      const key = `${d.getDay()}-${d.getHours()}`;
      heatmap[key] = (heatmap[key] || 0) + 1;
    } else if (s === "no_answer") noAnswer++;
    else if (s === "failed") { failed++; failReasons[s] = (failReasons[s] || 0) + 1; }

    const dtmf = (r.velip_dtmf as Record<string, string>) || null;
    if (dtmf) {
      for (const [k, v] of Object.entries(dtmf)) {
        dtmfAgg[k] = dtmfAgg[k] || {};
        dtmfAgg[k][v] = (dtmfAgg[k][v] || 0) + 1;
      }
    }
  }

  const total = rows.length;
  const answerRate = total ? Math.round((answered / total) * 100) : 0;
  const avgDur = answered ? Math.round(totalDurSec / answered) : 0;
  const costPerAnswered = answered ? totalCost / answered : 0;

  return json(200, {
    ok: true,
    period_days: 30,
    total,
    answered,
    no_answer: noAnswer,
    failed,
    answer_rate_pct: answerRate,
    total_cost: totalCost,
    avg_duration_sec: avgDur,
    cost_per_answered: costPerAnswered,
    heatmap,
    dtmf: dtmfAgg,
    fail_reasons: failReasons,
  });
});
