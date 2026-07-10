// voice-dialer-health
// Saúde da conexão Velip + saldo + gasto do consultor (hoje/semana/mês).
// Mostrado no banner do painel Admin → Ligação.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import {
  getUserID,
  velipConfigured,
  velipWebhookAuthConfigured,
} from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function startOfToday(): string {
  const d = new Date();
  d.setUTCHours(3, 0, 0, 0); // ~00:00 America/Sao_Paulo (UTC-3)
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
}
function startOfDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

async function loadSpend(consultantId: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const today = startOfToday();
  const week = startOfDaysAgo(7);
  const month = startOfDaysAgo(30);

  const [callsToday, callsMonth, smsToday, smsMonth, callsAnswered] = await Promise.all([
    admin.from("voice_call_logs")
      .select("velip_cost")
      .eq("consultant_id", consultantId)
      .gte("created_at", today),
    admin.from("voice_call_logs")
      .select("velip_cost, created_at")
      .eq("consultant_id", consultantId)
      .gte("created_at", month),
    admin.from("voice_sms_log")
      .select("cost")
      .eq("consultant_id", consultantId)
      .gte("created_at", today),
    admin.from("voice_sms_log")
      .select("cost, created_at")
      .eq("consultant_id", consultantId)
      .gte("created_at", month),
    admin.from("voice_call_logs")
      .select("velip_cost, duration_sec")
      .eq("consultant_id", consultantId)
      .eq("velip_status", "OK")
      .gte("created_at", month),
  ]);

  const sum = (rows: { velip_cost?: number | null; cost?: number | null }[] | null) =>
    (rows || []).reduce((a, r) => a + Number(r.velip_cost ?? r.cost ?? 0), 0);

  const sumSince = (
    rows: { velip_cost?: number | null; cost?: number | null; created_at: string }[] | null,
    since: string,
  ) => (rows || []).filter((r) => r.created_at >= since).reduce((a, r) => a + Number(r.velip_cost ?? r.cost ?? 0), 0);

  const spend_today = sum(callsToday.data as any) + sum(smsToday.data as any);
  const spend_week = sumSince(callsMonth.data as any, week) + sumSince(smsMonth.data as any, week);
  const spend_month = sum(callsMonth.data as any) + sum(smsMonth.data as any);
  const answeredRows = (callsAnswered.data as { velip_cost: number | null }[] | null) || [];
  const answered_count = answeredRows.length;
  const avg_cost_per_answered = answered_count > 0
    ? answeredRows.reduce((a, r) => a + Number(r.velip_cost ?? 0), 0) / answered_count
    : 0;

  return {
    spend_today: Number(spend_today.toFixed(4)),
    spend_week: Number(spend_week.toFixed(4)),
    spend_month: Number(spend_month.toFixed(4)),
    answered_count,
    avg_cost_per_answered: Number(avg_cost_per_answered.toFixed(4)),
  };
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  const configured = velipConfigured();
  const webhook_configured = velipWebhookAuthConfigured();

  let spend: Awaited<ReturnType<typeof loadSpend>> | null = null;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const caller = await resolveCaller(req, admin);
    if (!(caller instanceof Response) && caller.mode === "jwt" && caller.consultantId) {
      spend = await loadSpend(caller.consultantId);
    }
  } catch (_) { /* ignore, health should never 500 */ }

  if (!configured) {
    return json(200, {
      ok: false,
      configured: false,
      webhook_configured,
      saldo: null,
      spend,
      message: "VELIP_API_TOKEN não configurado.",
    });
  }

  const r = await getUserID();
  return json(200, {
    ok: r.ok,
    configured: true,
    webhook_configured,
    saldo: r.saldo ?? null,
    spend,
    error: r.ok ? null : r.error ?? "unknown_error",
    driver: "velip",
  });
});
