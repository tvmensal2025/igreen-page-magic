/**
 * Âncora do Cérebro MG: resolução por configuração, com fallback legado.
 *
 * O id da campanha âncora e o do consultor piloto estavam escritos à mão em
 * quatro edge functions (mg-city-rotator, auto-pause, campaign-brain-rank,
 * cpl-correction) e ainda numa tela do front. Isso amarra o motor a UM
 * consultor: qualquer outro que ligue o Cérebro escala/pausa a campanha errada,
 * ou nenhuma.
 *
 * Aqui os valores existem UMA vez, marcados como legado, e só entram em cena
 * como fallback quando `brain_config` não traz a configuração. O caminho
 * preferido é sempre `consultant_ad_settings.brain_config`.
 *
 * Os valores NÃO foram apagados de propósito: são o estado real de produção
 * hoje e removê-los quebraria a operação atual antes da migração de config.
 */

/** Consultor piloto do Cérebro MG (Rafael). Fallback legado. */
export const LEGACY_MG_CONSULTANT_ID = "0c2711ad-4836-41e6-afba-edd94f698ae3";

/** Campanha âncora (Uberlândia) do consultor piloto. Fallback legado. */
export const LEGACY_ANCHOR_CAMPAIGN_ID = "a0189d12-413a-477d-b903-1bca7a61f44a";

/** Criativo vencedor usado nas exploradoras. Fallback legado. */
export const LEGACY_WINNER_PHOTO_URL =
  "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/consultant-photos/0c2711ad-4836-41e6-afba-edd94f698ae3/ads/1783509775658-1000668870.png";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Forma mínima aceita — evita depender do tipo completo de BrainConfig. */
export interface AnchorConfigLike {
  anchor_campaign_id?: string | null;
  winner_photo_url?: string | null;
}

/**
 * Campanha âncora do consultor.
 *
 * Ordem: override explícito do request → `brain_config.anchor_campaign_id` →
 * fallback legado APENAS para o consultor piloto. Para qualquer outro
 * consultor sem configuração, devolve `null`: é melhor não fazer nada do que
 * escalar a campanha de outra pessoa.
 */
export function resolveAnchorCampaignId(
  consultantId: string,
  config: AnchorConfigLike | null | undefined,
  override?: unknown,
): string | null {
  if (isUuid(override)) return String(override).trim();
  if (isUuid(config?.anchor_campaign_id)) {
    return String(config?.anchor_campaign_id).trim();
  }
  if (consultantId === LEGACY_MG_CONSULTANT_ID) {
    return LEGACY_ANCHOR_CAMPAIGN_ID;
  }
  return null;
}

/**
 * Criativo das exploradoras. Só aceita HTTPS; fallback legado restrito ao
 * consultor piloto (a URL aponta para a pasta dele).
 */
export function resolveWinnerPhotoUrl(
  consultantId: string,
  config: AnchorConfigLike | null | undefined,
): string | null {
  const configured = config?.winner_photo_url;
  if (typeof configured === "string" && configured.trim()) {
    try {
      const url = new URL(configured.trim());
      if (url.protocol === "https:") return url.toString();
    } catch {
      // URL inválida não vira criativo.
    }
  }
  if (consultantId === LEGACY_MG_CONSULTANT_ID) {
    return LEGACY_WINNER_PHOTO_URL;
  }
  return null;
}
