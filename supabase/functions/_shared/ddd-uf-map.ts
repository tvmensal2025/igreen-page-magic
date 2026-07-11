// DDD (código de área BR) → UF. Tabela oficial Anatel.
// Uso: identificar de que estado é um lead pra cruzar com a segmentação
// (facebook_campaigns.cities) e escolher a campanha mais provável.

export const DDD_TO_UF: Record<string, string> = {
  // SP
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP",
  "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  // RJ / ES
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  // MG
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG",
  "37": "MG", "38": "MG",
  // PR / SC / RS
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  // Centro-Oeste
  "61": "DF", "62": "GO", "64": "GO",
  "63": "TO",
  "65": "MT", "66": "MT",
  "67": "MS",
  // Nordeste
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
  "79": "SE",
  "81": "PE", "87": "PE",
  "82": "AL",
  "83": "PB",
  "84": "RN",
  "85": "CE", "88": "CE",
  "86": "PI", "89": "PI",
  "98": "MA", "99": "MA",
  // Norte
  "68": "AC",
  "69": "RO",
  "91": "PA", "93": "PA", "94": "PA",
  "92": "AM", "97": "AM",
  "95": "RR",
  "96": "AP",
};

// Cidades → UF (só as capitais + grandes cidades das segmentações mais
// usadas). Suficiente pra bater com facebook_campaigns.cities[].name.
// Nomes normalizados (sem acento, minúsculo).
const CITY_TO_UF: Record<string, string> = {
  // MG
  "belo horizonte": "MG", "uberlandia": "MG", "uberaba": "MG", "juiz de fora": "MG",
  "contagem": "MG", "betim": "MG", "montes claros": "MG", "ipatinga": "MG",
  "governador valadares": "MG", "divinopolis": "MG", "sete lagoas": "MG",
  "pocos de caldas": "MG", "patos de minas": "MG", "teofilo otoni": "MG",
  "brasilandia de minas": "MG", "jaragua": "MG", "minas gerais": "MG",
  // SP
  "sao paulo": "SP", "campinas": "SP", "santos": "SP", "sorocaba": "SP",
  "ribeirao preto": "SP", "sao jose dos campos": "SP", "guarulhos": "SP",
  "osasco": "SP", "sao bernardo do campo": "SP", "santo andre": "SP",
  "bauru": "SP", "piracicaba": "SP", "sao jose do rio preto": "SP",
  // RJ
  "rio de janeiro": "RJ", "niteroi": "RJ", "duque de caxias": "RJ",
  "nova iguacu": "RJ", "sao goncalo": "RJ", "petropolis": "RJ",
  // PR/SC/RS
  "curitiba": "PR", "londrina": "PR", "maringa": "PR", "cascavel": "PR",
  "florianopolis": "SC", "joinville": "SC", "blumenau": "SC", "chapeco": "SC",
  "porto alegre": "RS", "caxias do sul": "RS", "pelotas": "RS", "santa maria": "RS",
  // GO/DF/MT/MS
  "goiania": "GO", "aparecida de goiania": "GO", "anapolis": "GO",
  "brasilia": "DF",
  "cuiaba": "MT", "varzea grande": "MT", "rondonopolis": "MT",
  "campo grande": "MS", "dourados": "MS",
  // Nordeste
  "salvador": "BA", "feira de santana": "BA", "vitoria da conquista": "BA",
  "recife": "PE", "jaboatao dos guararapes": "PE", "olinda": "PE", "caruaru": "PE",
  "fortaleza": "CE", "caucaia": "CE", "juazeiro do norte": "CE",
  "natal": "RN", "mossoro": "RN",
  "joao pessoa": "PB", "campina grande": "PB",
  "maceio": "AL",
  "aracaju": "SE",
  "sao luis": "MA", "imperatriz": "MA",
  "teresina": "PI",
  // ES
  "vitoria": "ES", "vila velha": "ES", "serra": "ES", "cariacica": "ES",
  // Norte
  "manaus": "AM", "belem": "PA", "porto velho": "RO", "rio branco": "AC",
  "boa vista": "RR", "macapa": "AP", "palmas": "TO",
};

function normalizeText(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** DDD do telefone BR (2 dígitos após código país 55, se houver). */
export function extractDDD(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 10) return null;
  // remove 55 prefix se presente e sobra >= 10
  const bare = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  const ddd = bare.slice(0, 2);
  return DDD_TO_UF[ddd] ? ddd : null;
}

/** UF do lead a partir do telefone. */
export function ufFromPhone(phone: string | null | undefined): string | null {
  const ddd = extractDDD(phone);
  return ddd ? DDD_TO_UF[ddd] : null;
}

/**
 * A partir do JSON `facebook_campaigns.cities` (array de {name, key}),
 * retorna o conjunto de UFs que a campanha mira. Se algum nome não bater
 * na tabela CITY_TO_UF, ignora silenciosamente (não bloqueia).
 */
export function ufsFromCampaignCities(cities: any): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(cities)) return out;
  for (const c of cities) {
    const name = normalizeText(c?.name || "");
    if (!name) continue;
    // "Belo Horizonte (80km)" → "belo horizonte"
    const clean = name.replace(/\s*\(\d+km\)\s*$/i, "").trim();
    const uf = CITY_TO_UF[clean];
    if (uf) out.add(uf);
    // "Belo Horizonte, MG" → tenta sufixo UF direto
    const m = clean.match(/,\s*([a-z]{2})$/i);
    if (m) out.add(m[1].toUpperCase());
  }
  return out;
}
