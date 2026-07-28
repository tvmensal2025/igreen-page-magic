/**
 * Bônus de entrada Conexão Green — faixas oficiais por volume de cadastros
 * no mês (pessoas) × tier da distribuidora.
 *
 * Fonte: regra comercial iGreen (entrada = % da fatura; parcela “na hora”
 * + parcela “na injeção”). Usado no card de Configurações, presets de Ads
 * e rótulos do wizard. Estimativa do motor Green continua em
 * `consultant_entrada_rules` por consultor.
 *
 * Recorrente CP padrão (1–9 pessoas / sem faixa de entrada): 4%.
 */

export type EntradaBonusTier = "alto" | "medio" | "sem_bonus";

export interface EntradaBonusFaixa {
  /** Mínimo de pessoas no mês (inclusive). */
  minPessoas: number;
  /** Máximo de pessoas (inclusive). null = sem teto. */
  maxPessoas: number | null;
  /** % total da fatura (imediato + injeção). */
  totalPct: number;
  /** % pago na hora do cadastro/aprovação. */
  imediatoPct: number;
  /** % pago na injeção. */
  injecaoPct: number;
  /** Rótulo curto pra UI. */
  label: string;
}

/** Tier alto — CPFL Paulista, Cemig, Copel, Equatorial, Coelba, etc. Teto 60%. */
export const ENTRADA_FAIXAS_ALTO: EntradaBonusFaixa[] = [
  { minPessoas: 1, maxPessoas: 9, totalPct: 4, imediatoPct: 4, injecaoPct: 0, label: "1–9 · padrão 4%" },
  { minPessoas: 10, maxPessoas: 39, totalPct: 20, imediatoPct: 10, injecaoPct: 10, label: "10–39 · 20% (10+10)" },
  { minPessoas: 40, maxPessoas: 99, totalPct: 40, imediatoPct: 20, injecaoPct: 20, label: "40–99 · 40% (20+20)" },
  { minPessoas: 100, maxPessoas: 199, totalPct: 50, imediatoPct: 30, injecaoPct: 20, label: "100–199 · 50% (30+20)" },
  { minPessoas: 200, maxPessoas: null, totalPct: 60, imediatoPct: 40, injecaoPct: 20, label: "200+ · 60% (40+20)" },
];

/**
 * Tier médio — Elektro e outras com teto 40%.
 * A partir de 40 pessoas o máximo permanece 40% (não sobe pra 50/60).
 */
export const ENTRADA_FAIXAS_MEDIO: EntradaBonusFaixa[] = [
  { minPessoas: 1, maxPessoas: 9, totalPct: 4, imediatoPct: 4, injecaoPct: 0, label: "1–9 · padrão 4%" },
  { minPessoas: 10, maxPessoas: 39, totalPct: 20, imediatoPct: 10, injecaoPct: 10, label: "10–39 · 20% (10+10)" },
  { minPessoas: 40, maxPessoas: null, totalPct: 40, imediatoPct: 20, injecaoPct: 20, label: "40+ · teto 40% (20+20)" },
];

/** Sem bônus de entrada (só recorrente / outras regras). */
export const ENTRADA_FAIXAS_SEM_BONUS: EntradaBonusFaixa[] = [
  { minPessoas: 1, maxPessoas: null, totalPct: 0, imediatoPct: 0, injecaoPct: 0, label: "Sem bônus de entrada" },
];

export const ENTRADA_BONUS_TETO: Record<EntradaBonusTier, number> = {
  alto: 60,
  medio: 40,
  sem_bonus: 0,
};

export const ENTRADA_BONUS_TIER_META: Record<
  EntradaBonusTier,
  { title: string; hint: string; exemplos: string; faixas: EntradaBonusFaixa[] }
> = {
  alto: {
    title: "🟢 Bônus alto",
    hint: "Teto 60% da fatura (40% na hora + 20% na injeção a partir de 200 pessoas).",
    exemplos: "CPFL Paulista, Cemig, Copel, Equatorial, Coelba, Enel CE, Neoenergia PE…",
    faixas: ENTRADA_FAIXAS_ALTO,
  },
  medio: {
    title: "🟡 Bônus médio",
    hint: "Teto 40% da fatura — a partir de 40 pessoas não sobe mais.",
    exemplos: "Elektro, Energisa PB/TO, RGE, Celesc…",
    faixas: ENTRADA_FAIXAS_MEDIO,
  },
  sem_bonus: {
    title: "⚪ Sem bônus",
    hint: "Sem bônus de entrada; vale recorrente e demais regras da região.",
    exemplos: "Regiões sem tabela de entrada (editável nas Configurações).",
    faixas: ENTRADA_FAIXAS_SEM_BONUS,
  },
};

export function resolveEntradaFaixa(
  tier: EntradaBonusTier,
  pessoasNoMes: number,
): EntradaBonusFaixa {
  const list =
    tier === "alto"
      ? ENTRADA_FAIXAS_ALTO
      : tier === "medio"
        ? ENTRADA_FAIXAS_MEDIO
        : ENTRADA_FAIXAS_SEM_BONUS;
  let chosen = list[0];
  for (const f of list) {
    if (pessoasNoMes >= f.minPessoas) chosen = f;
  }
  return chosen;
}
