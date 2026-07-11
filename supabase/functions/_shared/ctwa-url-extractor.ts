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
    // Não usar `.contains("fb_ad_ids", [adId])`: em produção o jsonb pode vir
    // como número ou string. Comparar em JS normaliza os dois formatos.
    const { data } = await supabase
      .from("facebook_campaigns")
      .select("id, fb_ad_ids, status, updated_at, created_at")
      .eq("consultant_id", consultantId)
      .not("fb_ad_ids", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1000);
    const matches = ((data || []) as any[]).filter((c) => {
      const list = c.fb_ad_ids;
      if (Array.isArray(list)) return list.some((v) => String(v).trim() === adId);
      if (typeof list === "string") {
        try {
          const parsed = JSON.parse(list);
          if (Array.isArray(parsed)) return parsed.some((v) => String(v).trim() === adId);
        } catch { /* plain string fallback */ }
        return list.split(/[\s,;|]+/).some((v) => v.trim() === adId);
      }
      return false;
    });
    matches.sort((a, b) => {
      const rank = (s: string) => (s === "active" ? 0 : s === "pending_review" ? 1 : s === "paused" ? 2 : 3);
      const r = rank(String(a.status || "")) - rank(String(b.status || ""));
      if (r !== 0) return r;
      return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
    });
    if (matches[0]?.id) return { campaignId: String(matches[0].id), adId };
  } catch (e) {
    console.warn("[ctwa-url-extractor] lookup falhou:", (e as Error).message);
  }
  return null;
}
