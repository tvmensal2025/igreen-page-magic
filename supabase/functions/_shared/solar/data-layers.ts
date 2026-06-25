// =============================================================================
// Data Layers — imagem PROFISSIONAL do telhado (tudo numa só PNG, server-side)
// =============================================================================
// Compõe, no servidor, uma única imagem de alta qualidade:
//   1) foto aérea ~10 cm/px (rgbUrl) como base;
//   2) mapa de calor de irradiação (annualFluxUrl) mascarado no telhado (maskUrl);
//   3) os módulos solares desenhados nas COORDENADAS REAIS (lat/lng) — sem divs
//      sobrepostos no frontend, alinhamento perfeito.
//
// Georreferência: lê ModelTransformation (t34264) ou Tiepoint+Scale, detecta a
// CRS via GeoKeyDirectory (t34735) e converte para WGS84 (inverse Mercator p/
// EPSG:3857). Assim lat/lng → pixel é exato.
//
// utif2 = decoder TIFF puro-JS (compatível com o bundler do Supabase; geotiff
// puxa node:vm e não builda). upng-js = encode PNG.
// =============================================================================
import UTIF from "npm:utif2@4.1.0";
import UPNG from "npm:upng-js@2.1.0";

export interface LatLngBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface DecodedTiff {
  width: number;
  height: number;
  rgba?: Uint8Array;
  values?: Float32Array;
  bounds?: LatLngBounds;
}

export interface PanelDraw {
  lat: number;
  lng: number;
  widthM: number;
  heightM: number;
  azimuthDegrees: number;
}

// ─── Georreferência ─────────────────────────────────────────────────────────

const EARTH_R = 6378137;

/** Web Mercator (EPSG:3857) metros → WGS84 lat/lng. */
function mercatorToLatLng(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / EARTH_R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
  return { lat, lng };
}

/** Detecta a CRS pelo GeoKeyDirectory (t34735): 4326 (graus) ou 3857 (metros). */
function detectEpsg(ifd: Record<string, unknown>): number {
  const gk = ifd.t34735 as number[] | undefined;
  if (!gk) return 4326;
  // GeoKeyDirectory: header(4) + entries de 4. Procura ProjectedCSType(3072)
  // ou GeographicType(2048).
  for (let i = 4; i + 3 < gk.length; i += 4) {
    const key = gk[i];
    const value = gk[i + 3];
    if (key === 3072 && value && value !== 32767) return value; // projected
    if (key === 2048 && value && value !== 32767) return value; // geographic
  }
  return 4326;
}

/** Bounds em WGS84 a partir das tags de georreferência, tratando a CRS. */
function readBounds(ifd: Record<string, unknown>): LatLngBounds | undefined {
  const w = ifd.width as number, h = ifd.height as number;
  const epsg = detectEpsg(ifd);

  let corners: Array<{ x: number; y: number }> | null = null;
  const mt = ifd.t34264 as number[] | undefined;
  if (mt && mt.length >= 16) {
    const a = mt[0], b = mt[1], d = mt[3];
    const e = mt[4], f = mt[5], hh = mt[7];
    const c = (col: number, row: number) => ({ x: a * col + b * row + d, y: e * col + f * row + hh });
    corners = [c(0, 0), c(w, 0), c(0, h), c(w, h)];
  } else {
    const tie = ifd.t33922 as number[] | undefined;
    const scale = ifd.t33550 as number[] | undefined;
    if (tie && scale && tie.length >= 6 && scale.length >= 2) {
      const ox = tie[3], oy = tie[4];
      const c = (col: number, row: number) => ({ x: ox + scale[0] * col, y: oy - scale[1] * row });
      corners = [c(0, 0), c(w, 0), c(0, h), c(w, h)];
    }
  }
  if (!corners) return undefined;

  // Converte cantos para lat/lng conforme a CRS.
  const toLatLng = (p: { x: number; y: number }) =>
    epsg === 3857 ? mercatorToLatLng(p.x, p.y) : { lat: p.y, lng: p.x };
  const ll = corners.map(toLatLng);
  return {
    north: Math.max(...ll.map((p) => p.lat)),
    south: Math.min(...ll.map((p) => p.lat)),
    east: Math.max(...ll.map((p) => p.lng)),
    west: Math.min(...ll.map((p) => p.lng)),
  };
}

// ─── Decodificação ──────────────────────────────────────────────────────────

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

  const head = new Uint8Array(buf, 0, 2);
  const littleEndian = head[0] === 0x49; // 'I' = little, 'M' = big
  const data = ifd.data as Uint8Array;
  const fmt = (ifd.t339 ? (ifd.t339 as number[])[0] : 1) || 1;
  const bps = (ifd.t258 ? (ifd.t258 as number[])[0] : 32) || 32;
  const spp = (ifd.t277 ? (ifd.t277 as number[])[0] : 1) || 1;
  const n = width * height;
  const values = new Float32Array(n);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bps8 = bps / 8;
  const stride = bps8 * spp;
  for (let i = 0; i < n; i++) {
    const off = i * stride;
    if (off + bps8 > data.byteLength) break;
    if (fmt === 3 && bps === 32) values[i] = dv.getFloat32(off, littleEndian);
    else if (bps === 32) values[i] = dv.getUint32(off, littleEndian);
    else if (bps === 16) values[i] = dv.getUint16(off, littleEndian);
    else values[i] = data[off];
  }
  return { width, height, values, bounds: readBounds(ifd as Record<string, unknown>) };
}

/** Diagnóstico (inspeção de tags). */
export async function downloadTiffDebug(url: string, apiKey: string): Promise<Record<string, unknown>> {
  const u = new URL(url);
  u.searchParams.set("key", apiKey);
  const res = await fetch(u.toString());
  const buf = await res.arrayBuffer();
  const ifds = UTIF.decode(buf);
  const ifd = ifds[0] as Record<string, unknown>;
  UTIF.decodeImage(buf, ifd, ifds);
  return {
    width: ifd.width, height: ifd.height,
    epsg: detectEpsg(ifd), bounds: readBounds(ifd),
    t34264: ifd.t34264, t33922: ifd.t33922, t33550: ifd.t33550, t34735: ifd.t34735,
  };
}

// ─── Paleta heatmap ─────────────────────────────────────────────────────────

const IRON_PALETTE = ["00000a", "91009c", "e64616", "feb400", "fffff6"];

function buildPalette(hex: string[]): Array<[number, number, number]> {
  const stops = hex.map((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const lo = Math.floor(t), hi = Math.min(stops.length - 1, lo + 1), f = t - lo;
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

// ─── Composição ─────────────────────────────────────────────────────────────

export interface ComposeOptions {
  showFlux?: boolean;
  fluxOpacity?: number;
  fluxMin?: number;
  fluxMax?: number;
  panels?: PanelDraw[];
  panelBounds?: LatLngBounds;
}

/** Desenha um retângulo rotacionado (módulo) no buffer RGBA. */
function drawPanel(
  out: Uint8Array, w: number, h: number,
  cx: number, cy: number, halfW: number, halfH: number, rot: number,
) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const reach = Math.ceil(Math.hypot(halfW, halfH)) + 1;
  const fill: [number, number, number] = [14, 23, 42];   // navy escuro (módulo)
  const border: [number, number, number] = [125, 211, 252]; // ciano (borda)
  const bw = Math.max(1, Math.min(halfW, halfH) * 0.18);
  for (let py = Math.floor(cy - reach); py <= cy + reach; py++) {
    if (py < 0 || py >= h) continue;
    for (let px = Math.floor(cx - reach); px <= cx + reach; px++) {
      if (px < 0 || px >= w) continue;
      const dx = px - cx, dy = py - cy;
      // rotação inversa para o referencial do módulo
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) {
        const i = (py * w + px) * 4;
        const edge = Math.abs(lx) >= halfW - bw || Math.abs(ly) >= halfH - bw;
        const c = edge ? border : fill;
        // módulo sólido com leve transparência para integrar à foto
        const a = edge ? 1 : 0.92;
        out[i] = Math.round(out[i] * (1 - a) + c[0] * a);
        out[i + 1] = Math.round(out[i + 1] * (1 - a) + c[1] * a);
        out[i + 2] = Math.round(out[i + 2] * (1 - a) + c[2] * a);
        out[i + 3] = 255;
      }
    }
  }
}

export function composeHdRoofPng(
  rgb: DecodedTiff,
  flux: DecodedTiff | null,
  mask: DecodedTiff | null,
  opts: ComposeOptions = {},
): Uint8Array {
  const showFlux = opts.showFlux ?? true;
  const fluxOpacity = opts.fluxOpacity ?? 0.35;
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
        if (mask?.values) inRoof = sampleNearest(mask.values, mW, mH, (x / w) * mW, (y / h) * mH) > 0.5 ? 1 : 0;
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

  // Desenha os módulos nas coordenadas reais (alinhamento perfeito).
  if (opts.panels?.length && opts.panelBounds) {
    const bnd = opts.panelBounds;
    const lngSpan = bnd.east - bnd.west, latSpan = bnd.north - bnd.south;
    const midLat = (bnd.north + bnd.south) / 2;
    const mPerDegLng = 111320 * Math.cos((midLat * Math.PI) / 180);
    const mPerDegLat = 110540;
    const pxPerMx = (w / (lngSpan * mPerDegLng));
    const pxPerMy = (h / (latSpan * mPerDegLat));
    for (const p of opts.panels) {
      const cx = ((p.lng - bnd.west) / lngSpan) * w;
      const cy = ((bnd.north - p.lat) / latSpan) * h;
      if (cx < -50 || cx > w + 50 || cy < -50 || cy > h + 50) continue;
      const halfW = (p.widthM * pxPerMx) / 2;
      const halfH = (p.heightM * pxPerMy) / 2;
      const rot = (p.azimuthDegrees * Math.PI) / 180;
      drawPanel(out, w, h, cx, cy, Math.max(2, halfW), Math.max(2, halfH), rot);
    }
  }

  return new Uint8Array(UPNG.encode([out.buffer], w, h, 0));
}

export interface HdRoofResult {
  png: Uint8Array;
  width: number;
  height: number;
  bounds?: LatLngBounds;
}

/** Pipeline: baixa os 3 layers, desenha os painéis e devolve o PNG composto. */
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
  const png = composeHdRoofPng(rgb, flux, mask, { ...opts, panelBounds: opts.panelBounds ?? rgb.bounds });
  return { png, width: rgb.width, height: rgb.height, bounds: rgb.bounds };
}
