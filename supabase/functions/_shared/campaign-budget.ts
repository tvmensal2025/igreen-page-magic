export interface CampaignBudgetInput {
  dailyBudgetCents: number;
  durationDays?: number | null;
  platformFeePercent?: number | null;
  safetyMultiplier?: number | null;
  minBalanceCents?: number | null;
}

export interface CampaignBudgetRequirement {
  mediaCents: number;
  feeCents: number;
  requiredCents: number;
  coverageDays: number;
}

/** Mínimo diário Meta em BRL (conta BR): R$ 5,17. */
export const META_MIN_DAILY_BUDGET_CENTS = 517;
export const META_MIN_DAILY_BUDGET_BRL = META_MIN_DAILY_BUDGET_CENTS / 100;

/** Mantém pré-voo e criação com a mesma regra de cobertura financeira. */
export function calculateCampaignBudgetRequirement(input: CampaignBudgetInput): CampaignBudgetRequirement {
  const dailyBudgetCents = Math.max(0, Math.round(Number(input.dailyBudgetCents) || 0));
  const durationDays = Math.max(0, Math.floor(Number(input.durationDays) || 0));
  const safetyDays = Math.max(3, Number(input.safetyMultiplier) || 1);
  const coverageDays = durationDays > 0 ? durationDays : safetyDays;
  const feeRate = Math.max(0, Number(input.platformFeePercent) || 0) / 100;
  const mediaCents = Math.round(dailyBudgetCents * coverageDays);
  const feeCents = Math.round(mediaCents * feeRate);
  const minBalanceCents = Math.max(0, Math.round(Number(input.minBalanceCents) || 0));

  return {
    mediaCents,
    feeCents,
    requiredCents: Math.max(minBalanceCents, mediaCents + feeCents),
    coverageDays,
  };
}
