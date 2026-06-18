/** Placeholder visual para templates sem arte oficial (preview + export). */

const PLACEHOLDER_ART = "/images/banner-504x904.jpg";

export function templatePlaceholderArt(_canvasW: number, canvasH: number): string {
  // Arte oficial embaçada — proporção vertical cobre a maioria dos formatos.
  void canvasH;
  return PLACEHOLDER_ART;
}

/** Rótulo de tamanho de impressão exibido no placeholder. */
export function templateSizeHint(
  pdfWmm: number,
  pdfHmm: number,
  canvasW: number,
  canvasH: number,
  digital = false,
): string {
  if (digital) return `${canvasW}×${canvasH} px`;
  if (pdfWmm >= 1000) {
    const fmt = (n: number) => {
      const v = n / 1000;
      return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",");
    };
    return `${fmt(pdfWmm)}×${fmt(pdfHmm)} m`;
  }
  if (pdfWmm >= 100) {
    return `${pdfWmm / 10}×${pdfHmm / 10} cm`;
  }
  return `${pdfWmm}×${pdfHmm} mm`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** Fundo placeholder no canvas (arte embaçada + texto de tamanho). */
export async function drawFlyerPlaceholderBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  artSrc: string,
  sizeLabel: string,
): Promise<void> {
  ctx.fillStyle = "#0a3d2c";
  ctx.fillRect(0, 0, w, h);

  try {
    const img = await loadImage(artSrc);
    ctx.save();
    ctx.filter = "blur(14px)";
    drawImageCover(ctx, img, -w * 0.04, -h * 0.04, w * 1.08, h * 1.08);
    ctx.restore();
  } catch {
    /* mantém fundo verde */
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.52)";
  ctx.fillRect(0, 0, w, h);

  const titleSize = Math.max(12, Math.round(h * 0.026));
  const subSize = Math.max(10, Math.round(h * 0.02));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${titleSize}px sans-serif`;
  ctx.fillText("Envie a sua arte aqui", w / 2, h / 2 - subSize);
  ctx.fillStyle = "#fff200";
  ctx.font = `700 ${subSize}px sans-serif`;
  ctx.fillText(`Tamanho para impressão: ${sizeLabel}`, w / 2, h / 2 + titleSize * 0.55);
}
