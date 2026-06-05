// Resolve o flow_id ativo para um consultor e variante.
//
// Regras (em ordem):
//  1) Fluxo próprio do consultor (variante correta). Se `sync_mode='public'`,
//     redireciona para o template PÚBLICO da mesma variante (estrutura
//     sincronizada). Mídias continuam sendo lidas por `consultant_id` nos
//     callers — então a troca é transparente.
//  2) Sem fluxo próprio → fallback no template PÚBLICO (legado).
//  3) Último fallback (legado): primeiro fluxo ativo do consultor (sem variante).
//
// Uso:
//   const flow = await resolveFlowId(supabase, consultantId, variant);
//   if (!flow) { /* sem fluxo */ }
export async function resolveFlowId(
  supabase: any,
  consultantId: string | null | undefined,
  variant: string | null | undefined,
): Promise<{ id: string } | null> {
  const v = String(variant || "A").toUpperCase();

  // helper: id do fluxo público da variante v
  const getPublicFlowId = async (): Promise<string | null> => {
    const { data: pub } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("is_public", true)
      .eq("is_active", true)
      .eq("variant", v)
      .limit(1)
      .maybeSingle();
    return (pub as any)?.id ?? null;
  };

  // 1) Fluxo próprio do consultor (variante correta)
  if (consultantId) {
    const { data: own } = await supabase
      .from("bot_flows")
      .select("id, sync_mode")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .eq("variant", v)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if ((own as any)?.id) {
      // Modo "100% igual ao público": estrutura vem do template público.
      // Coluna pode não existir em deploys antigos — qualquer valor diferente
      // de 'custom' cai no caminho público para nascimentos novos (default 'public').
      const mode = String((own as any).sync_mode ?? "public").toLowerCase();
      if (mode === "public") {
        const pubId = await getPublicFlowId();
        if (pubId) return { id: pubId };
        // sem público disponível → cai no próprio
      }
      return { id: (own as any).id as string };
    }
  }

  // 2) Fallback: fluxo PÚBLICO (template vivo do superadmin) na mesma variante
  const pubId = await getPublicFlowId();
  if (pubId) return { id: pubId };

  // 3) Último fallback (legado): primeiro fluxo ativo do consultor (sem variante)
  if (consultantId) {
    const { data: legacy } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if ((legacy as any)?.id) return { id: (legacy as any).id as string };
  }
  return null;
}
