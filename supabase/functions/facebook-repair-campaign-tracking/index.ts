// Repara campanhas CTWA já existentes para incluir o protocolo rastreável
// na mensagem do WhatsApp sem o consultor precisar recriar campanha.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  adminClient,
  authConsultant,
  fbFetch,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import {
  appendTrackingProtocol,
  ensureCampaignTrackingProtocol,
  normalizeTrackingProtocol,
} from "../_shared/campaign-tracking.ts";

type CampaignRow = {
  id: string;
  consultant_id: string;
  fb_campaign_id: string | null;
  fb_adset_ids: string[] | null;
  fb_ad_ids: string[] | null;
  name: string;
  status: string;
  initial_message: string | null;
  tracking_protocol: string | null;
  tracking_protocol_channel: string | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function replaceLinksDeep(value: unknown, protocol: string): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceLinksDeep(item, protocol));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && /api\.whatsapp\.com\/send|wa\.me\//i.test(raw)) {
      try {
        const url = new URL(raw);
        const oldText = url.searchParams.get("text") || "Olá! Quero saber mais.";
        url.searchParams.set("text", appendTrackingProtocol(oldText, protocol));
        out[key] = url.toString();
      } catch {
        out[key] = raw;
      }
    } else {
      out[key] = replaceLinksDeep(raw, protocol);
    }
  }
  return out;
}

async function isAdminUser(admin: ReturnType<typeof adminClient>, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await authConsultant(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const admin = adminClient();
  const isAdmin = await isAdminUser(admin, auth.id);
  if (!isAdmin) return json({ error: "Sem permissão." }, 403);

  const body = await req.json().catch(() => ({})) as {
    consultant_id?: string;
    campaign_ids?: string[];
    dry_run?: boolean;
  };
  const dryRun = body.dry_run === true;
  const platform = await loadPlatformAccount();
  if (!platform?.token) return json({ error: "Conta Meta da plataforma não configurada." }, 400);

  let query = admin
    .from("facebook_campaigns")
    .select("id, consultant_id, fb_campaign_id, fb_adset_ids, fb_ad_ids, name, status, initial_message, tracking_protocol, tracking_protocol_channel")
    .in("status", ["active", "pending_review"])
    .not("fb_campaign_id", "is", null)
    .limit(50);
  if (body.consultant_id) query = query.eq("consultant_id", body.consultant_id);
  if (Array.isArray(body.campaign_ids) && body.campaign_ids.length) query = query.in("id", body.campaign_ids);

  const { data: campaigns, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const c of ((campaigns || []) as CampaignRow[])) {
    const channel = c.tracking_protocol_channel || "FB";
    const protocol = normalizeTrackingProtocol(c.tracking_protocol) || await ensureCampaignTrackingProtocol(admin, channel);
    const trackedMessage = appendTrackingProtocol(c.initial_message || "Olá! Quero saber mais.", protocol);
    const oldAdIds = Array.isArray(c.fb_ad_ids) ? c.fb_ad_ids.filter(Boolean) : [];
    const createdAdIds: string[] = [];
    const errors: string[] = [];

    if (dryRun) {
      results.push({ campaign_id: c.id, protocol, tracked_message: trackedMessage, old_ads: oldAdIds.length, dry_run: true });
      continue;
    }

    await admin.from("facebook_campaigns").update({
      tracking_protocol: protocol,
      tracking_protocol_channel: channel,
      initial_message: trackedMessage,
      updated_at: new Date().toISOString(),
    }).eq("id", c.id);

    for (const oldAdId of oldAdIds) {
      try {
        const ad = await fbFetch(`/${oldAdId}?fields=id,name,adset_id,status,creative{id,name,object_story_spec,asset_feed_spec,url_tags,degrees_of_freedom_spec}&access_token=${encodeURIComponent(platform.token)}`);
        const creative = ad?.creative || {};
        const params = new URLSearchParams({
          name: `${String(creative.name || ad.name || c.name).slice(0, 80)} · ${protocol}`,
          access_token: platform.token,
        });
        if (creative.object_story_spec) {
          params.set("object_story_spec", JSON.stringify(replaceLinksDeep(creative.object_story_spec, protocol)));
        }
        if (creative.asset_feed_spec) {
          params.set("asset_feed_spec", JSON.stringify(replaceLinksDeep(creative.asset_feed_spec, protocol)));
        }
        if (creative.url_tags) params.set("url_tags", String(creative.url_tags));
        if (creative.degrees_of_freedom_spec) {
          params.set("degrees_of_freedom_spec", JSON.stringify(creative.degrees_of_freedom_spec));
        }
        if (!params.has("object_story_spec") && !params.has("asset_feed_spec")) {
          errors.push(`${oldAdId}: criativo sem estrutura clonável`);
          continue;
        }
        const newCreative = await fbFetch(`/${platform.ad_account_id}/adcreatives`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        const newAd = await fbFetch(`/${platform.ad_account_id}/ads`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            name: `${String(ad.name || c.name).slice(0, 80)} · ${protocol}`,
            adset_id: ad.adset_id,
            creative: JSON.stringify({ creative_id: newCreative.id }),
            status: ad.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
            access_token: platform.token,
          }),
        });
        if (newAd?.id) createdAdIds.push(newAd.id);
        await fbFetch(`/${oldAdId}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ status: "PAUSED", access_token: platform.token }),
        }).catch((e) => errors.push(`${oldAdId}: não pausou antigo (${(e as Error).message})`));
      } catch (e) {
        errors.push(`${oldAdId}: ${(e as Error).message}`);
      }
    }

    if (createdAdIds.length) {
      await admin.from("facebook_campaigns").update({
        fb_ad_ids: createdAdIds,
        updated_at: new Date().toISOString(),
      }).eq("id", c.id);
    }

    results.push({
      campaign_id: c.id,
      campaign_name: c.name,
      protocol,
      old_ads: oldAdIds,
      new_ads: createdAdIds,
      errors,
    });
  }

  return json({ ok: true, repaired: results.length, results });
});