// =============================================================================
// Data Layers — qualidade profissional (foto aérea HD + mapa de calor solar)
// =============================================================================
// Baixa os GeoTIFFs da Solar API (rgbUrl: foto aérea ~10cm/px; annualFluxUrl:
// irradiação anual; maskUrl: máscara do telhado) e compõe uma imagem PNG:
//   - foto aérea de alta resolução como base;
//   - mapa de calor de irradiação (paleta "iron") sobreposto só no telhado,
//     com leve transparência — igual às ferramentas profissionais.
// Renderiza no servidor (a chave nunca vai ao browser) e devolve PNG.
// Baseado no sample oficial googlemaps-samples/js-solar-potential.
// =============================================================================
import { fromArrayBuffer } from "https://esm.sh/geotiff@2.1.3";
import UPNG from "https://esm.sh/upng-js@2.1.0";

export interface GeoTiffData {
  width: number;
  height: number;
  rasters: number[][];
  bounds: { north: number; south: number; east: number; west: number };
}

/** Paleta "iron" — sombra (escuro) → sol pleno (claro). Igual ao demo Google. */
const IRON_PALETTE = ["00000a", "91009c", "e64616", "feb400", "fffff6"];

/** Baixa e parseia um GeoTIFF da Solar API (autenticado pela key). */
export async function downloadGeoTiff(url: string, apiKey: string): Promise<GeoTiffData> {
  const u = new URL(url);
  u.searchParams.set("key", apiKey);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`GeoTIFF download falhou (${res.status})`);
  const buf = await res.arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  const width = image.getWidth();
  const height = image.getHeight();
  // bounding box em coordenadas do tiff; a Solar API entrega em EPSG:4326.
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  return {
    width,
    height,
    rasters: Array.from(rasters as ArrayLike<ArrayLike<number>>).map((r) =>
      Array.from(r as ArrayLike<number>)
    ),
    bounds: { west: minX, south: minY, east: maxX, north: maxY },
  };
}

/** Interpola a paleta para 256 cores RGB. */
function buildPalette(hexColors: string[]): Array<[number, number, number]> {
  const stops = hexColors.map((h) => [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]);
  const out: Array<[number, number, number]> = [];
  const n = 256;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (stops.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(stops.length - 1, lo + 1);
    const f = t - lo;
    out.push([
      Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f),
      Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f),
      Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f),
    ]);
  }
  return out;
}

function bilinearSample(raster: number[], w: number, h: number, fx: number, fy: number): number {
  const x = Math.min(w - 1, Math.max(0, fx));
  const y = Math.min(h - 1, Math.max(0, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const dx = x - x0, dy = y - y0;
  const v00 = raster[y0 * w + x0], v10 = raster[y0 * w + x1];
  const v01 = raster[y1 * w + x0], v11 = raster[y1 * w + x1];
  return v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy) + v01 * (1 - dx) * dy + v11 * dx * dy;
}

export interface ComposeOptions {
  /** Mostrar heatmap de irradiação sobre o telhado (default true). */
  showFlux?: boolean;
  /** Opacidade do heatmap (0..1). */
  fluxOpacity?: number;
  /** Min/Max do flux (kWh/kW/ano) para normalizar a paleta. */
  fluxMin?: number;
  fluxMax?: number;
}

/**
 * Compõe foto aérea HD (rgb) + heatmap (annualFlux) mascarado (mask) num PNG.
 * Reamostra flux/mask para a grade da foto (bilinear), aplicando a paleta.
 */
export function composeHdRoofPng(
  rgb: GeoTiffData,
  flux: GeoTiffData | null,
  mask: GeoTiffData | null,
  opts: ComposeOptions = {},
): Uint8Array {
  const showFlux = opts.showFlux ?? true;
  const fluxOpacity = opts.fluxOpacity ?? 0.55;
  const fluxMin = opts.fluxMin ?? 0;
  const fluxMax = opts.fluxMax ?? 1800;
  const palette = buildPalette(IRON_PALETTE);

  const w = rgb.width, h = rgb.height;
  const out = new Uint8Array(w * h * 4);
  const R = rgb.rasters[0], G = rgb.rasters[1] ?? rgb.rasters[0], B = rgb.rasters[2] ?? rgb.rasters[0];

  const fW = flux?.width ?? 0, fH = flux?.height ?? 0;
  const mW = mask?.width ?? 0, mH = mask?.height ?? 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let r = R[i], g = G[i], b = B[i];

      if (showFlux && flux) {
        // posição relativa → coordenada na grade do flux/mask
        const rx = (x / w) * fW, ry = (y / h) * fH;
        const fv = bilinearSample(flux.rasters[0], fW, fH, rx, ry);
        let inRoof = 1;
        if (mask) {
          const mx = (x / w) * mW, my = (y / h) * mH;
          inRoof = bilinearSample(mask.rasters[0], mW, mH, mx, my) > 0.5 ? 1 : 0;
        }
        if (inRoof && Number.isFinite(fv) && fv > 0) {
          const t = Math.min(1, Math.max(0, (fv - fluxMin) / (fluxMax - fluxMin)));
          const [pr, pg, pb] = palette[Math.round(t * 255)];
          r = Math.round(r * (1 - fluxOpacity) + pr * fluxOpacity);
          g = Math.round(g * (1 - fluxOpacity) + pg * fluxOpacity);
          b = Math.round(b * (1 - fluxOpacity) + pb * fluxOpacity);
        }
      }

      out[i * 4] = r;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = b;
      out[i * 4 + 3] = 255;
    }
  }

  const png = UPNG.encode([out.buffer], w, h, 0);
  return new Uint8Array(png);
}

export interface HdRoofResult {
  png: Uint8Array;
  bounds: { north: number; south: number; east: number; west: number };
  width: number;
  height: number;
}

/**
 * Pipeline completo: baixa os 3 layers e devolve o PNG composto + bounds
 * (lat/lng dos cantos), que o frontend usa para projetar os painéis.
 */
export async function buildHdRoof(
  dataLayers: { rgbUrl?: string; annualFluxUrl?: string; maskUrl?: string },
  apiKey: string,
  opts: ComposeOptions = {},
): Promise<HdRoofResult> {
  if (!dataLayers.rgbUrl) throw new Error("rgbUrl ausente nos data layers");
  const rgb = await downloadGeoTiff(dataLayers.rgbUrl, apiKey);
  const [flux, mask] = await Promise.all([
    dataLayers.annualFluxUrl ? downloadGeoTiff(dataLayers.annualFluxUrl, apiKey).catch(() => null) : null,
    dataLayers.maskUrl ? downloadGeoTiff(dataLayers.maskUrl, apiKey).catch(() => null) : null,
  ]);
  const png = composeHdRoofPng(rgb, flux, mask, opts);
  return { png, bounds: rgb.bounds, width: rgb.width, height: rgb.height };
}
