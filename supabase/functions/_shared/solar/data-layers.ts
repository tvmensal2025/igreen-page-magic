// =============================================================================
// Data Layers — qualidade profissional (foto aérea HD + mapa de calor solar)
// =============================================================================
// Baixa os GeoTIFFs da Solar API (rgbUrl: foto aérea ~10cm/px; annualFluxUrl:
// irradiação anual; maskUrl: máscara do telhado) e compõe uma imagem PNG:
//   - foto aérea de alta resolução como base;
//   - mapa de calor de irradiação (paleta "iron") sobreposto só no telhado.
// Renderiza no servidor (a chave nunca vai ao browser) e devolve PNG.
//
// Usa utif2 (decoder TIFF puro-JS, compatível com o bundler do Supabase —
// geotiff puxa `node:vm` e não builda no edge) + upng-js para encode PNG.
// Baseado no sample oficial googlemaps-samples/js-solar-potential.
// =============================================================================
import UTIF from "npm:utif2@4.1.0";
import UPNG from "npm:upng-js@2.1.0";

export interface DecodedTiff {
  width: number;
  height: number;
  /** RGBA (Uint8) — presente para o layer RGB. */
  rgba?: Uint8Array;
  /** Valores brutos do primeiro band (float) — presente para flux/mask. */
  values?: Float32Array;
}

/** Baixa e decodifica um GeoTIFF da Solar API (autenticado pela key). */
export async function downloadTiff(url: string, apiKey: string, wantRgba: boolean): Promise<DecodedTiff> {
  const u = new URL(url);
  u.searchParams.set("key", apiKey);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`GeoTIFF download falhou (${res.status})`);
  const buf = await res.arrayBuffer();
  const ifds = UTIF.decode(buf);
  const ifd = ifds[0];
  UTIF.decodeImage(buf, ifd, ifds);
  const width = ifd.width as number;
  const height = ifd.height as number;

  if (wantRgba) {
    const rgba = new Uint8Array(UTIF.toRGBA8(ifd));
    return { width, height, rgba };
  }

  // Valores brutos do primeiro band (flux/mask são float32 single-band).
  const data = ifd.data as Uint8Array;
  const spp = (ifd.t277 ? (ifd.t277 as number[])[0] : 1) || 1; // SamplesPerPixel
  const fmt = (ifd.t339 ? (ifd.t339 as number[])[0] : 1) || 1; // SampleFormat (3=float)
  const bps = (ifd.t258 ? (ifd.t258 as number[])[0] : 32) || 32; // BitsPerSample
  const n = width * height;
  const values = new Float32Array(n);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bytesPerSample = bps / 8;
  const stride = bytesPerSample * spp;
  for (let i = 0; i < n; i++) {
    const off = i * stride;
    if (off + bytesPerSample > data.byteLength) break;
    if (fmt === 3 && bps === 32) values[i] = dv.getFloat32(off, true);
    else if (bps === 32) values[i] = dv.getUint32(off, true);
    else if (bps === 16) values[i] = dv.getUint16(off, true);
    else values[i] = data[off];
  }
  return { width, height, values };
}

/** Paleta "iron" — sombra (escuro) → sol pleno (claro). Igual ao demo Google. */
const IRON_PALETTE = ["00000a", "91009c", "e64616", "feb400", "fffff6"];

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

function sampleNearest(values: Float32Array, w: number, h: number, fx: number, fy: number): number {
  const x = Math.min(w - 1, Math.max(0, Math.round(fx)));
  const y = Math.min(h - 1, Math.max(0, Math.round(fy)));
  return values[y * w + x];
}

export interface ComposeOptions {
  showFlux?: boolean;
  fluxOpacity?: number;
  fluxMin?: number;
  fluxMax?: number;
}

/** Compõe foto aérea HD (rgba) + heatmap (flux) mascarado (mask) num PNG. */
export function composeHdRoofPng(
  rgb: DecodedTiff,
  flux: DecodedTiff | null,
  mask: DecodedTiff | null,
  opts: ComposeOptions = {},
): Uint8Array {
  const showFlux = opts.showFlux ?? true;
  const fluxOpacity = opts.fluxOpacity ?? 0.5;
  const fluxMin = opts.fluxMin ?? 0;
  const fluxMax = opts.fluxMax ?? 1800;
  const palette = buildPalette(IRON_PALETTE);

  const w = rgb.width, h = rgb.height;
  const src = rgb.rgba!;
  const out = new Uint8Array(w * h * 4);
  const fW = flux?.width ?? 0, fH = flux?.height ?? 0;
  const mW = mask?.width ?? 0, mH = mask?.height ?? 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = src[i], g = src[i + 1], b = src[i + 2];

      if (showFlux && flux?.values) {
        const fv = sampleNearest(flux.values, fW, fH, (x / w) * fW, (y / h) * fH);
        let inRoof = 1;
        if (mask?.values) {
          inRoof = sampleNearest(mask.values, mW, mH, (x / w) * mW, (y / h) * mH) > 0.5 ? 1 : 0;
        }
        if (inRoof && Number.isFinite(fv) && fv > 0) {
          const t = Math.min(1, Math.max(0, (fv - fluxMin) / (fluxMax - fluxMin)));
          const [pr, pg, pb] = palette[Math.round(t * 255)];
          r = Math.round(r * (1 - fluxOpacity) + pr * fluxOpacity);
          g = Math.round(g * (1 - fluxOpacity) + pg * fluxOpacity);
          b = Math.round(b * (1 - fluxOpacity) + pb * fluxOpacity);
        }
      }
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
    }
  }
  return new Uint8Array(UPNG.encode([out.buffer], w, h, 0));
}

export interface HdRoofResult {
  png: Uint8Array;
  width: number;
  height: number;
}

/** Pipeline: baixa os 3 layers e devolve o PNG composto. */
export async function buildHdRoof(
  dataLayers: { rgbUrl?: string; annualFluxUrl?: string; maskUrl?: string },
  apiKey: string,
  opts: ComposeOptions = {},
): Promise<HdRoofResult> {
  if (!dataLayers.rgbUrl) throw new Error("rgbUrl ausente nos data layers");
  const rgb = await downloadTiff(dataLayers.rgbUrl, apiKey, true);
  const [flux, mask] = await Promise.all([
    dataLayers.annualFluxUrl ? downloadTiff(dataLayers.annualFluxUrl, apiKey, false).catch(() => null) : null,
    dataLayers.maskUrl ? downloadTiff(dataLayers.maskUrl, apiKey, false).catch(() => null) : null,
  ]);
  const png = composeHdRoofPng(rgb, flux, mask, opts);
  return { png, width: rgb.width, height: rgb.height };
}
