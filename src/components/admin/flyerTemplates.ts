/**
 * Templates canônicos A4 + Banner 504×904 — fonte única para
 * PartnerQrCode, PartnerBannerLiveModal, PartnerPortalDownloadModal
 * e ConsultantBannerDownloadModal (preview + PDF/PNG).
 */

export type FlyerFormatId = "a4" | "banner";

export type FlyerTemplate = {
  label: string;
  bg: string;
  canvasW: number;
  canvasH: number;
  pdfWmm: number;
  pdfHmm: number;
  /** Centro X do QR (% da LARGURA). */
  qrX: number;
  /** Centro Y do QR (% da ALTURA). */
  qrY: number;
  /** Lado do QR (% da LARGURA — não da altura). */
  qrSize: number;
  footerY: number;
  footerH: number;
};

export const FLYER_TEMPLATES: Record<FlyerFormatId, FlyerTemplate> = {
  a4: {
    label: "Folha A4",
    bg: "/images/banner-a4.jpg",
    canvasW: 1240,
    canvasH: 1754,
    pdfWmm: 210,
    pdfHmm: 297,
    qrX: 25,
    qrY: 91,
    qrSize: 16,
    footerY: 99,
    footerH: 2.6,
  },
  banner: {
    label: "Banner 504×904mm",
    bg: "/images/banner-504x904.jpg",
    canvasW: 1008,
    canvasH: 1808,
    pdfWmm: 504,
    pdfHmm: 904,
    qrX: 15,
    qrY: 89,
    qrSize: 23,
    footerY: 100,
    footerH: 3,
  },
};

export const FLYER_PREVIEW_W = 320;
export const FLYER_PREVIEW_MAX_H = 440;
export const FLYER_QR_QUIET_PX = 2;
export const FLYER_QR_BORDER_PX = 1;

export function flyerFooterLeft(
  consultantName: string,
  consultantIgreenId?: string,
  emptyLabel = "LICENCIADO: CONSULTOR IGREEN",
): string {
  const name = String(consultantName || "").trim();
  if (!name) return emptyLabel;
  const id = String(consultantIgreenId || "").replace(/\D/g, "");
  return `LICENCIADO: ${name.toUpperCase()}${id ? ` • ID ${id}` : ""}`;
}

export function flyerFooterRight(phoneDisplay: string): string {
  const p = String(phoneDisplay || "").trim();
  return p ? `WHATSAPP: ${p}` : "WHATSAPP: —";
}
