/**
 * Link vivo do banner do consultor.
 *
 * Padrão: igreen.cloud/{iniciais}/{igreen_id}[/{codigo-local}]
 * Ex.: igreen.cloud/rfd/130392
 *      igreen.cloud/rfd/130392/posto-shell
 *
 * - iniciais = 1ª letra de cada palavra do nome (Rafael Ferreira Dias → rfd)
 * - igreen_id = fonte da verdade (resolve o consultor)
 * - codigo-local = spot no banco (frase/keyword editáveis sem reimprimir)
 */

import { PUBLIC_PARTNER_BASE } from "@/lib/partnerShortLink";

/** Segmentos de 1º path reservados (não podem ser iniciais). */
export const BANNER_INITIALS_RESERVED = new Set([
  "admin",
  "auth",
  "crm",
  "r",
  "b",
  "api",
  "app",
  "www",
  "cdn",
  "static",
  "assets",
  "login",
  "logout",
  "reset",
  "install",
  "tutorial",
  "premium",
  "ajuda",
  "help",
  "docs",
  "super",
]);

/** Iniciais a partir do nome: "Rafael Ferreira Dias" → "rfd". */
export function buildConsultantBannerInitials(
  name?: string | null,
  displayName?: string | null,
): string {
  const raw = String(displayName || name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z\s]/g, " ")
    .trim();
  const parts = raw.split(/\s+/).filter((p) => p.length > 0);
  let initials = parts
    .map((p) => p[0] || "")
    .join("")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (initials.length < 2) {
    initials = (initials + "ig").slice(0, 2);
  }
  if (initials.length > 8) initials = initials.slice(0, 8);
  if (BANNER_INITIALS_RESERVED.has(initials)) {
    initials = `${initials}x`.slice(0, 8);
  }
  return initials;
}

/** Slug estável do local para a URL (não mudar depois de imprimir). */
export function slugifyBannerSpotCode(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48);
}

export function buildConsultantLiveBannerUrl(opts: {
  initials: string;
  igreenId: string;
  spotCode?: string | null;
}): string {
  const ini = String(opts.initials || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 8);
  const id = String(opts.igreenId || "").replace(/\D/g, "");
  if (!ini || !id) return PUBLIC_PARTNER_BASE;
  const spot = slugifyBannerSpotCode(opts.spotCode || "");
  const path = spot
    ? `/${ini}/${id}/${spot}`
    : `/${ini}/${id}`;
  return `${PUBLIC_PARTNER_BASE}${path}`;
}
