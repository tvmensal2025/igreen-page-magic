// Safety-net matcher: even when Meta omits referral.source_id, the ad's source_url
// (or link previews) often contain the ad_id itself. Extract it and try to resolve
// the campaign deterministically via facebook_campaigns.fb_ad_ids.

const AD_ID_PATTERNS: RegExp[] = [
  /[?&]ad_id=(\d{6,})/i,
  /[?&]adset_id=(\d{6,})/i,
  /\/ads\/(\d{6,})/i,
  /adid[=%3D](\d{6,})/i,
  /\bad_id%3D(\d{6,})/i,
  /\bad_id=(\d{6,})/i,
];

/** Extracts a Meta ad_id from any URL-like string. Returns null when nothing matches. */
export function extractAdIdFromSourceUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* ignore */ }
  try { decoded = decodeURIComponent(decoded); } catch { /* ignore */ }

  for (const rx of AD_ID_PATTERNS) {
    const m = decoded.match(rx) || url.match(rx);
    if (m && m[1]) return m[1];
  }
  return null;
}

/** Given a consultant + a possible source_url, tries to find a campaign by ad_id. */
export async function resolveCampaignByAdIdInUrl(
  supabase: any,
  consultantId: string,
  sourceUrl: string | null | undefined,
): Promise<{ campaignId: string; adId: string } | null> {
  const adId = extractAdIdFromSourceUrl(sourceUrl);
  if (!adId) return null;
  try {
    const { data } = await supabase
      .from("facebook_campaigns")
      .select("id")
      .eq("consultant_id", consultantId)
      .contains("fb_ad_ids", [adId])
      .maybeSingle();
    if ((data as any)?.id) return { campaignId: (data as any).id, adId };
  } catch (e) {
    console.warn("[ctwa-url-extractor] lookup falhou:", (e as Error).message);
  }
  return null;
}
