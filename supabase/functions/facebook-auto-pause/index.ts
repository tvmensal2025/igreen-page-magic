// Analisa criativos com baixo CTR e cria recomendações. Não altera a Meta.
import { adminClient, corsHeaders } from "../_shared/fb-graph.ts";

const MIN_SPEND_CENTS = 5000;
const MIN_CTR_BPS = 80;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = adminClient();
    const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const { data: metrics, error } = await admin
      .from("facebook_ad_metrics_daily")
      .select("campaign_id, fb_ad_id, spend_cents, impressions, clicks, facebook_campaigns!inner(consultant_id, status)")
      .eq("facebook_campaigns.status", "active")
      .gte("date", since);
    if (error) throw error;

    const grouped = new Map<string, { consultantId: string; campaignId: string; adId: string; spend: number; impressions: number; clicks: number }>();
    for (const row of (metrics as any[]) || []) {
      const key = `${row.campaign_id}:${row.fb_ad_id}`;
      const current = grouped.get(key) || {
        consultantId: row.facebook_campaigns.consultant_id,
        campaignId: row.campaign_id,
        adId: row.fb_ad_id,
        spend: 0, impressions: 0, clicks: 0,
      };
      current.spend += Number(row.spend_cents || 0);
      current.impressions += Number(row.impressions || 0);
      current.clicks += Number(row.clicks || 0);
      grouped.set(key, current);
    }

    let recommended = 0;
    for (const item of grouped.values()) {
      const ctrBps = item.impressions > 0 ? Math.round(item.clicks * 10000 / item.impressions) : 0;
      if (item.spend < MIN_SPEND_CENTS || item.impressions < 1500 || ctrBps >= MIN_CTR_BPS) continue;
      const title = `Revisar criativo ${item.adId}`;
      const { data: existing } = await admin.from("ad_recommendations").select("id")
        .eq("consultant_id", item.consultantId).eq("title", title)
        .is("dismissed_at", null).is("applied_at", null).limit(1);
      if (existing?.length) continue;
      const { error: insertError } = await admin.from("ad_recommendations").insert({
        consultant_id: item.consultantId,
        type: "low_ctr_review",
        title,
        message: `CTR ${(ctrBps / 100).toFixed(2)}% após R$ ${(item.spend / 100).toFixed(2)} e ${item.impressions} impressões. Nada foi pausado automaticamente.`,
        severity: "warning",
        action_label: "Revisar criativo",
        action_payload: { kind: "review_creative", campaign_id: item.campaignId, fb_ad_id: item.adId },
      });
      if (!insertError) recommended++;
    }
    return new Response(JSON.stringify({ ok: true, recommended, paused: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});