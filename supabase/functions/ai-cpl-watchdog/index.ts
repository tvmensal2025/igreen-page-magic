// Cron 4h: detecta campanhas onde CPL subiu >40% nas últimas 48h vs janela anterior.
// Quando acontece: marca recomendação warning + grava metadata para o digest do dia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

const THRESHOLD_PCT = 40;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cronAuth = await assertCronAuth(req, supabase as any);
  if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

  try {
    const now = Date.now();
    const t48 = new Date(now - 48 * 3600_000).toISOString();
    const t96 = new Date(now - 96 * 3600_000).toISOString();

    // Pega performance recente agrupada por campanha
    const { data: recent } = await supabase
      .from("ad_creative_performance")
      .select("consultant_id, campaign_id, spend_cents, leads, evaluated_at")
      .gte("evaluated_at", t96);

    const buckets = new Map<string, { recent: number[]; prev: number[] }>();
    for (const r of recent || []) {
      const key = `${r.consultant_id}::${r.campaign_id}`;
      const bucket = buckets.get(key) || { recent: [], prev: [] };
      const ts = new Date(r.evaluated_at as any).getTime();
      const cpl = (r.leads || 0) > 0 ? (r.spend_cents || 0) / (r.leads as number) : null;
      if (cpl == null) continue;
      if (ts >= new Date(t48).getTime()) bucket.recent.push(cpl);
      else bucket.prev.push(cpl);
      buckets.set(key, bucket);
    }

    const alerts: any[] = [];
    for (const [key, b] of buckets) {
      if (b.recent.length === 0 || b.prev.length === 0) continue;
      const avgRecent = b.recent.reduce((a, n) => a + n, 0) / b.recent.length;
      const avgPrev = b.prev.reduce((a, n) => a + n, 0) / b.prev.length;
      if (avgPrev <= 0) continue;
      const delta = ((avgRecent - avgPrev) / avgPrev) * 100;
      if (delta >= THRESHOLD_PCT) {
        const [consultantId, campaignId] = key.split("::");
        alerts.push({ consultantId, campaignId, avgRecent, avgPrev, delta });
      }
    }

    let inserted = 0;
    for (const a of alerts) {
      // Evita duplicar warning para o mesmo campaign nas últimas 24h
      const { data: existing } = await supabase
        .from("ad_recommendations")
        .select("id")
        .eq("consultant_id", a.consultantId)
        .eq("type", "cpl_spike")
        .gte("created_at", new Date(now - 24 * 3600_000).toISOString())
        .limit(1);
      if (existing && existing.length > 0) continue;

      await supabase.from("ad_recommendations").insert({
        consultant_id: a.consultantId,
        type: "cpl_spike",
        title: `CPL subiu ${a.delta.toFixed(0)}% nas últimas 48h`,
        message: `Custo por lead passou de R$ ${(a.avgPrev / 100).toFixed(2)} para R$ ${(a.avgRecent / 100).toFixed(2)}. A IA recomenda revisar criativos ou pausar a campanha.`,
        severity: "warning",
        action_label: "Ver campanha",
        action_payload: { kind: "review_campaign", campaign_id: a.campaignId },
      });
      inserted++;
    }

    return new Response(JSON.stringify({ ok: true, alerts: alerts.length, inserted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
