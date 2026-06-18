import { useCallback, useEffect, useState } from "react";

/**
 * Calcula tamanho do preview na tela (só visual).
 * Não altera TEMPLATE_DIMS nem mm do PDF — export usa canvas nativo.
 */
export function computeFlyerPreviewSize(
  canvasW: number,
  canvasH: number,
  basePreviewW: number,
  maxPreviewH: number,
  maxViewportW?: number,
): { width: number; height: number } {
  const aspect = canvasH / canvasW;
  let w = basePreviewW;
  if (maxViewportW != null && maxViewportW > 0) {
    w = Math.min(w, maxViewportW);
  }
  let h = w * aspect;
  if (h > maxPreviewH) {
    h = maxPreviewH;
    w = h / aspect;
  }
  return { width: Math.round(w), height: Math.round(h) };
}

/** Preview responsivo: encolhe em telas estreitas, mantém proporção do template. */
export function useFlyerPreviewSize(
  canvasW: number,
  canvasH: number,
  basePreviewW = 320,
  maxPreviewH = 440,
  horizontalPad = 48,
) {
  const getViewportCap = useCallback(
    () =>
      typeof window !== "undefined"
        ? Math.max(140, window.innerWidth - horizontalPad)
        : basePreviewW,
    [basePreviewW, horizontalPad],
  );

  const [viewportCap, setViewportCap] = useState(getViewportCap);

  useEffect(() => {
    const onResize = () => setViewportCap(getViewportCap());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [getViewportCap]);

  return computeFlyerPreviewSize(
    canvasW,
    canvasH,
    basePreviewW,
    maxPreviewH,
    viewportCap,
  );
}
