/**
 * single-pool-campaign-resolver.ts
 *
 * Resolvedor de campanha CTWA quando AD ID / ctwa_clid / initial_message exato
 * ainda não resolveram nada.
 *
 * Prioridade:
 *   1) protocolo profissional dentro da mensagem (FB-87321, IG-87321...)
 *   2) fallback seguro por similaridade: se exatamente UMA campanha ativa com
 *      pool ativa passar do threshold, usa essa campanha.
 *
 * Se houver empate ou nenhum sinal, retorna null. Não escolhe por acaso.
 *
 * Retorna o `campaign_id` a atribuir, ou null.
 */

import {
  jaccardSimilarity,
  resolveCampaignByTrackingProtocol,
} from "./campaign-tracking.ts";

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

    const { data: pools } = await supabase
      .from("rodizio_pools")
      .select("campaign_id, facebook_campaigns!inner(id, initial_message, status)")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .not("campaign_id", "is", null);

    const active = ((pools || []) as any[]).filter((p) => {
      const c = p.facebook_campaigns;
      return c && ["active", "pending_review"].includes(c.status) && c.initial_message;
    });

    const matches = active
      .map((p) => {
        const camp = p.facebook_campaigns;
        return { id: camp.id as string, score: jaccardSimilarity(messageText, camp.initial_message) };
      })
      .filter((m) => m.score >= threshold)
      .sort((a, b) => b.score - a.score);

    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1 && matches[0].score > matches[1].score + 0.15) return matches[0].id;
    return null;
  } catch (e) {
    console.warn("[single-pool-resolver] falhou:", (e as Error)?.message);
    return null;
  }
}
