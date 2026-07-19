import { resolveCampaignByTrackingProtocol, resolveCampaignByExactInitialMessage } from "./campaign-tracking.ts";
import { findReferralPaths } from "./ctwa-referral-probe.ts";
import { extractAdIdFromSourceUrl } from "./ctwa-url-extractor.ts";

export type DeterministicCampaignMethod =
  | "ad_id"
  | "ad_id_in_url"
  | "fb_campaign_id"
  | "ctwa_clid"
  | "protocol"
  | "exact_message";

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

function adIdsContain(list: unknown, adId: string | null | undefined): boolean {
  if (!adId) return false;
  const needle = String(adId).trim();
  if (!needle) return false;
  if (Array.isArray(list)) return list.some((v) => String(v).trim() === needle);
  if (typeof list === "string") {
    try {
      const parsed = JSON.parse(list);
      if (Array.isArray(parsed)) return parsed.some((v) => String(v).trim() === needle);
    } catch { /* plain string fallback */ }
    return list.split(/[\s,;|]+/).some((v) => v.trim() === needle);
  }
  return false;
}

async function campaignByAdId(supabase: any, consultantId: string, adId: string | null) {
  if (!adId) return null;

  // Não usar `.contains("fb_ad_ids", [adId])` aqui: em produção vimos AD IDs
  // numéricos-string do Meta passarem pela busca e caírem no fallback errado.
  // A lista de campanhas por consultor é pequena; buscar e comparar em JS é
  // mais previsível e mantém campanha 100% individual por AD ID.
  const { data, error } = await supabase
    .from("facebook_campaigns")
    .select("id, fb_ad_ids, status, updated_at, created_at")
    .eq("consultant_id", consultantId)
    .not("fb_ad_ids", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) {
    console.warn("[campaignByAdId] lookup falhou:", error.message);
    return null;
  }

  const matches = ((data || []) as any[]).filter((c) => adIdsContain(c.fb_ad_ids, adId));
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const rank = (s: string) => (s === "active" ? 0 : s === "pending_review" ? 1 : s === "paused" ? 2 : 3);
    const r = rank(String(a.status || "")) - rank(String(b.status || ""));
    if (r !== 0) return r;
    return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
  });
  return matches[0]?.id ? String(matches[0].id) : null;
}

export async function campaignContainsAdId(
  supabase: any,
  campaignId: string | null | undefined,
  adId: string | null | undefined,
  consultantId?: string | null,
): Promise<boolean> {
  if (!campaignId || !adId) return true;
  let query = supabase
    .from("facebook_campaigns")
    .select("id, fb_ad_ids")
    .eq("id", campaignId);
  if (consultantId) query = query.eq("consultant_id", consultantId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.warn("[campaignContainsAdId] lookup falhou:", error.message);
    return false;
  }
  return adIdsContain((data as any)?.fb_ad_ids, adId);
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
    const { data: mapping } = await supabase
      .from("ctwa_clid_mapping")
      .select("campaign_id")
      .eq("ctwa_clid", fields.ctwaClid)
      .maybeSingle();
    if ((mapping as any)?.campaign_id) {
      const { data: campaign } = await supabase
        .from("facebook_campaigns")
        .select("id")
        .eq("id", String((mapping as any).campaign_id))
        .eq("consultant_id", consultantId)
        .maybeSingle();
      if ((campaign as any)?.id) {
        return { campaignId: String((campaign as any).id), method: "ctwa_clid", sourceAdId: adId };
      }
    }
  }

  return null;
}

export async function resolveCampaignByProtocolOnly(
  supabase: any,
  consultantId: string,
  messageText: string | null | undefined,
): Promise<CampaignResolution | null> {
  // 1) Protocolo legado ainda na mensagem (campanhas antigas).
  const byProtocol = await resolveCampaignByTrackingProtocol(supabase, consultantId, messageText);
  if (byProtocol) return { campaignId: byProtocol, method: "protocol", sourceAdId: null };

  // 2) Frase limpa única == initial_message no banco (sem protocolo feio no WA).
  const byExact = await resolveCampaignByExactInitialMessage(supabase, consultantId, messageText);
  if (byExact) return { campaignId: byExact, method: "exact_message", sourceAdId: null };

  return null;
}