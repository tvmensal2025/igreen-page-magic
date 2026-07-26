/**
 * Elegibilidade do Cérebro de orçamento por campanha (brain_scale_*).
 *
 * Espelha a regra do cron (`facebook-auto-pause`): NÃO escala MG-ROT nem a
 * âncora do Cérebro MG (lá o rotator manda no budget).
 *
 * Âncora = `brain_config.anchor_campaign_id` do consultor (+ UUID legado).
 * Nunca bloqueia só por nome "UDI" / cidade — campanhas parceiro em Uberlândia
 * devem poder ligar o Brain Scale.
 *
 * Se já estiver ligado, a UI continua mostrando o botão para poder DESLIGAR
 * (mesmo que a campanha tenha virado âncora depois).
 */

/** Espelho de `_shared/ads-anchor.ts` → LEGACY_ANCHOR_CAMPAIGN_ID */
export const LEGACY_ANCHOR_CAMPAIGN_ID =
  "a0189d12-413a-477d-b903-1bca7a61f44a";

export type BrainScaleCampaignLike = {
  id: string;
  name: string;
  brain_scale_enabled?: boolean | null;
};

export type BrainScaleEligibilityOpts = {
  /** UUID da âncora em consultant_ad_settings.brain_config.anchor_campaign_id */
  anchorCampaignId?: string | null;
};

export function isMgRotCampaignName(name: string | null | undefined): boolean {
  return /^MG-ROT-/i.test(String(name || ""));
}

export function isAnchorCampaignId(
  campaignId: string,
  anchorCampaignId?: string | null,
): boolean {
  const id = String(campaignId || "").trim();
  if (!id) return false;
  if (id === LEGACY_ANCHOR_CAMPAIGN_ID) return true;
  const anchor = typeof anchorCampaignId === "string"
    ? anchorCampaignId.trim()
    : "";
  return Boolean(anchor) && id === anchor;
}

/**
 * Mostra o botão Brain na lista?
 * - Já ligado → sim (para desligar / ajustar).
 * - MG-ROT ou âncora → não (ligar novo).
 * - Demais campanhas com fb → sim.
 */
export function isBrainScaleEligible(
  campaign: BrainScaleCampaignLike,
  opts?: BrainScaleEligibilityOpts,
): boolean {
  if (campaign.brain_scale_enabled) return true;
  if (isMgRotCampaignName(campaign.name)) return false;
  if (isAnchorCampaignId(campaign.id, opts?.anchorCampaignId)) return false;
  return true;
}
