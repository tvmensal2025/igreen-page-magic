// Meta Ads Import — busca campanhas do Meta Marketing API e popula
// facebook_campaigns + facebook_metrics_daily.
//
// POST /meta-ads-import
//   { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }
//
// Reqs: 7.1 a 7.6.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadConnection } from "../_shared/fb-graph.ts";
import { jsonLog, captureError } from "../_shared/audit.ts";

const FB_VERSION = "v21.0";
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ImportBody {
  from?: string;
  to?: string;
}

interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  created_time: string;
  start_time?: string;
}

interface MetaInsight {
  campaign_id: string;
  date_start: string;
  spend: string;
  impressions?: string;
  clicks?: string;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxAttempts = 3,
): Promise<Response> {
  let lastError: any = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000); // 30s timeout
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      // 401/403 = auth error, não retry
      if (res.status === 401 || res.status === 403) return res;
      // 429 = rate limit da Meta: respeita Retry-After (ou backoff exponencial maior)
      if (res.status === 429) {
        if (attempt < maxAttempts - 1) {
          const retryAfter = Number(res.headers.get("retry-after") || 0);
          const waitMs = retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : Math.pow(2, attempt + 2) * 1000; // 4s, 8s...
          console.warn(`[meta-ads-import] 429 rate limit, aguardando ${waitMs}ms`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        return res;
      }
      // 5xx = retry com backoff
      if (res.status >= 500) {
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
          continue;
        }
      }

      return res;
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        continue;
      }
    }
  }
  throw lastError || new Error("fetch failed");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const consultantId = user.id;

    const body = (await req.json().catch(() => ({}))) as ImportBody;

    // Janela: últimos 90 dias por padrão
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const from = body.from ? new Date(body.from) : defaultFrom;
    const to = body.to ? new Date(body.to) : now;

    // Conexão Meta
    const conn = await loadConnection(consultantId);
    if (!conn || !conn.token || !conn.ad_account_id) {
      return new Response(JSON.stringify({ error: "Meta account not connected", reconnect_url: "/admin/ads" }), {
        status: 412,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adAccount = conn.ad_account_id.startsWith("act_") ? conn.ad_account_id : `act_${conn.ad_account_id}`;

    // 1) Lista campanhas ativas/pausadas dos últimos 90 dias
    const campaignsUrl = `${FB_GRAPH}/${adAccount}/campaigns` +
      `?fields=id,name,status,effective_status,created_time,start_time` +
      `&effective_status=["ACTIVE","PAUSED"]` +
      `&since=${Math.floor(from.getTime() / 1000)}` +
      `&access_token=${conn.token}` +
      `&limit=200`;

    let campaignsRes: Response;
    try {
      campaignsRes = await fetchWithRetry(campaignsUrl);
    } catch (e) {
      return new Response(JSON.stringify({
        error: "Meta API timeout/unavailable",
        message: e instanceof Error ? e.message : String(e),
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (campaignsRes.status === 401 || campaignsRes.status === 403) {
      return new Response(JSON.stringify({
        error: "Meta auth expired",
        reconnect_url: "/admin/ads",
      }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!campaignsRes.ok) {
      const text = await campaignsRes.text();
      return new Response(JSON.stringify({ error: "Meta API error", details: text }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const campaignsJson = await campaignsRes.json();
    const metaCampaigns: MetaCampaign[] = campaignsJson?.data || [];

    let inserted = 0;
    let updated = 0;
    const newCampaignsNeedMessage: { id: string; name: string }[] = [];

    // 2) Upsert campanhas (preserva initial_message em updates — Req 7.2)
    for (const mc of metaCampaigns) {
      const status = mc.effective_status === "ACTIVE" ? "active"
        : mc.effective_status === "PAUSED" ? "paused"
        : "archived";

      // Já existe?
      const { data: existing } = await supabase
        .from("facebook_campaigns")
        .select("id, initial_message")
        .eq("consultant_id", consultantId)
        .eq("fb_campaign_id", mc.id)
        .maybeSingle();

      if (existing) {
        // Update — não toca em initial_message
        await supabase
          .from("facebook_campaigns")
          .update({
            name: mc.name,
            status,
            updated_at: new Date().toISOString(),
          })
          .eq("id", (existing as any).id);
        updated++;
      } else {
        // Insert — initial_message vazio (Req 7.3)
        const { error: insErr } = await supabase
          .from("facebook_campaigns")
          .insert({
            consultant_id: consultantId,
            fb_campaign_id: mc.id,
            name: mc.name,
            status,
            initial_message: null,
            daily_budget_cents: 0,
            cities: [],
            fb_adset_ids: [],
            fb_ad_ids: [],
            started_at: mc.start_time || mc.created_time,
          });
        if (!insErr) {
          inserted++;
          newCampaignsNeedMessage.push({ id: mc.id, name: mc.name });
        } else {
          console.warn("[meta-ads-import] insert campanha falhou", mc.id, insErr.message);
        }

      }
    }

    // 3) Insights diários por campanha (Req 7.6)
    if (metaCampaigns.length > 0) {
      const insightsUrl = `${FB_GRAPH}/${adAccount}/insights` +
        `?fields=campaign_id,spend,impressions,clicks,date_start` +
        `&time_range={"since":"${from.toISOString().slice(0, 10)}","until":"${to.toISOString().slice(0, 10)}"}` +
        `&time_increment=1` +
        `&level=campaign` +
        `&access_token=${conn.token}` +
        `&limit=500`;

      try {
        const insRes = await fetchWithRetry(insightsUrl);
        if (insRes.ok) {
          const insJson = await insRes.json();
          const insights: MetaInsight[] = insJson?.data || [];

          // Mapeia fb_campaign_id → uuid local
          const fbIds = [...new Set(insights.map((i) => i.campaign_id))];
          const { data: localCampaigns } = await supabase
            .from("facebook_campaigns")
            .select("id, fb_campaign_id")
            .eq("consultant_id", consultantId)
            .in("fb_campaign_id", fbIds);
          const idMap = new Map<string, string>();
          for (const r of (localCampaigns as any[]) || []) {
            idMap.set(r.fb_campaign_id, r.id);
          }

          // Upsert métricas
          const rows = insights
            .filter((i) => idMap.has(i.campaign_id))
            .map((i) => ({
              campaign_id: idMap.get(i.campaign_id)!,
              date: i.date_start,
              spend_cents: Math.round(Number(i.spend || 0) * 100),
              impressions: Number(i.impressions || 0),
              clicks: Number(i.clicks || 0),
            }));

          if (rows.length > 0) {
            await supabase.from("facebook_metrics_daily").upsert(rows, {
              onConflict: "campaign_id,date",
            });
          }
        }
      } catch (e) {
        jsonLog("warn", "meta_ads_import_insights_failed", {
          consultant_id: consultantId,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    jsonLog("info", "meta_ads_import_done", {
      consultant_id: consultantId,
      campaigns_imported: metaCampaigns.length,
      inserted,
      updated,
    });

    return new Response(JSON.stringify({
      ok: true,
      total_campaigns: metaCampaigns.length,
      inserted,
      updated,
      new_campaigns_need_message: newCampaignsNeedMessage,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    captureError(err, { tags: { function: "meta-ads-import" } });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
