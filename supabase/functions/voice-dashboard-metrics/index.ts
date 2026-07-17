// voice-dashboard-metrics — KPIs agregados de ligações últimos N dias
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const caller = await resolveCaller(req);
  if (!caller?.consultantId) return json(401, { error: "unauthorized" });

  let body: { consultant_id?: string; days?: number };
  try { body = await req.json(); } catch { body = {}; }

  const days = Math.max(1, Math.min(body.days ?? 30, 90));
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: logs } = await admin
    .from("voice_call_logs")
    .select("status, velip_status, velip_time_sec, duration_sec, velip_cost, created_at")
    .eq("consultant_id", caller.consultantId)
    .gte("created_at", since)
    .limit(5000);

  const list = (logs as {
    status: string | null;
    velip_status: string | null;
    velip_time_sec: number | null;
    duration_sec: number | null;
    velip_cost: number | null;
    created_at: string;
  }[]) || [];

  const answered = list.filter((r) => ["completed", "answered"].includes((r.status || "").toLowerCase())).length;
  const no_answer = list.filter((r) => (r.status || "").toLowerCase() === "no_answer").length;
  const failed = list.filter((r) => ["failed", "busy", "machine"].includes((r.status || "").toLowerCase())).length;
  const durs = list.map((r) => r.velip_time_sec ?? r.duration_sec ?? 0).filter((n) => n > 0);
  const total_cost = list.reduce((s, r) => s + (Number(r.velip_cost) || 0), 0);
  const avg_duration_sec = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;

  // por dia + por hora + breakdown Velip (OK/NA/EK/CK/BK/IK)
  const byDayMap = new Map<string, { total: number; answered: number }>();
  const byHour = new Array<number>(24).fill(0);
  const byVelipMap = new Map<string, number>();
  for (const r of list) {
    const d = new Date(r.created_at);
    const key = d.toISOString().slice(0, 10);
    const cur = byDayMap.get(key) || { total: 0, answered: 0 };
    cur.total++;
    if (["completed", "answered"].includes((r.status || "").toLowerCase())) cur.answered++;
    byDayMap.set(key, cur);
    byHour[d.getHours()]++;
    const code = String(r.velip_status || "").toUpperCase().trim() || "PENDENTE";
    byVelipMap.set(code, (byVelipMap.get(code) || 0) + 1);
  }
  const by_day = [...byDayMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, v]) => ({ day: new Date(day).toLocaleDateString("pt-BR"), total: v.total, answered: v.answered }));
  const by_velip = [...byVelipMap.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  return json(200, {
    total_calls: list.length,
    answered,
    no_answer,
    failed,
    avg_duration_sec,
    total_cost,
    by_day,
    by_hour: byHour,
    by_velip,
  });
});
