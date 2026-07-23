/**
 * Inspeciona campanha/adset/ad na Meta (somente leitura).
 * Body: { campaign_id: uuid }
 */
import {
  adminClient,
  corsHeaders,
  fbFetch,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isServiceRoleAuth(req)) return json({ error: "unauthorized" }, 401);

  try {
    const body = await req.json();
    const campaignId = String(body.campaign_id || "").trim();
    if (!campaignId) return json({ error: "campaign_id_required" }, 400);

    const admin = adminClient();
    const { data: camp } = await admin
      .from("facebook_campaigns")
      .select(
        "id, name, status, tracking_protocol, cities, age_min, age_max, age_min_preferred, daily_budget_cents, creative_format, fb_campaign_id, fb_adset_ids, fb_ad_ids, initial_message, optimization_strategy",
      )
      .eq("id", campaignId)
      .maybeSingle();
    if (!camp) return json({ error: "not_found" }, 404);

    const platform = await loadPlatformAccount();
    if (!platform?.token) return json({ error: "token_missing" }, 500);
    const tk = platform.token;

    const fbCamp = camp.fb_campaign_id
      ? await fbFetch(
        `/${camp.fb_campaign_id}?fields=id,name,status,effective_status,objective,buying_type,bid_strategy,daily_budget,lifetime_budget,special_ad_categories&access_token=${encodeURIComponent(tk)}`,
      )
      : null;

    const adsetIds: string[] = Array.isArray(camp.fb_adset_ids) ? camp.fb_adset_ids.map(String) : [];
    const adsets = [];
    for (const id of adsetIds) {
      const a = await fbFetch(
        `/${id}?fields=id,name,status,effective_status,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_strategy,bid_amount,destination_type,promoted_object,targeting,issues_info,start_time,end_time&access_token=${encodeURIComponent(tk)}`,
      );
      adsets.push(a);
    }

    const adIds: string[] = Array.isArray(camp.fb_ad_ids) ? camp.fb_ad_ids.map(String) : [];
    const ads = [];
    for (const id of adIds) {
      const a = await fbFetch(
        `/${id}?fields=id,name,status,effective_status,configured_status,adset_id,creative{id,name,object_story_spec,thumbnail_url,title,body},issues_info&access_token=${encodeURIComponent(tk)}`,
      );
      ads.push(a);
    }

    // Also list ALL ads under adset (incl. paused old photo)
    const allAdsInAdset = [];
    for (const id of adsetIds) {
      try {
        const list = await fbFetch(
          `/${id}/ads?fields=id,name,status,effective_status,creative{id,thumbnail_url,object_story_spec}&limit=20&access_token=${encodeURIComponent(tk)}`,
        );
        allAdsInAdset.push({ adset_id: id, ads: list?.data || [] });
      } catch (e) {
        allAdsInAdset.push({ adset_id: id, error: (e as Error).message });
      }
    }

    return json({
      ok: true,
      db: camp,
      meta_campaign: fbCamp,
      meta_adsets: adsets,
      meta_ads: ads,
      all_ads_in_adsets: allAdsInAdset,
      platform: {
        ad_account_id: platform.ad_account_id,
        page_id: platform.page_id,
        pixel_id: platform.pixel_id,
      },
    });
  } catch (e) {
    return json({ error: "inspect_failed", message: (e as Error).message }, 500);
  }
});
