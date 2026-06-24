#!/usr/bin/env node
/**
 * Spike Fase 0 — testa Geocoding + Solar API em endereços BR.
 * Uso: GOOGLE_SOLAR_API_KEY=... node experiments/solar-3d-ai/spike/run-spike.mjs
 */

const ADDRESSES = [
  "Av. Paulista, 1000, São Paulo, SP, Brasil",
  "Rua da Bahia, 500, Belo Horizonte, MG, Brasil",
  "Av. Rio Branco, 100, Rio de Janeiro, RJ, Brasil",
];

const key = process.env.GOOGLE_SOLAR_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

async function geocode(address) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);
  url.searchParams.set("region", "br");
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK") throw new Error(`Geocode ${data.status}`);
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng, formatted: data.results[0].formatted_address };
}

async function findClosest(lat, lng) {
  const url = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("requiredQuality", "BASE");
  url.searchParams.set("key", key);
  const t0 = Date.now();
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  const sp = body.solarPotential || {};
  return {
    ms: Date.now() - t0,
    quality: body.imageryQuality,
    maxPanels: sp.maxArrayPanelsCount,
    panelWatts: sp.panelCapacityWatts,
  };
}

async function main() {
  if (!key) {
    console.error("Defina GOOGLE_SOLAR_API_KEY");
    process.exit(1);
  }
  for (const addr of ADDRESSES) {
    try {
      const g = await geocode(addr);
      const s = await findClosest(g.lat, g.lng);
      console.log(JSON.stringify({ address: addr, ...g, ...s }, null, 2));
    } catch (e) {
      console.error(addr, e?.message || e);
    }
  }
}

main();
