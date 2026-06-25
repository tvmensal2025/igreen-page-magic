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
  /** Bounding box lat/lng (quando georreferenciado). */
  bounds?: { north: number; south: number; east: number; west: number };
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
    return { width, height, rgba, bounds: readBounds(ifd as Record<string, unknown>) };
  }

  // Endianness do arquivo TIFF: bytes iniciais "II"=little, "MM"=big.
  const head = new Uint8Array(buf, 0, 2);
  const littleEndian = head[0] === 0x49; // 'I'

  // Valores brutos do primeiro band (flux/mask são float32 single-band).
  const data = ifd.data as Uint8Array;
  const fmt = (ifd.t339 ? (ifd.t339 as number[])[0] : 1) || 1; // SampleFormat (3=float)
  const bps = (ifd.t258 ? (ifd.t258 as number[])[0] : 32) || 32; // BitsPerSample
  const spp = (ifd.t277 ? (ifd.t277 as number[])[0] : 1) || 1; // SamplesPerPixel
  const n = width * height;
  const values = new Float32Array(n);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bytesPerSample = bps / 8;
  const stride = bytesPerSample * spp;
  for (let i = 0; i < n; i++) {
    const off = i * stride;
    if (off + bytesPerSample > data.byteLength) break;
    if (fmt === 3 && bps === 32) values[i] = dv.getFloat32(off, littleEndian);
    else if (bps === 32) values[i] = dv.getUint32(off, littleEndian);
    else if (bps === 16) values[i] = dv.getUint16(off, littleEndian);
    else values[i] = data[off];
  }
  return { width, height, values };
}

/** Diagnóstico: inspeciona os campos do IFD de um GeoTIFF (flux). */
export async function downloadTiffDebug(url: string, apiKey: string): Promise<Record<string, unknown>> {
  const u = new URL(url);
  u.searchParams.set("key", apiKey);
  const res = await fetch(u.toString());
  const buf = await res.arrayBuffer();
  const ifds = UTIF.decode(buf);
  const ifd = ifds[0] as Record<string, unknown>;
  UTIF.decodeImage(buf, ifd, ifds);
  const data = ifd.data as Uint8Array | undefined;
  const keys = Object.keys(ifd).filter((k) => k.startsWith("t"));
  // tenta ler primeiros valores como float32 e uint8
  const sample: Record<string, unknown> = {};
  if (data && data.byteLength >= 16) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    sample.float32le = [dv.getFloat32(0, true), dv.getFloat32(4, true), dv.getFloat32(8, true)];
    sample.float32be = [dv.getFloat32(0, false), dv.getFloat32(4, false), dv.getFloat32(8, false)];
    // procura o primeiro valor "sensato" (0..3000) varrendo offsets LE
    let firstSane: { off: number; v: number } | null = null;
    for (let o = 0; o + 4 <= Math.min(data.byteLength, 4_000_000); o += 4) {
      const v = dv.getFloat32(o, true);
      if (Number.isFinite(v) && v > 10 && v < 3000) { firstSane = { off: o, v }; break; }
    }
    sample.firstSaneLE = firstSane;
    sample.firstBytes = Array.from(data.slice(0, 16));
    sample.dataLen = data.byteLength;
    sample.isTyped = data.constructor.name;
  }
  return {
    width: ifd.width, height: ifd.height,
    bitsPerSample: ifd.t258, sampleFormat: ifd.t339, samplesPerPixel: ifd.t277,
    compression: ifd.t259, photometric: ifd.t262,
    tags: keys, sample,
  };
}


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
  bounds?: { north: number; south: number; east: number; west: number };
}

/** Lê o bounding box (lat/lng) do GeoTIFF RGB a partir das tags GeoKeys. */
function readBounds(ifd: Record<string, unknown>): { north: number; south: number; east: number; west: number } | undefined {
  // ModelTiepoint (t33922) + ModelPixelScale (t33550) → georreferência.
  const tie = ifd.t33922 as number[] | undefined;
  const scale = ifd.t33550 as number[] | undefined;
  const w = ifd.width as number, h = ifd.height as number;
  if (tie && scale && tie.length >= 6 && scale.length >= 2) {
    const originLng = tie[3], originLat = tie[4];
    const west = originLng, north = originLat;
    const east = originLng + scale[0] * w;
    const south = originLat - scale[1] * h;
    return { north, south, east, west };
  }
  return undefined;
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
  return { png, width: rgb.width, height: rgb.height, bounds: rgb.bounds };
}
