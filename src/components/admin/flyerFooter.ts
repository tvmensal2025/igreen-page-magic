/** Faixa de rodapé (licenciado + WhatsApp) — posição, tamanho e desenho no canvas. */

export interface FlyerFooterDrawOptions {
  canvasW: number;
  canvasH: number;
  footerYPercent: number;
  footerHPercent: number;
  footerLeft: string;
  footerRight: string;
  bgColor?: string;
  textColor?: string;
  fontFamily?: string;
  fontWeight?: string;
}

const FOOTER_MIN_FONT_PX = 6;

/** Garante que a faixa fique 100% dentro do canvas (evita corte na borda). */
export function clampFooterBand(
  canvasH: number,
  footerYPercent: number,
  footerHPercent: number,
): { bandTop: number; bandHeight: number } {
  const bandHeight = canvasH * (footerHPercent / 100);
  let bandTop = (footerYPercent / 100) * canvasH - bandHeight / 2;
  bandTop = Math.max(0, Math.min(canvasH - bandHeight, bandTop));
  return { bandTop, bandHeight };
}

/** Largura útil da faixa (padding lateral + gap entre esquerda e direita). */
export function footerTextAvailableWidth(bandWidthPx: number): number {
  const sidePad = bandWidthPx * 0.025;
  const gap = bandWidthPx * 0.015;
  return bandWidthPx - sidePad * 2 - gap;
}

type TextMeasureFn = (text: string, fontSizePx: number) => number;

/**
 * Calcula o maior tamanho de fonte em que LICENCIADO + WHATSAPP cabem
 * na MESMA linha (encolhe até min 6px).
 */
export function computeFooterSingleLineFontSize(
  bandWidthPx: number,
  bandHeightPx: number,
  footerLeft: string,
  footerRight: string,
  measure: TextMeasureFn,
): number {
  const available = footerTextAvailableWidth(bandWidthPx);
  let fSize = Math.min(Math.round(bandHeightPx * 0.55), Math.round(bandHeightPx * 0.58));

  while (fSize > FOOTER_MIN_FONT_PX) {
    const wL = footerLeft ? measure(footerLeft, fSize) : 0;
    const wR = footerRight ? measure(footerRight, fSize) : 0;
    if (wL + wR <= available) return fSize;
    fSize -= 1;
  }

  return FOOTER_MIN_FONT_PX;
}

/** Fonte do preview HTML — espelha o cálculo do canvas. */
export function previewFooterFontSize(
  bandWidthPx: number,
  bandHeightPx: number,
  footerLeft: string,
  footerRight: string,
  fontWeight = "700",
): number {
  if (typeof document === "undefined") {
    return Math.max(FOOTER_MIN_FONT_PX, Math.round(bandHeightPx * 0.5));
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Math.max(FOOTER_MIN_FONT_PX, Math.round(bandHeightPx * 0.5));
  }
  const measure: TextMeasureFn = (text, fontSizePx) => {
    ctx.font = `${fontWeight} ${fontSizePx}px sans-serif`;
    return ctx.measureText(text).width;
  };
  return computeFooterSingleLineFontSize(
    bandWidthPx,
    bandHeightPx,
    footerLeft,
    footerRight,
    measure,
  );
}

/** Desenha a faixa no canvas — sempre 1 linha (nome à esq., WhatsApp à dir.). */
export function drawFlyerFooter(
  ctx: CanvasRenderingContext2D,
  opts: FlyerFooterDrawOptions,
): void {
  const {
    canvasW: CW,
    canvasH: CH,
    footerYPercent,
    footerHPercent,
    footerLeft,
    footerRight,
  } = opts;
  const bgColor = opts.bgColor ?? "#0a3d2c";
  const textColor = opts.textColor ?? "#fff200";
  const fontFamily = opts.fontFamily ?? "sans-serif";
  const fontWeight = opts.fontWeight ?? "700";

  const { bandTop, bandHeight } = clampFooterBand(CH, footerYPercent, footerHPercent);
  const sidePad = CW * 0.025;

  const measure: TextMeasureFn = (text, fontSizePx) => {
    ctx.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`;
    return ctx.measureText(text).width;
  };

  const fSize = computeFooterSingleLineFontSize(
    CW,
    bandHeight,
    footerLeft,
    footerRight,
    measure,
  );

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, bandTop, CW, bandHeight);
  ctx.fillStyle = textColor;
  ctx.font = `${fontWeight} ${fSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";

  const cyText = bandTop + bandHeight / 2;
  ctx.textAlign = "left";
  if (footerLeft) ctx.fillText(footerLeft, sidePad, cyText);
  ctx.textAlign = "right";
  if (footerRight) ctx.fillText(footerRight, CW - sidePad, cyText);
}
