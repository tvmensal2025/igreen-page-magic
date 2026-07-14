// Impede reativar campanha com rodízio habilitado, mas vazio ou inconsistente.
export async function validateRodizioActivation(
  admin: any,
  campaignId: string,
  consultantId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: pool, error: poolError } = await admin
    .from("rodizio_pools")
    .select("id, consultant_id, is_enabled")
    .eq("campaign_id", campaignId)
    .maybeSingle();

  if (poolError) return { ok: false, error: "Não foi possível validar o rodízio antes da ativação." };
  if (!pool || pool.is_enabled !== true) return { ok: true };
  if (pool.consultant_id !== consultantId) {
    return { ok: false, error: "Rodízio pertence a outro consultor. Ativação bloqueada." };
  }

  const { data: members, error: memberError } = await admin
    .from("rodizio_pool_members")
    .select("partner_id, referral_partners!inner(consultant_id, is_active)")
    .eq("pool_id", pool.id);
  if (memberError) return { ok: false, error: "Não foi possível validar os participantes do rodízio." };

  const rows = (members as any[]) || [];
  const eligible = rows.filter((member) =>
    member.referral_partners?.consultant_id === consultantId &&
    member.referral_partners?.is_active === true
  );
  if (eligible.length < 1 || eligible.length !== rows.length) {
    return { ok: false, error: "O rodízio está vazio ou possui participante inválido/inativo. Corrija antes de ativar." };
  }
  return { ok: true };
}
