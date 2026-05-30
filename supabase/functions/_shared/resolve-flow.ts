// Resolve o flow_id ativo para um consultor e variante.
// Prioriza o fluxo do próprio consultor. Se não houver, cai no
// fluxo PÚBLICO (template vivo do superadmin) com a mesma variante.
//
// Uso (substitui o padrão antigo):
//   const flowId = await resolveFlowId(supabase, consultantId, variant);
//   if (!flowId) { /* sem fluxo */ }
export async function resolveFlowId(
  supabase: any,
  consultantId: string | null | undefined,
  variant: string | null | undefined,
): Promise<string | null> {
  const v = String(variant || "A").toUpperCase();

  // 1) Fluxo próprio do consultor
  if (consultantId) {
    const { data: own } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .eq("variant", v)
      .maybeSingle();
    if (own?.id) return own.id as string;
  }

  // 2) Fallback: fluxo público (template) da mesma variante
  const { data: pub } = await supabase
    .from("bot_flows")
    .select("id")
    .eq("is_public", true)
    .eq("is_active", true)
    .eq("variant", v)
    .maybeSingle();
  if (pub?.id) return pub.id as string;

  // 3) Último fallback (legado): qualquer fluxo ativo do consultor, sem filtro de variante
  if (consultantId) {
    const { data: legacy } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (legacy?.id) return legacy.id as string;
  }
  return null;
}
