import { resolveCampaignByTrackingProtocol } from "./campaign-tracking.ts";
import { findReferralPaths } from "./ctwa-referral-probe.ts";
import { extractAdIdFromSourceUrl } from "./ctwa-url-extractor.ts";

export type DeterministicCampaignMethod =
  | "ad_id"
  | "ad_id_in_url"
  | "fb_campaign_id"
  | "ctwa_clid"
  | "protocol";

export type MetaReferralFields = {
  referral: Record<string, unknown> | null;
  ctwaClid: string | null;
  sourceAdId: string | null;
  sourceUrl: string | null;
  fbCampaignId: string | null;
};

export type CampaignResolution = {
  campaignId: string;
  method: DeterministicCampaignMethod;
  sourceAdId: string | null;
};

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Extrai os identificadores fortes do Meta de Whapi/Evolution, incluindo
 * `context.ad.source.id`, que é o sinal que não pode perder para fallback.
 */
export function extractMetaReferralFields(rawMessage: any, rootPayload?: unknown): MetaReferralFields {
  const ctxAd = rawMessage?.context?.ad || null;
  const referral = (rawMessage?.referral ||
    rawMessage?.context?.referred_product ||
    rawMessage?.context?.referral ||
    rawMessage?.ad_reply ||
    rawMessage?.externalAdReply ||
    rawMessage?.external_ad_reply ||
    ctxAd ||
    null) as Record<string, unknown> | null;

  let ctwaClid = str(rawMessage?.ctwa_clid) ||
    str(rawMessage?.ctwaClid) ||
    str((referral as any)?.ctwa_clid) ||
    str((referral as any)?.ctwaClid) ||
    str((ctxAd as any)?.ctwa) ||
    str((ctxAd as any)?.ctwa_clid);

  let sourceAdId = str((referral as any)?.ad_id) ||
    str((referral as any)?.adId) ||
    str((referral as any)?.source_id) ||
    str((referral as any)?.sourceId) ||
    str((referral as any)?.source?.id) ||
    str((ctxAd as any)?.source?.id) ||
    str(rawMessage?.source_id) ||
    str(rawMessage?.sourceId);

  let sourceUrl = str((referral as any)?.source_url) ||
    str((referral as any)?.sourceUrl) ||
    str((referral as any)?.source?.url) ||
    str((ctxAd as any)?.source?.url) ||
    str(rawMessage?.source_url) ||
    str(rawMessage?.sourceUrl);

  let fbCampaignId = str((referral as any)?.campaign_id) ||
    str((referral as any)?.campaignId) ||
    str(rawMessage?.campaign_id) ||
    str(rawMessage?.campaignId);

  if ((!ctwaClid || !sourceAdId || !sourceUrl) && rootPayload) {
    try {
      const hit = findReferralPaths(rootPayload);
      ctwaClid = ctwaClid || hit.ctwaClid;
      sourceAdId = sourceAdId || hit.sourceAdId;
      sourceUrl = sourceUrl || hit.sourceUrl;
    } catch { /* best effort */ }
  }

  return { referral, ctwaClid, sourceAdId, sourceUrl, fbCampaignId };
}

async function campaignByAdId(supabase: any, consultantId: string, adId: string | null) {
  if (!adId) return null;
  const { data } = await supabase
    .from("facebook_campaigns")
    .select("id")
    .eq("consultant_id", consultantId)
    .contains("fb_ad_ids", [String(adId)])
    .maybeSingle();
  return (data as any)?.id ? String((data as any).id) : null;
}

export async function campaignContainsAdId(
  supabase: any,
  campaignId: string | null | undefined,
  adId: string | null | undefined,
): Promise<boolean> {
  if (!campaignId || !adId) return true;
  const { data } = await supabase
    .from("facebook_campaigns")
    .select("id")
    .eq("id", campaignId)
    .contains("fb_ad_ids", [String(adId)])
    .maybeSingle();
  return !!(data as any)?.id;
}

/** Sinais fortes do Meta têm prioridade absoluta sobre protocolo/fallback. */
export async function resolveCampaignFromStrongMeta(
  supabase: any,
  consultantId: string,
  fields: MetaReferralFields,
): Promise<CampaignResolution | null> {
  const adId = fields.sourceAdId || (fields.sourceUrl ? extractAdIdFromSourceUrl(fields.sourceUrl) : null);
  const byAd = await campaignByAdId(supabase, consultantId, adId);
  if (byAd) {
    return { campaignId: byAd, method: fields.sourceAdId ? "ad_id" : "ad_id_in_url", sourceAdId: adId };
  }

  if (fields.fbCampaignId) {
    const { data } = await supabase
      .from("facebook_campaigns")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("fb_campaign_id", String(fields.fbCampaignId))
      .maybeSingle();
    if ((data as any)?.id) return { campaignId: String((data as any).id), method: "fb_campaign_id", sourceAdId: adId };
  }

  if (fields.ctwaClid) {
    const { data } = await supabase
      .from("ctwa_clid_mapping")
      .select("campaign_id")
      .eq("ctwa_clid", fields.ctwaClid)
      .maybeSingle();
    if ((data as any)?.campaign_id) {
      return { campaignId: String((data as any).campaign_id), method: "ctwa_clid", sourceAdId: adId };
    }
  }

  return null;
}

export async function resolveCampaignByProtocolOnly(
  supabase: any,
  consultantId: string,
  messageText: string | null | undefined,
): Promise<CampaignResolution | null> {
  const campaignId = await resolveCampaignByTrackingProtocol(supabase, consultantId, messageText);
  return campaignId ? { campaignId, method: "protocol", sourceAdId: null } : null;
}