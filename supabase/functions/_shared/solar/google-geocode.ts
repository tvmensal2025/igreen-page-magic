export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export async function geocodeAddress(addressText: string, apiKey: string): Promise<GeocodeResult> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", addressText);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("region", "br");

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.[0]) {
    throw { error: { code: 404, message: `Geocode: ${data.status}`, status: data.status } };
  }
  const r = data.results[0];
  return {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    formattedAddress: r.formatted_address,
  };
}

export function formatCustomerAddress(parts: {
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  cep?: string | null;
}): string {
  const line1 = [parts.address_street, parts.address_number].filter(Boolean).join(", ");
  const line2 = [parts.address_neighborhood, parts.address_city, parts.address_state].filter(Boolean).join(", ");
  const cep = parts.cep ? `CEP ${parts.cep}` : "";
  return [line1, line2, cep, "Brasil"].filter(Boolean).join(", ");
}

export function cacheKeyFromLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}
