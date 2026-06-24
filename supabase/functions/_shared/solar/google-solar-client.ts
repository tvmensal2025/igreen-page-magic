import type { BuildingInsightsResponse, DataLayersResponse } from "./types.ts";

export async function findClosestBuilding(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<BuildingInsightsResponse> {
  const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("requiredQuality", "BASE");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const body = await res.json();
  if (!res.ok) throw body;
  return body as BuildingInsightsResponse;
}

export async function getDataLayerUrls(
  lat: number,
  lng: number,
  radiusMeters: number,
  apiKey: string,
): Promise<DataLayersResponse> {
  const url = new URL("https://solar.googleapis.com/v1/dataLayers:get");
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("radiusMeters", String(Math.max(20, Math.min(radiusMeters, 100))));
  url.searchParams.set("view", "FULL_LAYERS");
  url.searchParams.set("requiredQuality", "BASE");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const body = await res.json();
  if (!res.ok) throw body;
  return body as DataLayersResponse;
}

export function getGoogleApiKey(): string | null {
  return Deno.env.get("GOOGLE_SOLAR_API_KEY") ?? Deno.env.get("GOOGLE_MAPS_API_KEY") ?? null;
}

export function useMockMode(): boolean {
  return Deno.env.get("SOLAR_USE_MOCK") === "true" || !getGoogleApiKey();
}
