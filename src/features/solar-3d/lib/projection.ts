// Projeção Web Mercator (espelha supabase/functions/_shared/solar/imagery.ts).
// Converte lat/lng dos painéis reais em coordenadas de pixel relativas (0..1)
// dentro da imagem de satélite, para sobrepor os módulos no telhado real.
import type { SolarImageryView } from "./types";

const TILE_SIZE = 256;

function project(lat: number, lng: number): { x: number; y: number } {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  const x = TILE_SIZE * (0.5 + lng / 360);
  const y = TILE_SIZE * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI));
  return { x, y };
}

/**
 * Retorna a posição relativa (0..1) de um ponto lat/lng dentro da imagem
 * gerada com `view`. Fora de [0,1] significa fora do enquadramento.
 */
export function latLngToRelative(
  lat: number,
  lng: number,
  view: SolarImageryView,
): { x: number; y: number } {
  const scale = Math.pow(2, view.zoom);
  const world = project(lat, lng);
  const center = project(view.centerLat, view.centerLng);
  // pixels do ponto relativos ao centro, na escala do zoom.
  const dx = (world.x - center.x) * scale;
  const dy = (world.y - center.y) * scale;
  // imagem tem sizePx (lógico) centrada no centro.
  const half = view.sizePx / 2;
  return {
    x: (half + dx) / view.sizePx,
    y: (half + dy) / view.sizePx,
  };
}

/** URL da imagem real do telhado, servida pela edge (sem expor a chave). */
export function buildRoofImageUrl(
  supabaseUrl: string,
  consultantId: string,
  view: SolarImageryView,
): string {
  const u = new URL(`${supabaseUrl}/functions/v1/solar-roof-image`);
  u.searchParams.set("consultantId", consultantId);
  u.searchParams.set("lat", String(view.centerLat));
  u.searchParams.set("lng", String(view.centerLng));
  u.searchParams.set("zoom", String(view.zoom));
  u.searchParams.set("size", String(view.sizePx));
  return u.toString();
}
