// Realinha campanha CTWA já publicada:
// 1) mensagem WhatsApp (page_welcome_message) — frase ÚNICA por campanha
//    (pode citar a cidade; NÃO genificar, senão o fallback por frase colide)
// 2) tracking_specs no pixel oficial da plataforma (igreen-oficial-remarketing)
// 3) se for remarketing: inclui Custom Audience + Lookalike na targeting do adset
import {
  adminClient,
  authConsultant,
  corsHeaders,
  fbFetch,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import {
  buildCtwaPageWelcomeMessage,
  stripTrackingProtocol,
} from "../_shared/campaign-tracking.ts";
import { MG_RETARGET_DDD_ALLOWLIST } from "../_shared/city-to-ddd.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";

const OFFICIAL_PIXEL = "708759256921383";
const DEFAULT_MSG = "Oi! Quero saber como consigo pagar menos na conta de luz.";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isAdminUser(admin: ReturnType<typeof adminClient>, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();
  return !!data;
}

/**
 * Limpa protocolo legado na frase CTWA.
 * NÃO remove cidade: a frase precisa ser única por campanha ativa — é o
 * fallback quando Whapi/Meta não manda AD ID / ctwa_clid no webhook.
 */
function sanitizeInitialMessage(raw: string | null | undefined): string {
  let s = stripTrackingProtocol(raw || "").trim();
  if (!s) s = DEFAULT_MSG;
  s = s.replace(/\s+/g, " ").trim();
  if (s.length < 8) s = DEFAULT_MSG;
  if (!/[.!?…]$/.test(s)) s = `${s}.`;
  return s.slice(0, 280);
}

function patchWelcomeDeep(value: unknown, welcome: Record<string, unknown>, textContent: string): unknown {
  if (Array.isArray(value)) return value.map((v) => patchWelcomeDeep(v, welcome, textContent));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(value as Record<string, unknown>)) {
    if (k === "page_welcome_message") {
      out[k] = welcome;
      continue;
    }
    if (typeof raw === "string" && /api\.whatsapp\.com\/send|wa\.me\//i.test(raw)) {
      try {
        const url = new URL(raw);
        url.searchParams.set("text", textContent);
        out[k] = url.toString();
      } catch {
        out[k] = raw;
      }
      continue;
    }
    out[k] = patchWelcomeDeep(raw, welcome, textContent);
  }
  if (out.video_data && typeof out.video_data === "object" && !Array.isArray(out.video_data)) {
    const vd = out.video_data as Record<string, unknown>;
    if (vd.image_url && vd.image_hash) delete vd.image_hash;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const serviceSecret = Deno.env.get("SERVICE_SHARED_SECRET") || "";
  const isService = !!serviceSecret && req.headers.get("x-service-secret") === serviceSecret;
  if (!isService && !isServiceRoleAuth(req)) {
    const auth = await authConsultant(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);
    if (!(await isAdminUser(admin, auth.id))) return json({ error: "Sem permissão." }, 403);
  }

  const body = await req.json().catch(() => ({})) as {
    campaign_id?: string;
    initial_message?: string;
    dry_run?: boolean;
    align_audience?: boolean;
  };
  const dryRun = body.dry_run === true;
  const campaignId = String(body.campaign_id || "").trim();
  if (!campaignId) return json({ error: "campaign_id obrigatório" }, 400);

  const platform = await loadPlatformAccount();
  if (!platform?.token) return json({ error: "Conta Meta da plataforma não configurada." }, 400);

  const pixelId = platform.pixel_id || OFFICIAL_PIXEL;
  const customAudId = (platform as any).custom_audience_id as string | null;
  // loadPlatformAccount tipado sem custom — lê direto do row
  const { data: pfRow } = await admin
    .from("platform_facebook_account")
    .select("custom_audience_id, lookalike_audience_id, pixel_id")
    .eq("id", true)
    .maybeSingle();
  const platformCustomAud = pfRow?.custom_audience_id || customAudId || null;
  const platformLal = pfRow?.lookalike_audience_id || null;
  const officialPixel = pfRow?.pixel_id || pixelId;

  const { data: camp, error: campErr } = await admin
    .from("facebook_campaigns")
    .select("id, name, status, initial_message, fb_campaign_id, fb_adset_ids, fb_ad_ids, cities")
    .eq("id", campaignId)
    .maybeSingle();
  if (campErr || !camp) return json({ error: "Campanha não encontrada" }, 404);

  const newMsg = sanitizeInitialMessage(body.initial_message ?? camp.initial_message);
  const welcome = buildCtwaPageWelcomeMessage(newMsg);
  const isRemarketing = String(camp.name || "").toLowerCase().includes("remarketing");
  const alignAudience = body.align_audience !== false && isRemarketing;

  const adIds: string[] = Array.isArray(camp.fb_ad_ids) ? camp.fb_ad_ids.filter(Boolean) : [];
  const adsetIds: string[] = Array.isArray(camp.fb_adset_ids) ? camp.fb_adset_ids.filter(Boolean) : [];

  if (dryRun) {
    const adsetTargeting: Array<Record<string, unknown>> = [];
    for (const adsetId of adsetIds) {
      try {
        const adset = await fbFetch(
          `/${adsetId}?fields=id,name,status,effective_status,daily_budget,targeting&access_token=${encodeURIComponent(platform.token)}`,
        );
        const t = adset?.targeting || {};
        adsetTargeting.push({
          id: adset?.id,
          name: adset?.name,
          status: adset?.status,
          effective_status: adset?.effective_status,
          daily_budget: adset?.daily_budget,
          custom_audiences: (t.custom_audiences || []).map((a: { id?: string }) => String(a.id)),
          excluded_custom_audiences: (t.excluded_custom_audiences || []).map((a: { id?: string }) => String(a.id)),
          geo_locations: t.geo_locations || null,
          age_min: t.age_min ?? null,
          age_max: t.age_max ?? null,
        });
      } catch (e) {
        adsetTargeting.push({ id: adsetId, error: (e as Error).message });
      }
    }
    const expectedCustom = platformCustomAud ? String(platformCustomAud) : null;
    const hasExpected = expectedCustom
      ? adsetTargeting.some((a) => Array.isArray(a.custom_audiences) && (a.custom_audiences as string[]).includes(expectedCustom))
      : false;
    const excludesExpected = expectedCustom
      ? adsetTargeting.some((a) => Array.isArray(a.excluded_custom_audiences) && (a.excluded_custom_audiences as string[]).includes(expectedCustom))
      : false;
    return json({
      ok: true,
      dry_run: true,
      campaign_id: camp.id,
      campaign_name: camp.name,
      new_initial_message: newMsg,
      pixel_id: officialPixel,
      align_audience: alignAudience,
      custom_audience_id: platformCustomAud,
      lookalike_audience_id: platformLal,
      ads: adIds.length,
      adsets: adsetIds.length,
      adset_targeting: adsetTargeting,
      retarget_verdict: isRemarketing
        ? (hasExpected && !excludesExpected ? "RETARGETING_OK" : "RETARGETING_MISMATCH")
        : "NOT_REMARKETING_CAMPAIGN",
    });
  }

  const warnings: string[] = [];
  const updatedAds: string[] = [];
  const updatedAdsets: string[] = [];

  // 1) Persiste mensagem limpa no banco
  await admin.from("facebook_campaigns").update({
    initial_message: newMsg,
    updated_at: new Date().toISOString(),
  }).eq("id", camp.id);

  // 2) Recria criativos com welcome + text limpos
  for (const oldAdId of adIds) {
    try {
      const ad = await fbFetch(
        `/${oldAdId}?fields=id,name,adset_id,status,creative{id,name,object_story_spec,asset_feed_spec,url_tags,degrees_of_freedom_spec}&access_token=${encodeURIComponent(platform.token)}`,
      );
      const creative = ad?.creative || {};
      const params = new URLSearchParams({
        name: `${String(creative.name || ad.name || camp.name).slice(0, 90)} · welcome-fix`,
        access_token: platform.token,
      });
      if (creative.object_story_spec) {
        params.set(
          "object_story_spec",
          JSON.stringify(patchWelcomeDeep(creative.object_story_spec, welcome, newMsg)),
        );
      }
      if (creative.asset_feed_spec) {
        params.set(
          "asset_feed_spec",
          JSON.stringify(patchWelcomeDeep(creative.asset_feed_spec, welcome, newMsg)),
        );
      }
      // CTWA: page_welcome_message no ad creative root também
      params.set("page_welcome_message", JSON.stringify(welcome));
      if (creative.url_tags) params.set("url_tags", String(creative.url_tags));
      if (creative.degrees_of_freedom_spec) {
        params.set("degrees_of_freedom_spec", JSON.stringify(creative.degrees_of_freedom_spec));
      }
      if (!params.has("object_story_spec") && !params.has("asset_feed_spec")) {
        warnings.push(`${oldAdId}: criativo sem estrutura clonável`);
        continue;
      }

      const newCreative = await fbFetch(`/${platform.ad_account_id}/adcreatives`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      });
      if (!newCreative?.id) {
        warnings.push(`${oldAdId}: Meta não retornou creative id`);
        continue;
      }
      await fbFetch(`/${oldAdId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creative: JSON.stringify({ creative_id: newCreative.id }),
          access_token: platform.token,
        }),
      });
      updatedAds.push(oldAdId);
    } catch (e) {
      warnings.push(`${oldAdId}: ${(e as Error).message}`);
    }
  }

  // 3) Audiência no adset (remarketing)
  for (const adsetId of adsetIds) {
    if (!alignAudience) {
      updatedAdsets.push(adsetId);
      continue;
    }
    try {
      const adset = await fbFetch(
        `/${adsetId}?fields=id,name,targeting&access_token=${encodeURIComponent(platform.token)}`,
      );
      const prev = adset.targeting || {};
      // Payload limpo: não reenviar campos legados (tracking etc.) que a Meta rejeita no PATCH.
      const targeting: Record<string, unknown> = {
        geo_locations: prev.geo_locations,
        age_min: prev.age_min ?? 25,
        age_max: prev.age_max ?? 65,
        targeting_automation: prev.targeting_automation || { advantage_audience: 1 },
      };
      if (prev.publisher_platforms) targeting.publisher_platforms = prev.publisher_platforms;
      if (prev.facebook_positions) targeting.facebook_positions = prev.facebook_positions;
      if (prev.instagram_positions) targeting.instagram_positions = prev.instagram_positions;
      if (prev.brand_safety_content_filter_levels) {
        targeting.brand_safety_content_filter_levels = prev.brand_safety_content_filter_levels;
      }

      const audiences: Array<{ id: string }> = [];
      if (platformLal) audiences.push({ id: platformLal });
      if (platformCustomAud) audiences.push({ id: platformCustomAud });
      if (audiences.length) targeting.custom_audiences = audiences;

      await fbFetch(`/${adsetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          targeting: JSON.stringify(targeting),
          access_token: platform.token,
        }),
      });
      updatedAdsets.push(adsetId);
    } catch (e) {
      warnings.push(`adset ${adsetId}: ${(e as Error).message}`);
    }
  }

  // 4) DDD allowlist só 34 (Uberlândia) — sem misturar longe
  if (alignAudience) {
    try {
      await admin.from("platform_facebook_account").update({
        retarget_ddd_allowlist: [...MG_RETARGET_DDD_ALLOWLIST],
        updated_at: new Date().toISOString(),
      }).eq("id", true);
    } catch (e) {
      warnings.push(`retarget_ddd: ${(e as Error).message}`);
    }
  }

  return json({
    ok: true,
    campaign_id: camp.id,
    initial_message: newMsg,
    pixel_id: officialPixel,
    custom_audience_id: platformCustomAud,
    lookalike_audience_id: platformLal,
    updated_ads: updatedAds,
    updated_adsets: updatedAdsets,
    warnings,
  });
});
