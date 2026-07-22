export interface MetaObjectState {
  id?: string;
  effective_status?: string | null;
  configured_status?: string | null;
  issues_info?: Array<{ error_message?: string; error_summary?: string }> | null;
}

export interface ResolvedCampaignStatus {
  localStatus: "active" | "paused" | "pending_review" | "rejected";
  campaignEffectiveStatus: string;
  objectStatuses: string[];
  issues: string[];
}

const REJECTED = new Set([
  "DISAPPROVED",
  "ADSET_DISAPPROVED",
  "CAMPAIGN_DISAPPROVED",
  "WITH_ISSUES",
  "ERROR",
]);

const REVIEW = new Set([
  "IN_PROCESS",
  "PENDING_REVIEW",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
  "PENDING_RISK_REVIEW",
]);

/**
 * Campanha local = active quando a campanha e os adsets entregam e há
 * pelo menos 1 anúncio ACTIVE. Ads pausados de propósito (anti-zumbi / CPL)
 * NÃO empurram a campanha de volta para pending_review.
 * Estados desconhecidos ou transitórios permanecem em revisão.
 */
export function resolveCampaignEffectiveStatus(
  campaign: MetaObjectState | null,
  adsets: MetaObjectState[],
  ads: MetaObjectState[],
): ResolvedCampaignStatus {
  const objects = [campaign, ...adsets, ...ads].filter(Boolean) as MetaObjectState[];
  const objectStatuses = objects.map((item) => String(item.effective_status || "UNKNOWN").toUpperCase());
  const campaignEffectiveStatus = String(campaign?.effective_status || "UNKNOWN").toUpperCase();
  const adsetStatuses = adsets.map((item) => String(item.effective_status || "UNKNOWN").toUpperCase());
  const adStatuses = ads.map((item) => String(item.effective_status || "UNKNOWN").toUpperCase());
  const issues = objects.flatMap((item) => item.issues_info || [])
    .map((issue) => issue.error_message || issue.error_summary || "")
    .filter(Boolean);

  if (
    objectStatuses.some((status) => REJECTED.has(status)) ||
    (issues.length > 0 && objectStatuses.includes("WITH_ISSUES"))
  ) {
    return { localStatus: "rejected", campaignEffectiveStatus, objectStatuses, issues };
  }
  if (["PAUSED", "ARCHIVED", "DELETED"].includes(campaignEffectiveStatus)) {
    return { localStatus: "paused", campaignEffectiveStatus, objectStatuses, issues };
  }
  const hasExpectedHierarchy = Boolean(campaign) && adsets.length > 0 && ads.length > 0;
  const campaignActive = campaignEffectiveStatus === "ACTIVE";
  const adsetsOk = adsets.length > 0 && adsetStatuses.every((status) => status === "ACTIVE");
  const hasDeliveringAd = adStatuses.some((status) => status === "ACTIVE");
  if (hasExpectedHierarchy && campaignActive && adsetsOk && hasDeliveringAd) {
    return { localStatus: "active", campaignEffectiveStatus, objectStatuses, issues };
  }
  if (objectStatuses.some((status) => REVIEW.has(status))) {
    return { localStatus: "pending_review", campaignEffectiveStatus, objectStatuses, issues };
  }
  return { localStatus: "pending_review", campaignEffectiveStatus, objectStatuses, issues };
}
