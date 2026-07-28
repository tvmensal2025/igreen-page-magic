/**
 * Tabela oficial Conexão Green — Bônus Extra (Julho 2026).
 * Fonte: arte comercial iGreen (distribuidora × UF × faixa de pessoas).
 *
 * Nomes em `distribuidorasApi` batem com a allow-list iGreen
 * (`DISTRIBUIDORAS_POR_UF` / `consultant_entrada_rules`).
 * Presets de Ads (`distribuidoraPresets`) usam nomes de marketing —
 * o tier (alto/médio) é o mesmo.
 */

import {
  ENTRADA_FAIXAS_ALTO,
  ENTRADA_FAIXAS_MEDIO,
  type EntradaBonusFaixa,
  type EntradaBonusTier,
} from "./entradaBonusTiers";

export interface OficialEntradaDistribuidora {
  /** Nome oficial API iGreen (uppercase). */
  distribuidorasApi: string[];
  /** UF(s) da arte. */
  ufs: string[];
  /** Rótulo amigável pra UI. */
  label: string;
  tier: EntradaBonusTier;
}

/** Tier alto — teto 60% (200+ pessoas). */
export const OFICIAL_ENTRADA_ALTO: OficialEntradaDistribuidora[] = [
  { ufs: ["AL"], label: "Equatorial AL", distribuidorasApi: ["EQUATORIAL"], tier: "alto" },
  { ufs: ["BA"], label: "Coelba", distribuidorasApi: ["COELBA"], tier: "alto" },
  { ufs: ["CE"], label: "Enel CE", distribuidorasApi: ["ENEL"], tier: "alto" },
  { ufs: ["GO"], label: "Equatorial GO", distribuidorasApi: ["EQUATORIAL"], tier: "alto" },
  { ufs: ["MG"], label: "Cemig", distribuidorasApi: ["CEMIG-D"], tier: "alto" },
  { ufs: ["MS"], label: "Energisa MS", distribuidorasApi: ["ENERGISA"], tier: "alto" },
  { ufs: ["MT"], label: "Energisa MT", distribuidorasApi: ["ENERGISA"], tier: "alto" },
  { ufs: ["PE"], label: "Neoenergia PE", distribuidorasApi: ["NEO ENERGIA"], tier: "alto" },
  { ufs: ["PI"], label: "Equatorial PI", distribuidorasApi: ["EQUATORIAL"], tier: "alto" },
  { ufs: ["PR"], label: "Copel", distribuidorasApi: ["COPEL"], tier: "alto" },
  { ufs: ["RJ", "MG"], label: "Energisa Minas Rio", distribuidorasApi: ["ENERGISA MINAS RIO"], tier: "alto" },
  { ufs: ["RN"], label: "Cosern", distribuidorasApi: ["COSERN"], tier: "alto" },
  { ufs: ["SP"], label: "CPFL", distribuidorasApi: ["CPFL"], tier: "alto" },
  { ufs: ["SP"], label: "Energisa Sul-Sudeste", distribuidorasApi: ["ENERGISA SUL SUDESTE"], tier: "alto" },
];

/** Tier médio — teto 40% (a partir de 40 pessoas). */
export const OFICIAL_ENTRADA_MEDIO: OficialEntradaDistribuidora[] = [
  { ufs: ["PB"], label: "Energisa PB", distribuidorasApi: ["ENERGISA PB"], tier: "medio" },
  { ufs: ["SP", "MS"], label: "Elektro", distribuidorasApi: ["ELEKTRO"], tier: "medio" },
  { ufs: ["TO"], label: "Energisa TO", distribuidorasApi: ["ENERGISA TOCANTINS"], tier: "medio" },
  { ufs: ["RS"], label: "RGE", distribuidorasApi: ["RGE"], tier: "medio" },
  { ufs: ["SC"], label: "Celesc", distribuidorasApi: ["CELESC"], tier: "medio" },
];

export function faixasOficiaisParaTier(tier: EntradaBonusTier): EntradaBonusFaixa[] {
  if (tier === "alto") return ENTRADA_FAIXAS_ALTO;
  if (tier === "medio") return ENTRADA_FAIXAS_MEDIO;
  return [];
}

/**
 * Lista única de nomes API × faixas oficiais para seed em
 * `consultant_entrada_rules`. EQUATORIAL/ENERGISA compartilham nome entre UFs —
 * uma só regra cobre todas (contagem somada ou individual por nome).
 */
export function buildOfficialEntradaSeedRows(): Array<{
  distribuidora: string;
  minPessoas: number;
  entradaTotalPct: number;
  pctImediato: number;
  pctDiferido: number;
  diasDiferido: number;
}> {
  const byName = new Map<string, EntradaBonusTier>();
  for (const row of [...OFICIAL_ENTRADA_ALTO, ...OFICIAL_ENTRADA_MEDIO]) {
    for (const nome of row.distribuidorasApi) {
      const key = nome.trim().toUpperCase();
      // Prefer alto se o mesmo nome aparecer nos dois (não deve).
      if (!byName.has(key) || row.tier === "alto") byName.set(key, row.tier);
    }
  }

  const rows: Array<{
    distribuidora: string;
    minPessoas: number;
    entradaTotalPct: number;
    pctImediato: number;
    pctDiferido: number;
    diasDiferido: number;
  }> = [];

  for (const [distribuidora, tier] of byName) {
    for (const f of faixasOficiaisParaTier(tier)) {
      // 1–9 = recorrente padrão 4% — também grava pra bater a tabela.
      rows.push({
        distribuidora,
        minPessoas: f.minPessoas,
        entradaTotalPct: f.totalPct,
        pctImediato: f.imediatoPct,
        pctDiferido: f.injecaoPct,
        diasDiferido: 90,
      });
    }
  }
  return rows;
}
