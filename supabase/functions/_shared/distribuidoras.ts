// Allow-list alinhada à API iGreen (/bonus/distributors) — auditada 2026-07-13.
// Espelho de src/lib/captacao/distribuidoras.ts — mantenha os dois iguais.

/** Nomes oficiais aceitos por UF (fonte: api-green-connection /bonus/distributors). */
export const DISTRIBUIDORAS_POR_UF: Record<string, string[]> = {
  SP: ["CPFL", "CPFL SANTA CRUZ", "ELEKTRO", "ENERGISA SUL SUDESTE"],
  MG: ["CEMIG-D", "CPFL SANTA CRUZ", "ENERGISA MINAS RIO", "ENERGISA SUL SUDESTE"],
  PR: ["CELESC", "COPEL", "CPFL SANTA CRUZ", "ENERGISA SUL SUDESTE"],
  RJ: ["ENEL", "ENERGISA MINAS RIO"],
  RS: ["CEEE", "RGE"],
  SC: ["CELESC", "COPEL"],
  BA: ["COELBA"],
  GO: ["EQUATORIAL"],
  MS: ["ELEKTRO", "ENERGISA"],
  MT: ["ENERGISA"],
  ES: ["EDP"],
  CE: ["ENEL"],
  PE: ["NEO ENERGIA"],
  PB: ["ENERGISA PB"],
  AL: ["EQUATORIAL"],
  SE: ["ENERGISA"],
  PI: ["EQUATORIAL"],
  MA: ["EQUATORIAL"],
  RN: ["COSERN"],
  TO: ["ENERGISA TOCANTINS"],
  PA: ["EQUATORIAL PA"],
  // Sem cobertura iGreen (lista vazia = validador bloqueia):
  DF: [],
  AM: [],
  AP: [],
  AC: [],
  RO: [],
  RR: [],
};

/**
 * Holdings ambíguas (NÃO são nomes oficiais da API).
 * NÃO incluir CPFL / ENEL / EDP / ENERGISA / EQUATORIAL — esses são oficiais.
 */
const HOLDING_NAMES = [
  "CPFL ENERGIA",
  "ENEL BRASIL",
  "EDP BRASIL",
  "EQUATORIAL ENERGIA",
  "NEOENERGIA",
];

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Cidade → concessionária oficial (SP).
 * Ex-Piratininga e ex-Paulista agora resolvem para CPFL (API unificou).
 * Campinas/interior Elektro seguem ELEKTRO (mapa do worker-portal-2).
 */
const SP_CITY_MAP: Record<string, string> = {
  // Ex-CPFL PIRATININGA → CPFL
  SALTO: "CPFL",
  SOROCABA: "CPFL",
  JUNDIAI: "CPFL",
  ITU: "CPFL",
  INDAIATUBA: "CPFL",
  SANTOS: "CPFL",
  "SAO VICENTE": "CPFL",
  CUBATAO: "CPFL",
  GUARUJA: "CPFL",
  "PRAIA GRANDE": "CPFL",
  ITAPETININGA: "CPFL",
  "VARZEA PAULISTA": "CPFL",
  "CAMPO LIMPO PAULISTA": "CPFL",
  ITUPEVA: "CPFL",
  CABREUVA: "CPFL",
  "PORTO FELIZ": "CPFL",
  TIETE: "CPFL",
  BOITUVA: "CPFL",
  VOTORANTIM: "CPFL",
  "ARACOIABA DA SERRA": "CPFL",
  // Ex-CPFL PAULISTA → CPFL
  "RIBEIRAO PRETO": "CPFL",
  FRANCA: "CPFL",
  BATATAIS: "CPFL",
  SERTAOZINHO: "CPFL",
  CRAVINHOS: "CPFL",
  BRODOWSKI: "CPFL",
  BEBEDOURO: "CPFL",
  ARARAS: "CPFL",
  "MOGI MIRIM": "CPFL",
  "MOGI GUACU": "CPFL",
  LEME: "CPFL",
  PIRASSUNUNGA: "CPFL",
  "SAO JOAO DA BOA VISTA": "CPFL",
  // ELEKTRO (interior)
  CAMPINAS: "ELEKTRO",
  LIMEIRA: "ELEKTRO",
  PIRACICABA: "ELEKTRO",
  AMERICANA: "ELEKTRO",
  SUMARE: "ELEKTRO",
  HORTOLANDIA: "ELEKTRO",
  PAULINIA: "ELEKTRO",
  BAURU: "ELEKTRO",
  "SAO JOSE DO RIO PRETO": "ELEKTRO",
  ARARAQUARA: "ELEKTRO",
  "SAO CARLOS": "ELEKTRO",
  "RIO CLARO": "ELEKTRO",
  MARILIA: "ELEKTRO",
  "PRESIDENTE PRUDENTE": "ELEKTRO",
  BARRETOS: "ELEKTRO",
  // CPFL SANTA CRUZ
  "SANTA CRUZ DO RIO PARDO": "CPFL SANTA CRUZ",
  OURINHOS: "CPFL SANTA CRUZ",
};

/** Aliases comerciais/OCR → token oficial (qualquer UF). */
const ALIAS_TO_OFFICIAL: Array<{ match: RegExp; token: string }> = [
  { match: /^CPFL.*PIRA?\s*TININGA/, token: "CPFL" },
  { match: /^CPFL.*PAULISTA/, token: "CPFL" },
  { match: /^CPFL.*SANTA\s*CRUZ|^CPFL.*STA\s*CRUZ/, token: "CPFL SANTA CRUZ" },
  { match: /^PIRA?\s*TININGA$/, token: "CPFL" },
  { match: /^PAULISTA$/, token: "CPFL" },
  { match: /^CPFL$/, token: "CPFL" },
  { match: /^CEMIG/, token: "CEMIG-D" },
  { match: /^COPEL/, token: "COPEL" },
  { match: /^ELEKTRO/, token: "ELEKTRO" },
  { match: /^ENERGISA\s*MINAS\s*RIO/, token: "ENERGISA MINAS RIO" },
  { match: /^ENERGISA\s*SUL\s*SUDESTE|^ENERGISA\s*SUL-SUDESTE/, token: "ENERGISA SUL SUDESTE" },
  { match: /^ENERGISA\s*(PARAIBA|PB)/, token: "ENERGISA PB" },
  { match: /^ENERGISA\s*TOCANTINS/, token: "ENERGISA TOCANTINS" },
  { match: /^ENERGISA/, token: "ENERGISA" },
  { match: /^ENEL|^AMPLA|^COELCE|^ELETROPAULO/, token: "ENEL" },
  { match: /^EDP|^BANDEIRANTE|^ESCELSA/, token: "EDP" },
  { match: /^EQUATORIAL\s*PA|^CELPA/, token: "EQUATORIAL PA" },
  { match: /^EQUATORIAL|^CELG|^CEMAR|^CEPISA|^CEAL/, token: "EQUATORIAL" },
  { match: /^COELBA/, token: "COELBA" },
  { match: /^COSERN/, token: "COSERN" },
  { match: /^NEO\s*ENERGIA|^CELPE/, token: "NEO ENERGIA" },
  { match: /^CELESC/, token: "CELESC" },
  { match: /^CEEE/, token: "CEEE" },
  { match: /^RGE/, token: "RGE" },
  { match: /^LIGHT/, token: "LIGHT" },
];

/**
 * Normaliza nome de distribuidora (OCR/lead) → nome oficial da API.
 * Holdings ambíguas são resolvidas por cidade/UF quando possível.
 */
export function normalizeDistribuidora(
  raw?: string | null,
  uf?: string | null,
  cidade?: string | null,
): string {
  if (!raw || !raw.trim()) return "";
  const n = norm(raw);
  const u = (uf || "").toUpperCase().trim();
  const c = cidade ? norm(cidade) : "";
  const list = DISTRIBUIDORAS_POR_UF[u] || [];

  // Já bate com a allow-list oficial
  const exact = list.find((d) => norm(d) === n);
  if (exact) return exact;

  // SP: cidade desambigua CPFL/ELEKTRO/SANTA CRUZ
  if (u === "SP" && c && SP_CITY_MAP[c]) {
    const byCity = SP_CITY_MAP[c];
    if (!n || n === "CPFL ENERGIA" || n === "CPFL" || n.startsWith("CPFL") || n === "PAULISTA" || n.includes("PIRATININGA")) {
      return byCity;
    }
    // Nome divergente da cidade: ainda tenta alias abaixo
  }

  // Aliases → token; depois casa com lista da UF
  for (const { match, token } of ALIAS_TO_OFFICIAL) {
    if (!match.test(n)) continue;
    const hit =
      list.find((d) => norm(d) === norm(token)) ||
      list.find((d) => norm(d).startsWith(norm(token)));
    if (hit) return hit;
    // Token oficial sem estar na UF (ex.: LIGHT em RJ) — devolve token p/ caller tratar
    if (list.length === 0) return "";
  }

  // Holding genérica + UF com 1 candidata do grupo
  if (u === "SP" && (n === "CPFL ENERGIA" || n === "CPFL")) {
    if (c && SP_CITY_MAP[c]) return SP_CITY_MAP[c];
    return "";
  }

  return raw.trim();
}

export function suggestDistribuidoras(uf?: string | null): string[] {
  const u = (uf || "").toUpperCase().trim();
  return DISTRIBUIDORAS_POR_UF[u] || [];
}

export function isValidDistribuidora(
  name?: string | null,
  uf?: string | null,
  cidade?: string | null,
): boolean {
  if (!name || !name.trim()) return false;
  const u = (uf || "").toUpperCase().trim();
  const list = suggestDistribuidoras(uf);

  // UF sem cobertura iGreen
  if (u && Object.prototype.hasOwnProperty.call(DISTRIBUIDORAS_POR_UF, u) && list.length === 0) {
    return false;
  }

  const n = norm(name);
  if (list.some((d) => norm(d) === n)) return true;

  // Holding ambígua sem resolução
  if (HOLDING_NAMES.includes(n)) {
    const resolved = normalizeDistribuidora(name, uf, cidade);
    return !!resolved && list.some((d) => norm(d) === norm(resolved));
  }

  const resolved = normalizeDistribuidora(name, uf, cidade);
  if (resolved && list.some((d) => norm(d) === norm(resolved))) return true;

  // Sem lista de UF (desconhecida): não bloqueia
  if (list.length === 0 && !u) return true;
  if (list.length === 0) return false;
  return false;
}

export function isHoldingName(name?: string | null): boolean {
  if (!name) return false;
  return HOLDING_NAMES.includes(norm(name));
}
