/**
 * Cidade → DDD (Deno / edge). Espelha src/lib/cityToDdd.ts.
 */

const CITY_PRIMARY_DDD: Record<string, number> = {
  uberlandia: 34,
  uberaba: 34,
  araguari: 34,
  ituiutaba: 34,
  "patos de minas": 34,
  "belo horizonte": 31,
  contagem: 31,
  betim: 31,
  "juiz de fora": 32,
  varginha: 35,
  "pocos de caldas": 35,
  "montes claros": 38,
  "governador valadares": 33,
  ipatinga: 31,
  campinas: 19,
  "sao paulo": 11,
  "ribeirao preto": 16,
};

const META_KEY_DDD: Record<string, number> = {
  "273173": 34,
  "273168": 34,
  "244661": 31,
};

const NEARBY_DDDS: Record<number, number[]> = {
  34: [34, 35],
  35: [35, 34],
  31: [31, 32, 37],
  32: [32, 31, 33],
  33: [33, 32],
  37: [37, 31, 38],
  38: [38, 37],
  11: [11],
  19: [19],
  16: [16],
};

function normalizeCityLabel(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryDddForCity(input: { key?: string; name?: string }): number | null {
  const key = String(input.key || "").trim();
  if (key && META_KEY_DDD[key]) return META_KEY_DDD[key];
  const name = normalizeCityLabel(input.name || "");
  if (!name) return null;
  if (CITY_PRIMARY_DDD[name]) return CITY_PRIMARY_DDD[name];
  const compact = name.replace(/\s/g, "");
  for (const [city, ddd] of Object.entries(CITY_PRIMARY_DDD)) {
    const c = city.replace(/\s/g, "");
    if (c.length < 4) continue;
    if (name.includes(city) || compact.includes(c)) return ddd;
  }
  return null;
}

function expandNearbyDdds(primary: number[]): number[] {
  const out = new Set<number>();
  for (const d of primary) {
    for (const x of NEARBY_DDDS[d] || [d]) out.add(x);
  }
  return [...out].sort((a, b) => a - b);
}

export function resolveRetargetDdds(opts: {
  clientDdds?: number[] | null;
  cities?: Array<{ key?: string; name?: string }> | null;
  customLocations?: Array<{ address_string?: string; name?: string }> | null;
}): number[] {
  const fromClient = (opts.clientDdds || [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 11 && n <= 99);
  if (fromClient.length) return expandNearbyDdds(fromClient);

  const primaries: number[] = [];
  for (const c of opts.cities || []) {
    const d = primaryDddForCity(c);
    if (d) primaries.push(d);
  }
  for (const loc of opts.customLocations || []) {
    const d = primaryDddForCity({ name: loc.name || loc.address_string || "" });
    if (d) primaries.push(d);
  }
  return expandNearbyDdds(primaries);
}

/** Merge DDDs na allowlist da plataforma (service role). */
export async function mergePlatformRetargetDdds(
  // deno-lint-ignore no-explicit-any
  admin: any,
  ddds: number[],
): Promise<number[]> {
  if (!ddds.length) return [];
  const { data } = await admin
    .from("platform_facebook_account")
    .select("retarget_ddd_allowlist")
    .eq("id", true)
    .maybeSingle();
  const prev = Array.isArray(data?.retarget_ddd_allowlist)
    ? data.retarget_ddd_allowlist.map(Number).filter((n: number) => n >= 11 && n <= 99)
    : [];
  const merged = [...new Set([...prev, ...ddds])].sort((a, b) => a - b);
  await admin
    .from("platform_facebook_account")
    .update({ retarget_ddd_allowlist: merged })
    .eq("id", true);
  return merged;
}
