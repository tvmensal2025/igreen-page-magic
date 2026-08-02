/**
 * Download apenas do QR Code (sem arte / sem rodapé).
 *
 * Usa exatamente o MESMO SVG do QR que vai no banner/panfleto — ou seja,
 * é o mesmo QR vivo (mesma URL curta, mesmo spot). Só muda o "envelope":
 * aqui sai um PNG quadrado com fundo branco + quiet zone + moldura fina,
 * pronto pra etiquetadora / etiqueta adesiva.
 */

/** Lado padrão do PNG do QR isolado (alta resolução pra impressão). */
export const QR_ONLY_PNG_SIZE = 1200;

export async function renderQrOnlyCanvas(
  svgEl: SVGElement,
  sizePx: number = QR_ONLY_PNG_SIZE,
): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Fundo branco total (quiet zone garantida).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sizePx, sizePx);

  const quiet = Math.max(8, Math.round(sizePx * 0.06));
  const border = Math.max(2, Math.round(sizePx * 0.004));
  const inner = sizePx - quiet * 2;

  const svgData = new XMLSerializer().serializeToString(svgEl);
  const svgUrl =
    "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));

  const ok = await new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, quiet, quiet, inner, inner);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = svgUrl;
  });
  if (!ok) return null;

  // Moldura fina igual à do banner.
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = border;
  ctx.strokeRect(
    border / 2,
    border / 2,
    sizePx - border,
    sizePx - border,
  );

  return canvas;
}

/** Gera e dispara o download do PNG do QR isolado. Retorna true se ok. */
export async function downloadQrOnlyPng(
  svgEl: SVGElement | null | undefined,
  fileBase: string,
  sizePx: number = QR_ONLY_PNG_SIZE,
): Promise<boolean> {
  if (!svgEl) return false;
  const canvas = await renderQrOnlyCanvas(svgEl, sizePx);
  if (!canvas) return false;
  const a = document.createElement("a");
  a.download = `qrcode-${fileBase}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
  return true;
}
