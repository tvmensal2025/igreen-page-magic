/**
 * Troca o criativo de uma campanha CTWA já publicada para vídeo (Reels/Stories).
 * Mantém o mesmo AdSet/campanha Meta; pausa ads antigos; cria ad novo ACTIVE.
 *
 * Body: {
 *   campaign_id: uuid,
 *   video_url: string,
 *   thumb_url?: string,
 *   headline?: string,
 *   primary_text?: string,
 *   activate?: boolean  // default true
 * }
 */
import {
  adminClient,
  corsHeaders,
  fbFetch,
  loadPlatformAccount,
  loadConsultantAdSettings,
} from "../_shared/fb-graph.ts";
import { buildCtwaPageWelcomeMessage } from "../_shared/campaign-tracking.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";

const DEFAULT_HEADLINE = "Pague 28% mais barato.";
const DEFAULT_PRIMARY = "Quer saber se sua conta pode baixar? Simule no zap. 👇";

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
    const videoUrl = String(body.video_url || "").trim();
    const thumbUrlIn = body.thumb_url ? String(body.thumb_url).trim() : null;
    const headline = String(body.headline || DEFAULT_HEADLINE).slice(0, 27);
    const primaryText = String(body.primary_text || DEFAULT_PRIMARY);
    const activate = body.activate !== false;

    if (!campaignId || !videoUrl) {
      return json({ error: "campaign_id_and_video_url_required" }, 400);
    }

    const admin = adminClient();
    const { data: camp, error: campErr } = await admin
      .from("facebook_campaigns")
      .select(
        "id, consultant_id, name, status, fb_campaign_id, fb_adset_ids, fb_ad_ids, initial_message, tracking_protocol, cities",
      )
      .eq("id", campaignId)
      .maybeSingle();
    if (campErr || !camp) return json({ error: "campaign_not_found", detail: campErr?.message }, 404);
    if (!camp.fb_campaign_id) return json({ error: "missing_fb_campaign_id" }, 400);

    const adsetIds: string[] = Array.isArray(camp.fb_adset_ids) ? camp.fb_adset_ids.map(String) : [];
    const oldAdIds: string[] = Array.isArray(camp.fb_ad_ids) ? camp.fb_ad_ids.map(String) : [];
    if (!adsetIds.length) return json({ error: "missing_adset" }, 400);
    const adsetId = adsetIds[0];

    const platform = await loadPlatformAccount();
    if (!platform?.token) return json({ error: "platform_token_missing" }, 500);
    const settings = await loadConsultantAdSettings(camp.consultant_id);
    const waRaw = settings?.whatsapp_destination_number || "";
    const waNumberClean = String(waRaw).replace(/\D/g, "");
    if (!waNumberClean) return json({ error: "whatsapp_destination_missing" }, 400);

    const accId = platform.ad_account_id.startsWith("act_")
      ? platform.ad_account_id
      : `act_${platform.ad_account_id}`;

    // 1) Upload vídeo (file_url)
    console.log("[swap-video] upload", videoUrl);
    const vr = await fbFetch(`/${accId}/advideos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        file_url: videoUrl,
        name: `swap-${camp.tracking_protocol || camp.id}-${Date.now()}`,
        access_token: platform.token,
      }),
    });
    const fbVideoId = vr?.id as string | undefined;
    if (!fbVideoId) return json({ error: "video_upload_failed", detail: vr }, 502);

    // Poll ready (máx ~60s)
    let ready = false;
    const started = Date.now();
    while (Date.now() - started < 60_000) {
      try {
        const st = await fbFetch(`/${fbVideoId}?fields=status&access_token=${platform.token}`);
        const phase = st?.status?.video_status as string | undefined;
        if (phase === "ready") {
          ready = true;
          break;
        }
        if (phase === "error") {
          return json({ error: "video_rejected", detail: st?.status }, 502);
        }
      } catch (_) { /* retry */ }
      await new Promise((r) => setTimeout(r, 3_000));
    }

    // Thumb
    let thumbUrl = thumbUrlIn;
    if (!thumbUrl) {
      const tr = await fbFetch(`/${fbVideoId}/thumbnails?access_token=${platform.token}`);
      const list = (tr?.data || []) as Array<{ uri?: string; is_preferred?: boolean }>;
      const preferred = list.find((t) => t.is_preferred && t.uri);
      thumbUrl = (preferred?.uri || list[0]?.uri) ?? null;
    }
    if (!thumbUrl) return json({ error: "thumb_missing", fb_video_id: fbVideoId, ready }, 502);

    // Cache biblioteca
    try {
      await admin.from("ad_video_library").upsert(
        {
          consultant_id: camp.consultant_id,
          url: videoUrl,
          thumb_url: thumbUrl,
          thumb_source: thumbUrlIn ? "user" : "meta_preferred",
          fb_video_id: fbVideoId,
          fb_video_id_synced_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "consultant_id,url" },
      );
    } catch (e) {
      console.warn("[swap-video] library upsert:", (e as Error).message);
    }

    // 2) AdSet → placements Reels/Stories (vídeo 9:16)
    const adset = await fbFetch(
      `/${adsetId}?fields=id,name,targeting,status&access_token=${encodeURIComponent(platform.token)}`,
    );
    const prev = adset?.targeting || {};
    const targeting: Record<string, unknown> = {
      geo_locations: prev.geo_locations,
      age_min: prev.age_min ?? 25,
      age_max: prev.age_max ?? 65,
      targeting_automation: prev.targeting_automation || { advantage_audience: 1 },
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["facebook_reels", "story"],
      instagram_positions: ["reels", "story"],
    };
    if (prev.custom_audiences) targeting.custom_audiences = prev.custom_audiences;
    if (prev.excluded_custom_audiences) targeting.excluded_custom_audiences = prev.excluded_custom_audiences;
    if (prev.brand_safety_content_filter_levels) {
      targeting.brand_safety_content_filter_levels = prev.brand_safety_content_filter_levels;
    }
    if (prev.age_range) targeting.age_range = prev.age_range;

    await fbFetch(`/${adsetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        targeting: JSON.stringify(targeting),
        access_token: platform.token,
      }),
    });

    // 3) Criativo vídeo CTWA — frase SEMPRE genérica (sem nome de cidade; confunde o lead).
    // Diversidade = variantes do banco; atribuição = AD ID Meta.
    const cityName =
      Array.isArray(camp.cities) && camp.cities[0]?.name ? String(camp.cities[0].name) : "cidade";
    let initialMessage = String(camp.initial_message || "Oi! Quero saber como consigo pagar menos na conta de luz.").trim();
    // Remove cidade se alguém gravou "… em Betim." etc.
    initialMessage = initialMessage
      .replace(/\s+em\s+[A-Za-zÀ-ÿ0-9 .'-]{2,40}\.?$/u, ".")
      .replace(/\.\.+$/, ".")
      .trim();
    if (!initialMessage) {
      initialMessage = "Oi! Quero saber como consigo pagar menos na conta de luz.";
    }
    const waLink = `https://api.whatsapp.com/send?phone=${waNumberClean}&text=${encodeURIComponent(initialMessage)}`;
    const urlTags =
      "utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content=consultor_swap&utm_term={{adset.id}}";

    const videoData: Record<string, unknown> = {
      video_id: fbVideoId,
      title: headline,
      message: primaryText,
      image_url: thumbUrl,
      call_to_action: { type: "WHATSAPP_MESSAGE", value: { link: waLink } },
      page_welcome_message: buildCtwaPageWelcomeMessage(initialMessage),
    };
    const cr = await fbFetch(`/${accId}/adcreatives`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: `[swap-video] ${camp.tracking_protocol || ""} · ${cityName} · Reels`.slice(0, 100),
        object_story_spec: JSON.stringify({
          page_id: platform.page_id,
          video_data: videoData,
        }),
        url_tags: urlTags,
        access_token: platform.token,
      }),
    });
    if (!cr?.id) return json({ error: "creative_create_failed", detail: cr }, 502);

    const adStatus = activate ? "ACTIVE" : "PAUSED";
    const adNew = await fbFetch(`/${accId}/ads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: `[swap-video] ${camp.tracking_protocol || ""} · ${cityName} · Video`.slice(0, 100),
        adset_id: adsetId,
        creative: JSON.stringify({ creative_id: cr.id }),
        status: adStatus,
        access_token: platform.token,
      }),
    });
    if (!adNew?.id) return json({ error: "ad_create_failed", detail: adNew }, 502);

    // 4) Pausa ads antigos
    const paused: string[] = [];
    const pauseErrors: string[] = [];
    for (const oldId of oldAdIds) {
      if (oldId === adNew.id) continue;
      try {
        await fbFetch(`/${oldId}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ status: "PAUSED", access_token: platform.token }),
        });
        paused.push(oldId);
      } catch (e) {
        pauseErrors.push(`${oldId}: ${(e as Error).message}`);
      }
    }

    // 5) Atualiza banco
    await admin
      .from("facebook_campaigns")
      .update({
        fb_ad_ids: [adNew.id],
        creative_format: "video",
        thumbnail_url: thumbUrl,
        thumbnail_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", camp.id);

    return json({
      ok: true,
      campaign_id: camp.id,
      tracking_protocol: camp.tracking_protocol,
      fb_video_id: fbVideoId,
      video_ready: ready,
      creative_id: cr.id,
      new_ad_id: adNew.id,
      ad_status: adStatus,
      paused_old_ads: paused,
      pause_errors: pauseErrors,
      thumb_url: thumbUrl,
      placements: {
        facebook: ["facebook_reels", "story"],
        instagram: ["reels", "story"],
      },
    });
  } catch (e) {
    console.error("[swap-video]", e);
    return json({ error: "swap_failed", message: (e as Error).message }, 500);
  }
});
