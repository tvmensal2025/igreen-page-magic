/**
 * Links de parceiro / panfleto.
 *
 * - URL pública (marca): `igreen.cloud/r/{ref}/{code}`
 *   O `index.html` redireciona NA HORA pra edge (antes do React/cookies).
 * - Edge `qr-redirect`: HTTP 302 → `wa.me/...` (abre WhatsApp/Business).
 */

export const PUBLIC_PARTNER_BASE = "https://igreen.cloud";

export const QR_REDIRECT_BASE =
  "https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/qr-redirect";

/** Link curto com marca — use no QR e no “copiar link”. */
export function buildPartnerPublicShortLink(
  ref: string,
  code: string,
): string {
  return `${PUBLIC_PARTNER_BASE}/r/${encodeURIComponent(ref.trim())}/${encodeURIComponent(code.trim())}`;
}

/**
 * URL da edge que faz 302 direto pro WhatsApp.
 * Usada pelo bounce de `/r/...` (index.html / PartnerRedirectPage).
 */
export function buildPartnerWaRedirectUrl(
  ref: string,
  code?: string | null,
  msg?: string | null,
): string {
  const params = new URLSearchParams();
  params.set("l", ref.trim());
  const c = (code ?? "").trim();
  if (c) params.set("c", c);
  const m = (msg ?? "").trim();
  if (m) params.set("msg", m);
  return `${QR_REDIRECT_BASE}?${params.toString()}`;
}
