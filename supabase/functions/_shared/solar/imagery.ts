// =============================================================================
// Imagery helper — imagem de satélite REAL do telhado (Google Static Maps)
// =============================================================================
// Calcula o enquadramento (centro + zoom) que melhor mostra o telhado a partir
// dos pontos reais (painéis e segmentos) retornados pela Solar API, e monta a
// URL da imagem de satélite. A chave NUNCA vai para o frontend — a imagem é
// servida por proxy na edge function `solar-roof-image`.
// =============================================================================

export interface ImageryView {
  centerLat: number;
  centerLng: number;
  zoom: number;
  /** Tamanho lógico em px (antes do scale). */
  sizePx: number;
  /** Scale do Static Maps (2 = retina). */
  scale: number;
}

export interface LatLngPoint {
  lat: number | null;
  lng: number | null;
}

const TILE_SIZE = 256;

/** Projeção Web Mercator (mundo, sem zoom) de lat/lng para pixel base. */
function project(lat: number, lng: number): { x: number; y: number } {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  const x = TILE_SIZE * (0.5 + lng / 360);
  const y = TILE_SIZE * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI));
  return { x, y };
}

/**
 * Escolhe centro e zoom para enquadrar todos os pontos do telhado com folga.
 * Se não houver pontos válidos, usa o centro informado com zoom padrão de casa.
 */
export function computeImageryView(
  fallbackLat: number,
  fallbackLng: number,
  points: LatLngPoint[],
  sizePx = 640,
  scale = 2,
): ImageryView {
  const valid = points.filter(
    (p): p is { lat: number; lng: number } =>
      typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );

  if (valid.length === 0) {
    return { centerLat: fallbackLat, centerLng: fallbackLng, zoom: 20, sizePx, scale };
  }

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of valid) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  // Margem de 35% ao redor do telhado para contexto visual.
  const sw = project(minLat, minLng);
  const ne = project(maxLat, maxLng);
  const spanX = Math.abs(ne.x - sw.x) || 1e-6;
  const spanY = Math.abs(sw.y - ne.y) || 1e-6;
  const margin = 1.35;

  // zoom tal que span (em px base × 2^zoom) caiba no sizePx com margem.
  const zoomX = Math.log2(sizePx / (spanX * margin));
  const zoomY = Math.log2(sizePx / (spanY * margin));
  let zoom = Math.floor(Math.min(zoomX, zoomY));
  zoom = Math.max(17, Math.min(21, zoom)); // limites sensatos para telhado

  return { centerLat, centerLng, zoom, sizePx, scale };
}

/** Monta a URL do Static Maps (satélite) — uso server-side apenas. */
export function buildStaticMapUrl(view: ImageryView, apiKey: string): string {
  const u = new URL("https://maps.googleapis.com/maps/api/staticmap");
  u.searchParams.set("center", `${view.centerLat},${view.centerLng}`);
  u.searchParams.set("zoom", String(view.zoom));
  u.searchParams.set("size", `${view.sizePx}x${view.sizePx}`);
  u.searchParams.set("scale", String(view.scale));
  u.searchParams.set("maptype", "satellite");
  u.searchParams.set("format", "png");
  u.searchParams.set("key", apiKey);
  return u.toString();
}
