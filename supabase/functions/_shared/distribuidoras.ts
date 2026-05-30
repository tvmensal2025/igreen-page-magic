// Espelho Deno de src/lib/captacao/distribuidoras.ts.
// Se mudar lá, atualize aqui também.

export const DISTRIBUIDORAS_POR_UF: Record<string, string[]> = {
  SP: ["CPFL PIRATININGA","CPFL PAULISTA","CPFL SANTA CRUZ","CPFL LESTE PAULISTA","CPFL JAGUARI","CPFL MOCOCA","CPFL SUL PAULISTA","RGE","ENEL SP","ENEL DISTRIBUIÇÃO SÃO PAULO","EDP SÃO PAULO","EDP SP","ELEKTRO","ENERGISA SUL-SUDESTE"],
  RJ: ["ENEL RJ","ENEL DISTRIBUIÇÃO RIO","LIGHT","ENERGISA NOVA FRIBURGO"],
  MG: ["CEMIG","CEMIG D","ENERGISA MINAS GERAIS","DMED","DEMEI"],
  RS: ["RGE","CEEE EQUATORIAL","CEEE-D"],
  PR: ["COPEL","COPEL DISTRIBUIÇÃO","COCEL","FORCEL"],
  SC: ["CELESC","CELESC D"],
  ES: ["EDP ES","EDP ESPÍRITO SANTO"],
  BA: ["NEOENERGIA COELBA","COELBA"],
  PE: ["NEOENERGIA PERNAMBUCO","CELPE"],
  RN: ["NEOENERGIA COSERN","COSERN"],
  CE: ["ENEL CE","ENEL DISTRIBUIÇÃO CEARÁ","COELCE"],
  GO: ["EQUATORIAL GO","EQUATORIAL GOIÁS","ENEL GO","CELG-D"],
  DF: ["NEOENERGIA BRASÍLIA","CEB DISTRIBUIÇÃO","CEB-D"],
  MT: ["ENERGISA MATO GROSSO","ENERGISA MT"],
  MS: ["ENERGISA MATO GROSSO DO SUL","ENERGISA MS"],
  PA: ["EQUATORIAL PARÁ","EQUATORIAL PA","CELPA"],
  MA: ["EQUATORIAL MARANHÃO","EQUATORIAL MA","CEMAR"],
  PI: ["EQUATORIAL PIAUÍ","EQUATORIAL PI","CEPISA"],
  AL: ["EQUATORIAL ALAGOAS","EQUATORIAL AL","CEAL"],
  PB: ["ENERGISA PARAÍBA","ENERGISA PB","EPB","ENERGISA BORBOREMA"],
  SE: ["ENERGISA SERGIPE","ENERGISA SE","ESE"],
  RO: ["ENERGISA RONDÔNIA","ENERGISA RO","CERON"],
  AC: ["ENERGISA ACRE","ENERGISA AC","ELETROACRE"],
  TO: ["ENERGISA TOCANTINS","ENERGISA TO","CELTINS"],
  AM: ["AMAZONAS ENERGIA"],
  RR: ["RORAIMA ENERGIA"],
  AP: ["CEA EQUATORIAL","EQUATORIAL AMAPÁ"],
};

const HOLDING_NAMES = ["CPFL ENERGIA","CPFL","ENEL BRASIL","ENEL","EDP BRASIL","EDP","ENERGISA","EQUATORIAL ENERGIA","EQUATORIAL","NEOENERGIA"];

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim().toUpperCase();

// Cidade → concessionária CPFL (SP). Cobre as principais cidades da área de concessão.
const CPFL_CITY_MAP: Record<string, string> = {
  // CPFL PIRATININGA (Sorocaba/Jundiaí/Baixada Santista)
  "SALTO":"CPFL PIRATININGA","SOROCABA":"CPFL PIRATININGA","JUNDIAI":"CPFL PIRATININGA",
  "ITU":"CPFL PIRATININGA","INDAIATUBA":"CPFL PIRATININGA","SANTOS":"CPFL PIRATININGA",
  "SAO VICENTE":"CPFL PIRATININGA","CUBATAO":"CPFL PIRATININGA","GUARUJA":"CPFL PIRATININGA",
  "PRAIA GRANDE":"CPFL PIRATININGA","ITAPETININGA":"CPFL PIRATININGA","VARZEA PAULISTA":"CPFL PIRATININGA",
  "CAMPO LIMPO PAULISTA":"CPFL PIRATININGA","ITUPEVA":"CPFL PIRATININGA","CABREUVA":"CPFL PIRATININGA",
  "PORTO FELIZ":"CPFL PIRATININGA","TIETE":"CPFL PIRATININGA","BOITUVA":"CPFL PIRATININGA",
  "VOTORANTIM":"CPFL PIRATININGA","ARACOIABA DA SERRA":"CPFL PIRATININGA",
  // CPFL PAULISTA (Campinas/Ribeirão/Bauru)
  "CAMPINAS":"CPFL PAULISTA","RIBEIRAO PRETO":"CPFL PAULISTA","BAURU":"CPFL PAULISTA",
  "SAO JOSE DO RIO PRETO":"CPFL PAULISTA","ARARAQUARA":"CPFL PAULISTA","FRANCA":"CPFL PAULISTA",
  "PIRACICABA":"CPFL PAULISTA","LIMEIRA":"CPFL PAULISTA","AMERICANA":"CPFL PAULISTA",
  "SUMARE":"CPFL PAULISTA","HORTOLANDIA":"CPFL PAULISTA","VALINHOS":"CPFL PAULISTA",
  "PAULINIA":"CPFL PAULISTA","SAO CARLOS":"CPFL PAULISTA","BARRETOS":"CPFL PAULISTA",
  "MARILIA":"CPFL PAULISTA","RIO CLARO":"CPFL PAULISTA","BIRIGUI":"CPFL PAULISTA",
  // CPFL SANTA CRUZ
  "SANTA CRUZ DO RIO PARDO":"CPFL SANTA CRUZ","OURINHOS":"CPFL SANTA CRUZ",
};

/**
 * Normaliza nome de distribuidora retornado pelo OCR.
 * - Holdings ambíguas (CPFL ENERGIA, ENEL, EDP...) são resolvidas por cidade/UF.
 * - Se já vier nome válido, devolve no case canônico da allow-list.
 * - Se não conseguir resolver, retorna "" (validador bloqueia e exige correção).
 */
export function normalizeDistribuidora(raw?: string | null, uf?: string | null, cidade?: string | null): string {
  if (!raw || !raw.trim()) return "";
  const n = norm(raw);
  const u = (uf || "").toUpperCase().trim();
  const c = cidade ? norm(cidade) : "";

  // Já bate com a allow-list → devolve no case canônico
  const list = DISTRIBUIDORAS_POR_UF[u] || [];
  const exact = list.find((d) => norm(d) === n);
  if (exact) return exact;

  // Holding CPFL → desambigua por cidade (SP)
  if (u === "SP" && (n === "CPFL ENERGIA" || n === "CPFL" || n.startsWith("CPFL "))) {
    if (c && CPFL_CITY_MAP[c]) return CPFL_CITY_MAP[c];
    return ""; // sem cidade conhecida → exige correção manual
  }

  // ENEL/EDP/EQUATORIAL/NEOENERGIA/ENERGISA: se a UF só tem 1 subsidiária do grupo, usa
  const groupPrefixes: Record<string, string> = {
    "ENEL BRASIL":"ENEL","ENEL":"ENEL","EDP BRASIL":"EDP","EDP":"EDP",
    "EQUATORIAL ENERGIA":"EQUATORIAL","EQUATORIAL":"EQUATORIAL",
    "NEOENERGIA":"NEOENERGIA","ENERGISA":"ENERGISA",
  };
  const prefix = groupPrefixes[n];
  if (prefix) {
    const candidates = list.filter((d) => norm(d).startsWith(prefix));
    if (candidates.length === 1) return candidates[0];
    return "";
  }

  // Não é holding e não bate com allow-list → devolve raw, validador decide
  return raw.trim();
}

export function suggestDistribuidoras(uf?: string | null): string[] {
  const u = (uf || "").toUpperCase().trim();
  return DISTRIBUIDORAS_POR_UF[u] || [];
}

export function isValidDistribuidora(name?: string | null, uf?: string | null): boolean {
  if (!name || !name.trim()) return false;
  const n = norm(name);
  if (HOLDING_NAMES.includes(n)) return false;
  const list = suggestDistribuidoras(uf);
  if (list.length === 0) return true;
  return list.some((d) => norm(d) === n);
}

export function isHoldingName(name?: string | null): boolean {
  if (!name) return false;
  return HOLDING_NAMES.includes(norm(name));
}
