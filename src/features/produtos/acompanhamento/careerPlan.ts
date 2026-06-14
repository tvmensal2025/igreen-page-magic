// =============================================================================
// Acompanhamento — Plano de Carreira (kWh-equivalente)
// =============================================================================
// Níveis de qualificação iGreen (manual qualificação-igreen). A progressão usa
// o total de kWh-equivalente acumulado (pontos das vendas ativas). Os requisitos
// de licenciados/recrutamento NÃO são calculados aqui — dependem de dados da
// rede (consultant_network) e do portal oficial. Este módulo cobre apenas o
// eixo de kWh, que é o que a plataforma consegue medir a partir de `sales`.
// =============================================================================

export interface CareerTier {
  /** Identificador estável do nível. */
  key: string;
  /** Nome exibido. */
  label: string;
  /** kWh-equivalente acumulado necessário para atingir o nível. */
  kwhRequired: number;
}

// Trilha "Green" do manual de qualificação (eixo kWh).
// Sênior 10.000 → Gestor 50.000 → Executivo 150.000 → Diretor 500.000 → Acionista 1.000.000
export const CAREER_TIERS: CareerTier[] = [
  { key: "licenciado", label: "Licenciado", kwhRequired: 0 },
  { key: "senior", label: "Sênior", kwhRequired: 10_000 },
  { key: "gestor", label: "Gestor", kwhRequired: 50_000 },
  { key: "executivo", label: "Executivo Green", kwhRequired: 150_000 },
  { key: "diretor", label: "Diretor Green", kwhRequired: 500_000 },
  { key: "acionista", label: "Acionista Green", kwhRequired: 1_000_000 },
];

export interface CareerProgress {
  current: CareerTier;
  next: CareerTier | null;
  /** kWh acumulado. */
  totalKwh: number;
  /** kWh restantes para o próximo nível (0 se for o topo). */
  kwhToNext: number;
  /** Progresso 0..1 dentro da faixa atual → próxima. */
  ratioToNext: number;
}

/**
 * Calcula o nível atual e a distância para o próximo, dado o total de
 * kWh-equivalente acumulado.
 */
export function computeCareerProgress(totalKwh: number): CareerProgress {
  const safeTotal = Number.isFinite(totalKwh) && totalKwh > 0 ? totalKwh : 0;

  let current = CAREER_TIERS[0];
  let next: CareerTier | null = null;

  for (let i = 0; i < CAREER_TIERS.length; i++) {
    if (safeTotal >= CAREER_TIERS[i].kwhRequired) {
      current = CAREER_TIERS[i];
      next = CAREER_TIERS[i + 1] ?? null;
    } else {
      break;
    }
  }

  const kwhToNext = next ? Math.max(0, next.kwhRequired - safeTotal) : 0;
  const ratioToNext = next
    ? Math.min(1, Math.max(0, (safeTotal - current.kwhRequired) / (next.kwhRequired - current.kwhRequired)))
    : 1;

  return { current, next, totalKwh: safeTotal, kwhToNext, ratioToNext };
}
