// Allow-list canônica de concessionárias por UF aceitas pelo Portal 2.
// Fonte: /bonus/distributors?uf=... do iGreen + ANEEL (concessões ativas).
//
// Regra de ouro: NUNCA mandar "CPFL ENERGIA", "ENEL BRASIL", "EDP BRASIL"
// etc — esses são GRUPOS HOLDING, não concessionárias. O Portal 2 devolve
// 404 silencioso em /bonus/rules e o lead "volta" sem aviso.
//
// Se a UF não estiver no mapa (sem allow-list conhecida), o validador
// ACEITA qualquer string não-vazia (fallback permissivo) — assim não
// bloqueamos UF nova até alguém atualizar a lista.

export const DISTRIBUIDORAS_POR_UF: Record<string, string[]> = {
  SP: [
    "CPFL PIRATININGA","CPFL PAULISTA","CPFL SANTA CRUZ","CPFL LESTE PAULISTA",
    "CPFL JAGUARI","CPFL MOCOCA","CPFL SUL PAULISTA","RGE",
    "ENEL SP","ENEL DISTRIBUIÇÃO SÃO PAULO","EDP SÃO PAULO","EDP SP",
    "ELEKTRO","ENERGISA SUL-SUDESTE",
  ],
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

// Holdings — NUNCA aceitas como distribuidora final. Sempre exigem
// substituição pela subsidiária regional.
const HOLDING_NAMES = [
  "CPFL ENERGIA","CPFL","ENEL BRASIL","ENEL","EDP BRASIL","EDP",
  "ENERGISA","EQUATORIAL ENERGIA","EQUATORIAL","NEOENERGIA",
];

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim().toUpperCase();

export function suggestDistribuidoras(uf?: string | null): string[] {
  const u = (uf || "").toUpperCase().trim();
  return DISTRIBUIDORAS_POR_UF[u] || [];
}

export function isValidDistribuidora(name?: string | null, uf?: string | null): boolean {
  if (!name || !name.trim()) return false;
  const n = norm(name);
  if (HOLDING_NAMES.includes(n)) return false;
  const list = suggestDistribuidoras(uf);
  if (list.length === 0) return true; // UF sem allow-list → permissivo
  return list.some((d) => norm(d) === n);
}

export function isHoldingName(name?: string | null): boolean {
  if (!name) return false;
  return HOLDING_NAMES.includes(norm(name));
}
