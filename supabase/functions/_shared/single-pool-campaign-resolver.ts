/**
 * single-pool-campaign-resolver.ts
 *
 * "4ª tentativa" — usada SOMENTE quando:
 *   - a frase-âncora do Meta CTWA bateu (matchesMetaCtwaPhrase = true)
 *   - AD ID / ctwa_clid / initial_message exato NÃO resolveram nada
 *
 * Regra (blindagem do rodízio preservada):
 *   - O consultor precisa ter EXATAMENTE UMA pool ativa com campanha vinculada.
 *   - A `initial_message` dessa campanha precisa ter similaridade de Jaccard
 *     (bigrama de palavras, normalizado) ≥ 0.4 com o texto recebido.
 *   - Se houver 2+ pools ativas com match parcial, retorna null — a lead vai
 *     pra revisão manual (não recriamos o furo de "chutar" campanha).
 *
 * Retorna o `campaign_id` a atribuir, ou null.
 */

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccard(a: string, b: string): number {
  const wa = new Set(normalize(a).split(/\s+/).filter((w) => w.length > 2));
  const wb = new Set(normalize(b).split(/\s+/).filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  wa.forEach((w) => { if (wb.has(w)) inter++; });
  return inter / (wa.size + wb.size - inter);
}

export async function resolveCampaignBySinglePoolFuzzy(
  supabase: any,
  consultantId: string,
  messageText: string | null | undefined,
  threshold = 0.4,
): Promise<string | null> {
  if (!messageText || messageText.trim().length < 5) return null;
  try {
    const { data: pools } = await supabase
      .from("rodizio_pools")
      .select("campaign_id, facebook_campaigns!inner(id, initial_message, status)")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .not("campaign_id", "is", null);

    const active = ((pools || []) as any[]).filter((p) => {
      const c = p.facebook_campaigns;
      return c && c.status === "active" && c.initial_message;
    });

    if (active.length !== 1) return null; // 0 ou 2+ → não chuta

    const camp = active[0].facebook_campaigns;
    const score = jaccard(messageText, camp.initial_message);
    if (score >= threshold) return camp.id as string;
    return null;
  } catch (e) {
    console.warn("[single-pool-resolver] falhou:", (e as Error)?.message);
    return null;
  }
}
