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
// ALIAS A ≡ D (rótulo "CEMIG" na UI): quando `variant='A'` e não há template
// público A cadastrado, usamos o template PÚBLICO da variante D. Isso torna
// A e D 100% idênticos em runtime sem duplicar dados. Se algum dia o Super
// Admin publicar um fluxo A real (foco CEMIG), esse passa a vencer o
// fallback automaticamente. Ver .lovable/plan.md.
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

  // helper: id do fluxo público de uma variante específica
  const getPublicFlowIdFor = async (targetV: string): Promise<string | null> => {
    const { data: pub } = await supabase
      .from("bot_flows")
      .select("id")
      .eq("is_public", true)
      .eq("is_active", true)
      .eq("variant", targetV)
      .limit(1)
      .maybeSingle();
    return (pub as any)?.id ?? null;
  };

  // Público para a variante pedida, com fallback A → D
  const getPublicFlowId = async (): Promise<string | null> => {
    const own = await getPublicFlowIdFor(v);
    if (own) return own;
    if (v === "A") return await getPublicFlowIdFor("D");
    return null;
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
  //    (com alias A → D quando A não existe)
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

/**
 * Resolve o consultant_id "dono" das mídias (áudio/vídeo/imagem) e do
 * `flow_step_media_order` que devem ser usados no runtime.
 *
 * - Quando o fluxo do consultor está em `sync_mode='public'` (default), as
 *   mídias vêm do dono do flow PÚBLICO (Super Admin) — assim qualquer
 *   consultor em modo público recebe os MESMOS áudios/vídeos/imagens.
 * - Quando `sync_mode='custom'`, mantém o próprio consultor.
 * - Alias A → D: quando variante A e não há público A, usa o dono do
 *   público D (mesma regra do `resolveFlowId`).
 *
 * Fallback seguro: retorna `consultantId` se algo falhar.
 */
export async function resolveMediaOwnerId(
  supabase: any,
  consultantId: string | null | undefined,
  variant: string | null | undefined,
): Promise<string> {
  const fallback = String(consultantId || "");
  if (!consultantId) return fallback;
  const v = String(variant || "A").toUpperCase();
  try {
    const { data: own } = await supabase
      .from("bot_flows")
      .select("sync_mode")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .eq("variant", v)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const mode = String((own as any)?.sync_mode ?? "public").toLowerCase();
    if (own && mode !== "public") return fallback;

    const pickOwner = async (targetV: string): Promise<string | null> => {
      const { data: pub } = await supabase
        .from("bot_flows")
        .select("consultant_id")
        .eq("is_public", true)
        .eq("is_active", true)
        .eq("variant", targetV)
        .limit(1)
        .maybeSingle();
      return ((pub as any)?.consultant_id as string | undefined) || null;
    };

    let pubOwner = await pickOwner(v);
    if (!pubOwner && v === "A") pubOwner = await pickOwner("D");
    return pubOwner || fallback;
  } catch {
    return fallback;
  }
}
