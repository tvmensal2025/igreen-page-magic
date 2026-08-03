/**
 * Espelho FRONT da regra de frase do banner do CONSULTOR (QR vivo).
 *
 * Fonte da verdade: `supabase/functions/qr-redirect/index.ts`
 * (`resolveConsultantBannerMessage`). Aqui é só PRÉVIA — para o consultor ver
 * exatamente o texto que vai abrir no WhatsApp do lead, sem precisar escanear.
 *
 * REGRA (banner do próprio consultor):
 *   1. frase do local (spot.phrase) vence;
 *   2. senão a frase padrão do consultor (`banner_default_phrase`);
 *   3. senão a frase genérica do sistema.
 * NUNCA anexa keyword nem marcador — o lead já cai no canal do dono.
 * (Parceiro é diferente: ver `components/admin/parceiros/qrPhrase.ts`.)
 */

export const CONSULTANT_QR_DEFAULT_MESSAGE =
  "Oi! 👋 Vi sobre a iGreen Energy e quero saber como economizar na minha conta de luz.";

export const CONSULTANT_QR_PHRASE_MAX = 600;

function tidy(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** Texto exato que o lead verá ao abrir o QR do banner do consultor. */
export function resolveConsultantBannerPhrase(
  spotPhrase?: string | null,
  consultantDefaultPhrase?: string | null,
): string {
  const custom = tidy(spotPhrase ?? "");
  if (custom) return tidy(custom.slice(0, CONSULTANT_QR_PHRASE_MAX));
  const fallback = tidy(consultantDefaultPhrase ?? "");
  return fallback
    ? tidy(fallback.slice(0, CONSULTANT_QR_PHRASE_MAX))
    : CONSULTANT_QR_DEFAULT_MESSAGE;
}

/** Origem da frase — usado para explicar na UI de onde ela veio. */
export function consultantBannerPhraseSource(
  spotPhrase?: string | null,
  consultantDefaultPhrase?: string | null,
): "local" | "padrao" | "sistema" {
  if (tidy(spotPhrase ?? "")) return "local";
  if (tidy(consultantDefaultPhrase ?? "")) return "padrao";
  return "sistema";
}
