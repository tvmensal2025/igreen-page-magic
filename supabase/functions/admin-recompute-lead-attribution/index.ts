// Retro-atribuição: varre customers dos últimos N dias com source_referral bruto
// mas sem source_campaign_id, e re-aplica o parser + o extrator de ad_id em URL.
// Admin-only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { extractAdIdFromSourceUrl } from "../_shared/ctwa-url-extractor.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin } = await userClient.rpc("has_role", {
      _user_id: userData.user.id, _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, svcKey);
    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body?.days) || 30, 1), 180);
    const dryRun = body?.dry_run !== false; // default: dry run

    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const { data: candidates, error } = await supabase
      .from("customers")
      .select("id, consultant_id, source_referral, source_ad_id, source_ctwa_clid, source_campaign_id")
      .gte("created_at", since)
      .is("source_campaign_id", null)
      .not("source_referral", "is", null)
      .limit(2000);

    if (error) throw error;

    const results: any[] = [];
    let matched = 0;

    for (const c of candidates ?? []) {
      const ref: any = (c as any).source_referral || {};
      const consultantId = (c as any).consultant_id;
      if (!consultantId) continue;

      let campaignId: string | null = null;
      let method: string | null = null;
      const adId = ref.source_id || (c as any).source_ad_id;
      const clid = ref.ctwa_clid || (c as any).source_ctwa_clid;
      const url = ref.source_url;

      if (adId) {
        const { data } = await supabase.from("facebook_campaigns")
          .select("id").eq("consultant_id", consultantId)
          .contains("fb_ad_ids", [String(adId)]).maybeSingle();
        if ((data as any)?.id) { campaignId = (data as any).id; method = "ad_id"; }
      }
      if (!campaignId && clid) {
        const { data } = await supabase.from("ctwa_clid_mapping")
          .select("campaign_id").eq("ctwa_clid", clid).maybeSingle();
        if ((data as any)?.campaign_id) { campaignId = (data as any).campaign_id; method = "ctwa_clid"; }
      }
      if (!campaignId && url) {
        const extractedAdId = extractAdIdFromSourceUrl(url);
        if (extractedAdId) {
          const { data } = await supabase.from("facebook_campaigns")
            .select("id").eq("consultant_id", consultantId)
            .contains("fb_ad_ids", [extractedAdId]).maybeSingle();
          if ((data as any)?.id) { campaignId = (data as any).id; method = "ad_id_in_url"; }
        }
      }

      if (campaignId) {
        matched++;
        results.push({ customer_id: c.id, campaign_id: campaignId, method });
        if (!dryRun) {
          await supabase.from("customers")
            .update({ source_campaign_id: campaignId, lead_source: "meta_ads" })
            .eq("id", c.id);
          await supabase.from("campaign_match_log").insert({
            customer_id: c.id, campaign_id: campaignId,
            method: `retro_${method}`, similarity: null,
          }).then(() => {}, () => {});
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      scanned: candidates?.length ?? 0,
      matched,
      dry_run: dryRun,
      sample: results.slice(0, 20),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
