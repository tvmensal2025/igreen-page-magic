/**
 * Cidade / endereço → DDDs de remarketing.
 * Quando a campanha é marcada como remarketing, o wizard usa isso para
 * preencher `retarget_ddd_allowlist` (só sobe telefone desses DDDs na Meta).
 */

/** Todos os DDDs de Minas Gerais (ANATEL) — remarketing “MG inteira”. */
export const MG_RETARGET_DDD_ALLOWLIST = [31, 32, 33, 34, 35, 37, 38] as const;

/** Mercado Rafael: Uberlândia/Uberaba (34), BH (31), Brasilândia (38) — sem DDD vizinho. */
export const RAFAEL_MARKET_DDD_ALLOWLIST = [31, 34, 38] as const;

/** DDD principal por nome de cidade (normalizado). */
const CITY_PRIMARY_DDD: Record<string, number> = {
  // Triângulo Mineiro / Alto Paranaíba
  uberlandia: 34,
  "uberlândia": 34,
  uberaba: 34,
  araguari: 34,
  ituiutaba: 34,
  patosdeminas: 34,
  "patos de minas": 34,
  // Centro / BH
  belohorizonte: 31,
  "belo horizonte": 31,
  contagem: 31,
  betim: 31,
  novalima: 31,
  "nova lima": 31,
  // Zona da Mata / Sul
  juizdefora: 32,
  "juiz de fora": 32,
  varginha: 35,
  povar: 35,
  poçosdecaldas: 35,
  "pocos de caldas": 35,
  "poços de caldas": 35,
  // Norte / Vale
  montesclaros: 38,
  "montes claros": 38,
  governadorvaladares: 33,
  "governador valadares": 33,
  ipatinga: 31,
  // Interior SP (caso apareça)
  "brasilandia de minas": 38,
  brasilandia: 38,
  "sao paulo": 11,
  "são paulo": 11,
  ribeiraopreto: 16,
  "ribeirão preto": 16,
  "ribeirao preto": 16,
};

/** Meta city keys conhecidos no produto → DDD. */
const META_KEY_DDD: Record<string, number> = {
  "273173": 34, // Uberlândia
  "273168": 34, // Uberaba
  "244661": 31, // Belo Horizonte
};

/**
 * Cluster “cidades próximas”: a partir do DDD principal, inclui DDDs vizinhos
 * da mesma macrorregião (MG foco). Assim Uberlândia sobe 34 e vizinhos do
 * Triângulo/centro próximo sem abrir DDD 19 (SP).
 */
const NEARBY_DDDS: Record<number, number[]> = {
  34: [34, 35], // Triângulo + Sul de Minas próximo
  35: [35, 34],
  31: [31, 32, 37], // BH + Zona da Mata / Centro-Oeste MG
  32: [32, 31, 33],
  33: [33, 32],
  37: [37, 31, 38],
  38: [38, 37],
  // SP: se alguém marcar remarketing em SP, não misturar MG
  11: [11],
  19: [19],
  16: [16],
};

export function normalizeCityLabel(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // remove "(80km)"
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai cidade provável de um endereço completo. */
export function cityFromAddress(address: string): string | null {
  const parts = String(address || "").split(",").map((p) => p.trim()).filter(Boolean);
  // Padrão Google: "Rua…, Bairro, Cidade - MG, Brasil"
  for (const p of parts) {
    const norm = normalizeCityLabel(p.replace(/\s*-\s*[A-Z]{2}\b/i, ""));
    if (CITY_PRIMARY_DDD[norm] || CITY_PRIMARY_DDD[norm.replace(/\s/g, "")]) return p;
  }
  return parts.length >= 3 ? parts[parts.length - 3] : parts[0] || null;
}

export function primaryDddForCity(input: {
  key?: string | null;
  name?: string | null;
}): number | null {
  const key = String(input.key || "").trim();
  if (key && META_KEY_DDD[key]) return META_KEY_DDD[key];
  // radius:-18.9,-48.3:80 → tenta pelo name
  const name = normalizeCityLabel(input.name || "");
  if (!name) return null;
  if (CITY_PRIMARY_DDD[name]) return CITY_PRIMARY_DDD[name];
  const compact = name.replace(/\s/g, "");
  if (CITY_PRIMARY_DDD[compact]) return CITY_PRIMARY_DDD[compact];
  // match parcial: "uberlandia mg" / "jaragua setor oeste uberlandia"
  for (const [city, ddd] of Object.entries(CITY_PRIMARY_DDD)) {
    if (city.length < 4) continue;
    if (name.includes(city) || compact.includes(city.replace(/\s/g, ""))) return ddd;
  }
  return null;
}

export function expandNearbyDdds(primary: number[]): number[] {
  const out = new Set<number>();
  for (const d of primary) {
    const cluster = NEARBY_DDDS[d] || [d];
    for (const x of cluster) out.add(x);
  }
  return [...out].sort((a, b) => a - b);
}

export type GeoForDdd = {
  cities?: Array<{ key?: string; name?: string }> | null;
  addresses?: string[] | null;
};

/**
 * DDDs inferidos das cidades/endereços da campanha, com expansão de vizinhos.
 */
export function dddsFromCampaignGeo(geo: GeoForDdd): number[] {
  const primaries: number[] = [];
  for (const c of geo.cities || []) {
    const d = primaryDddForCity(c);
    if (d) primaries.push(d);
  }
  for (const addr of geo.addresses || []) {
    const city = cityFromAddress(addr);
    const d = primaryDddForCity({ name: city || addr });
    if (d) primaries.push(d);
  }
  if (!primaries.length) return [];
  return expandNearbyDdds(primaries);
}

/** DDDs do mercado do consultor (cidades das campanhas) — sem abrir MG inteira. */
export function dddsForConsultantCities(
  cities: Array<{ key?: string | null; name?: string | null }>,
): number[] {
  return dddsFromCampaignGeo({
    cities: cities.map((c) => ({ key: c.key ?? undefined, name: c.name ?? undefined })),
  });
}
