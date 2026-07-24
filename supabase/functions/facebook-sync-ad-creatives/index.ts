// Puxa insights por ANÚNCIO (level=ad) + copy real do creative no Meta
// e popula ad_creative_performance com headline, primary_text, creative_format.
// Roda via cron a cada 6h ou on-demand via { consultant_id } no body.
//
// Por que existe: sem esta sync, headline/primary_text ficam NULL e a IA
// (ad-creative-learner) não consegue identificar padrões vencedores.
import { adminClient, authConsultant, FB_GRAPH, fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { pickMetaConversations, pickMetaLeads } from "../_shared/meta-insight-actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Extrai copy + thumb real do creative.object_story_spec, cobrindo os formatos comuns:
// link_data (image), video_data (video), template_data (catálogo/carousel), asset_feed_spec (Advantage+).
// thumb_url é a MESMA imagem que a Meta está veiculando — não chute da biblioteca.
function extractCopy(creative: any): {
  headline: string | null;
  primary_text: string | null;
  format: string;
  thumb_url: string | null;
  video_id: string | null;
  image_hash: string | null;
} {
  if (!creative) {
    return { headline: null, primary_text: null, format: "unknown", thumb_url: null, video_id: null, image_hash: null };
  }
  const oss = creative.object_story_spec || {};
  const link = oss.link_data;
  const video = oss.video_data;
  const tpl = oss.template_data;
  let headline: string | null = null;
  let primary_text: string | null = null;
  let format = "unknown";
  let thumb_url: string | null = null;
  let video_id: string | null = null;
  let image_hash: string | null = null;
  if (link) {
    headline = link.name || link.title || null;
    primary_text = link.message || link.description || null;
    format = link.child_attachments?.length ? "carousel" : "image";
    thumb_url = link.picture || link.image_url || link.child_attachments?.[0]?.picture || null;
    image_hash = link.image_hash || link.child_attachments?.[0]?.image_hash || null;
  } else if (video) {
    headline = video.title || null;
    primary_text = video.message || null;
    format = "video";
    thumb_url = video.image_url || null;
    video_id = video.video_id || null;
    image_hash = video.image_hash || null;
  } else if (tpl) {
    headline = tpl.name || null;
    primary_text = tpl.description || null;
    format = "catalog";
    image_hash = tpl.image_hash || null;
  }
  // Asset feed (Advantage+ creative)
  const afs = creative.asset_feed_spec;
  if (afs) {
    if (!headline) headline = afs.titles?.[0]?.text || null;
    if (!primary_text) primary_text = afs.bodies?.[0]?.text || null;
    if (!thumb_url) thumb_url = afs.images?.[0]?.url || afs.videos?.[0]?.thumbnail_url || null;
    if (!video_id && afs.videos?.[0]?.video_id) video_id = afs.videos[0].video_id;
    if (!image_hash) image_hash = afs.images?.[0]?.hash || null;
    if (format === "unknown") format = afs.videos?.length ? "video" : "image";
  }
  // Últimos fallbacks (creative-level fields). thumbnail_url costuma existir
  // mesmo quando object_story_spec só traz image_hash (sem URL pública).
  if (!headline) headline = creative.title || creative.name || null;
  if (!primary_text) primary_text = creative.body || null;
  if (!thumb_url) {
    thumb_url = creative.thumbnail_url || creative.image_url || creative.image_urls?.[0] || null;
  }
  if (!image_hash) image_hash = creative.image_hash || null;
  return { headline, primary_text, format, thumb_url, video_id, image_hash };
}

async function resolveImageHashThumb(
  adAccountId: string,
  hash: string,
  token: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (cache.has(hash)) return cache.get(hash) ?? null;
  try {
    const acc = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
    const url =
      `${FB_GRAPH}/${acc}/adimages?hashes=${encodeURIComponent(JSON.stringify([hash]))}` +
      `&fields=hash,url,permalink_url&access_token=${token}`;
    const json = await fbFetch(url);
    const fromMap = json?.images?.[hash];
    const fromList = Array.isArray(json?.data) ? json.data[0] : null;
    const pic = fromMap?.url || fromMap?.permalink_url || fromList?.url || fromList?.permalink_url || null;
    cache.set(hash, pic);
    return pic;
  } catch (e) {
    console.warn("[fb-sync-creatives] image_hash thumb fail", hash, (e as Error).message);
    cache.set(hash, null);
    return null;
  }
}

// Se o creative for vídeo sem thumb resolvida, busca `${video_id}?fields=picture`.
async function resolveVideoThumb(videoId: string, token: string, cache: Map<string, string | null>): Promise<string | null> {
  if (cache.has(videoId)) return cache.get(videoId) ?? null;
  try {
    const url = `${FB_GRAPH}/${videoId}?fields=picture&access_token=${token}`;
    const json = await fbFetch(url);
    const pic = json?.picture || null;
    cache.set(videoId, pic);
    return pic;
  } catch (e) {
    console.warn("[fb-sync-creatives] video thumb fail", videoId, (e as Error).message);
    cache.set(videoId, null);
    return null;
  }
}

// Cache simples por creative_id pra evitar refetch quando 5 ads dividem o mesmo criativo
async function getCreativeCopy(creativeId: string, token: string, cache: Map<string, any>): Promise<ReturnType<typeof extractCopy>> {
  if (cache.has(creativeId)) return cache.get(creativeId);
  try {
    const url = `${FB_GRAPH}/${creativeId}?fields=name,title,body,thumbnail_url,image_url,object_story_spec,asset_feed_spec&access_token=${token}`;
    const json = await fbFetch(url);
    const out = extractCopy(json);
    cache.set(creativeId, out);
    return out;
  } catch (e) {
    console.warn("[fb-sync-creatives] copy fetch fail", creativeId, (e as Error).message);
    const empty = { headline: null, primary_text: null, format: "unknown", thumb_url: null, video_id: null, image_hash: null };
    cache.set(creativeId, empty);
    return empty;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let consultantFilter: string | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.consultant_id === "string") consultantFilter = body.consultant_id;
    } catch (_) { /* sem body */ }

    const authHeader = req.headers.get("Authorization") || "";
    const isCron =
      isServiceRoleAuth(req) ||
      (!authHeader && !!req.headers.get("apikey"));
    if (!isCron) {
      const auth = await authConsultant(req);
      if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const admin = adminClient();
      const { data: role } = await admin.from("user_roles").select("role").eq("user_id", auth.id).eq("role", "admin").maybeSingle();
      if (!role) consultantFilter = auth.id;
    }

    const admin = adminClient();
    let q = admin.from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, status, distribuidora")
      .in("status", ["active", "paused", "pending_review"]);
    if (consultantFilter) q = q.eq("consultant_id", consultantFilter);
    const { data: campaigns } = await q;
    if (!campaigns?.length) {
      return new Response(JSON.stringify({ processed: 0, ads_synced: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const tokenCache: Record<string, { token: string; ad_account_id: string }> = {};
    const creativeCache = new Map<string, any>();
    const videoThumbCache = new Map<string, string | null>();
    const imageHashCache = new Map<string, string | null>();
    let adsSynced = 0;
    let campaignsThumbed = 0;
    const errors: Array<{ campaign_id: string; error: string }> = [];

    for (const c of campaigns) {
      try {
        if (!tokenCache[c.consultant_id]) {
          const conn = await loadCampaignConnection(c.consultant_id);
          if (!conn) { errors.push({ campaign_id: c.id, error: "sem conexão Meta" }); continue; }
          tokenCache[c.consultant_id] = { token: conn.token, ad_account_id: conn.ad_account_id };
        }
        const { token, ad_account_id } = tokenCache[c.consultant_id];

        // Lista ads ativos da campanha (com creative_id)
        const adsUrl = `${FB_GRAPH}/${c.fb_campaign_id}/ads?fields=id,name,status,creative{id,thumbnail_url,image_url}&limit=100&access_token=${token}`;
        const adsJson = await fbFetch(adsUrl);
        const ads = (adsJson?.data || []) as Array<{
          id: string;
          name: string;
          status: string;
          creative: { id: string; thumbnail_url?: string; image_url?: string };
        }>;
        if (!ads.length) continue;

        // Insights agregados (últimos 14d) por ad
        const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
        const until = new Date().toISOString().slice(0, 10);
        const insightsUrl = `${FB_GRAPH}/${c.fb_campaign_id}/insights?level=ad&fields=ad_id,impressions,clicks,spend,actions&time_range={"since":"${since}","until":"${until}"}&access_token=${token}`;
        const insJson = await fbFetch(insightsUrl);
        const insightsByAd = new Map<string, any>();
        for (const row of insJson?.data || []) insightsByAd.set(String(row.ad_id), row);

        // Melhor ad da campanha (maior impressions) → vira a capa oficial
        let bestThumb: string | null = null;
        let bestFormat: string | null = null;
        let bestImpressions = -1;

        for (const ad of ads) {
          if (!ad.creative?.id) continue;
          const copy = await getCreativeCopy(ad.creative.id, token, creativeCache);
          const ins = insightsByAd.get(ad.id);
          const impressions = ins ? parseInt(ins.impressions || "0") : 0;
          const clicks = ins ? parseInt(ins.clicks || "0") : 0;
          const spend_cents = ins ? Math.round(parseFloat(ins.spend || "0") * 100) : 0;
          const directLeads = pickMetaLeads(ins?.actions);
          const conv = pickMetaConversations(ins?.actions);
          const leads = directLeads > 0 ? directLeads : conv;

          // Resolve thumb: lista → copy → vídeo → adimages(image_hash)
          let thumb = ad.creative?.thumbnail_url || ad.creative?.image_url || copy.thumb_url;
          if (!thumb && copy.video_id) {
            thumb = await resolveVideoThumb(copy.video_id, token, videoThumbCache);
          }
          if (!thumb && copy.image_hash && ad_account_id) {
            thumb = await resolveImageHashThumb(ad_account_id, copy.image_hash, token, imageHashCache);
          }

          // Candidato a "capa da campanha": ad com maior impressions (ou primeiro ativo se todos zerados)
          const isCandidate = impressions > bestImpressions ||
            (bestThumb === null && ad.status === "ACTIVE" && thumb);
          if (thumb && isCandidate) {
            bestThumb = thumb;
            bestFormat = copy.format;
            bestImpressions = impressions;
          }

          let score = 0;
          if (leads > 0) {
            const cpl = spend_cents / leads;
            score = leads * 10 - (cpl / 100);
          } else if (spend_cents >= 1000) {
            score = -(spend_cents / 100);
          }

          await admin.from("ad_creative_performance").upsert({
            fb_ad_id: ad.id,
            consultant_id: c.consultant_id,
            campaign_id: c.id,
            headline: copy.headline,
            primary_text: copy.primary_text,
            creative_format: copy.format,
            impressions, clicks, leads,
            spend_cents,
            score: Number(score.toFixed(2)),
            evaluated_at: new Date().toISOString(),
          }, { onConflict: "fb_ad_id" });
          adsSynced++;
        }

        // Grava capa oficial da campanha (fonte: Meta, não biblioteca)
        if (bestThumb) {
          await admin.from("facebook_campaigns").update({
            thumbnail_url: bestThumb,
            creative_format: bestFormat,
            thumbnail_synced_at: new Date().toISOString(),
          }).eq("id", c.id);
          campaignsThumbed++;
        }
      } catch (e) {
        errors.push({ campaign_id: c.id, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({
      processed: campaigns.length,
      ads_synced: adsSynced,
      campaigns_thumbed: campaignsThumbed,
      creative_cache_size: creativeCache.size,
      errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[fb-sync-ad-creatives]", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
