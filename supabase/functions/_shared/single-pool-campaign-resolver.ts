/**
 * single-pool-campaign-resolver.ts
 *
 * Resolvedor de campanha CTWA quando AD ID / ctwa_clid / protocolo FB-xxxxx
 * ainda não resolveram nada.
 *
 * Prioridade:
 *   1) protocolo profissional dentro da mensagem (FB-87321, IG-87321...)
 *   2) se o consultor tem EXATAMENTE 1 pool ativa → usa essa campanha
 *      (seguro: não há ambiguidade de campanha)
 *   3) fallback por similaridade Jaccard ≥ threshold com initial_message
 *      (só se 1 match claro ou líder com margem)
 *
 * Se houver empate ou nenhum sinal, retorna null. Não escolhe por acaso.
 */

import {
  jaccardSimilarity,
  resolveCampaignByTrackingProtocol,
} from "./campaign-tracking.ts";

type ActivePoolCamp = {
  campaignId: string;
  initialMessage: string | null;
};

async function listActivePoolCampaigns(
  supabase: any,
  consultantId: string,
): Promise<ActivePoolCamp[]> {
  const { data: pools } = await supabase
    .from("rodizio_pools")
    .select("campaign_id, facebook_campaigns!inner(id, initial_message, status, tracking_protocol)")
    .eq("consultant_id", consultantId)
    .eq("is_active", true)
    .not("campaign_id", "is", null);

  return ((pools || []) as any[])
    .filter((p) => {
      const c = p.facebook_campaigns;
      return c && ["active", "pending_review"].includes(c.status);
    })
    .map((p) => ({
      campaignId: String(p.facebook_campaigns.id),
      initialMessage: p.facebook_campaigns.initial_message ?? null,
    }));
}

/**
 * Se o consultor tem exatamente 1 campanha com pool de rodízio ativa,
 * retorna esse campaign_id. Usado quando a frase-âncora do Meta chega
 * sem AD ID / ctwa_clid / FB-xxxxx — sem ambiguidade, o rodízio pode rodar.
 */
export async function resolveCampaignBySoleActivePool(
  supabase: any,
  consultantId: string,
): Promise<string | null> {
  try {
    const active = await listActivePoolCampaigns(supabase, consultantId);
    // Dedup por campaign_id (pode haver 2 pools apontando pra mesma campanha)
    const unique = [...new Set(active.map((a) => a.campaignId))];
    if (unique.length === 1) return unique[0];
    return null;
  } catch (e) {
    console.warn("[sole-active-pool] falhou:", (e as Error)?.message);
    return null;
  }
}

export async function resolveCampaignBySinglePoolFuzzy(
  supabase: any,
  consultantId: string,
  messageText: string | null | undefined,
  threshold = 0.4,
): Promise<string | null> {
  if (!messageText || messageText.trim().length < 5) return null;
  try {
    const byProtocol = await resolveCampaignByTrackingProtocol(supabase, consultantId, messageText);
    if (byProtocol) return byProtocol;

    // 1 pool ativa = atribuição segura (mesmo sem similaridade de texto)
    const sole = await resolveCampaignBySoleActivePool(supabase, consultantId);
    if (sole) return sole;

    const active = await listActivePoolCampaigns(supabase, consultantId);
    const withMsg = active.filter((a) => a.initialMessage);

    const matches = withMsg
      .map((a) => ({
        id: a.campaignId,
        score: jaccardSimilarity(messageText, a.initialMessage || ""),
      }))
      .filter((m) => m.score >= threshold)
      .sort((a, b) => b.score - a.score);

    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1 && matches[0].score > matches[1].score + 0.15) {
      return matches[0].id;
    }
    return null;
  } catch (e) {
    console.warn("[single-pool-resolver] falhou:", (e as Error)?.message);
    return null;
  }
}
