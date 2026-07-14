import { calculateCampaignBudgetRequirement } from "./campaign-budget.ts";

interface ActivationBudgetInput {
  consultantId: string;
  dailyBudgetCents: number;
  durationDays?: number | null;
}

export async function validateCampaignActivationBudget(
  admin: any,
  input: ActivationBudgetInput,
): Promise<{ ok: boolean; error?: string; requiredCents?: number; availableCents?: number }> {
  const [{ data: settings, error: settingsError }, { data: wallet, error: walletError }] = await Promise.all([
    admin.from("platform_settings")
      .select("platform_fee_percent,campaign_safety_multiplier,min_balance_to_create_campaign_cents")
      .eq("id", true)
      .maybeSingle(),
    admin.from("consultant_wallet")
      .select("balance_cents,debt_cents")
      .eq("consultant_id", input.consultantId)
      .maybeSingle(),
  ]);

  if (settingsError || walletError) {
    return { ok: false, error: "Não foi possível validar a carteira antes da ativação." };
  }

  const balance = Number(wallet?.balance_cents ?? 0);
  const debt = Number(wallet?.debt_cents ?? 0);
  if (debt > 0) {
    return { ok: false, error: `Carteira em débito de R$ ${(debt / 100).toFixed(2)}. Regularize antes de ativar.` };
  }

  const requirement = calculateCampaignBudgetRequirement({
    dailyBudgetCents: input.dailyBudgetCents,
    durationDays: input.durationDays,
    platformFeePercent: Number(settings?.platform_fee_percent ?? 20),
    safetyMultiplier: Number(settings?.campaign_safety_multiplier ?? 1),
    minBalanceCents: Number(settings?.min_balance_to_create_campaign_cents ?? 3000),
  });
  const availableCents = Math.max(0, balance - debt);
  if (availableCents < requirement.requiredCents) {
    return {
      ok: false,
      error: `Saldo insuficiente para reativar. Necessário R$ ${(requirement.requiredCents / 100).toFixed(2)}; disponível R$ ${(availableCents / 100).toFixed(2)}.`,
      requiredCents: requirement.requiredCents,
      availableCents,
    };
  }

  return { ok: true, requiredCents: requirement.requiredCents, availableCents };
}
