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
import { ufFromPhone, ufsFromCampaignCities } from "./ddd-uf-map.ts";

type ActivePoolCamp = {
  campaignId: string;
  initialMessage: string | null;
  cities: any;
};

async function listActivePoolCampaigns(
  supabase: any,
  consultantId: string,
): Promise<ActivePoolCamp[]> {
  const { data: pools } = await supabase
    .from("rodizio_pools")
    .select("campaign_id, facebook_campaigns!inner(id, initial_message, status, tracking_protocol, cities)")
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
      cities: p.facebook_campaigns.cities ?? null,
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

// ═══════════════════════════════════════════════════════════════════════════
// ESCADA DE FALLBACK — degraus 6, 7, 8 (auto, sem manual)
// Cada função devolve `{ campaignId, method, sample }` ou null.
// ═══════════════════════════════════════════════════════════════════════════

export type LadderResult = {
  campaignId: string;
  method: "ddd_city_match" | "recent_strong_activity" | "fallback_rotation";
  sample: string;
} | null;

/** Degrau 6 — match de DDD/cidade. Só decide se APENAS 1 campanha mira a UF. */
export async function resolveByDddCity(
  supabase: any,
  consultantId: string,
  phone: string | null | undefined,
): Promise<LadderResult> {
  try {
    const uf = ufFromPhone(phone);
    if (!uf) return null;
    const active = await listActivePoolCampaigns(supabase, consultantId);
    if (active.length < 2) return null;
    const matches = active.filter((c) => ufsFromCampaignCities(c.cities).has(uf));
    if (matches.length !== 1) return null;
    return {
      campaignId: matches[0].campaignId,
      method: "ddd_city_match",
      sample: `DDD → ${uf} · única campanha mirando ${uf}`,
    };
  } catch (e) {
    console.warn("[resolveByDddCity] falhou:", (e as Error).message);
    return null;
  }
}

/** Degrau 7 — única campanha com sinal forte (AD ID / ctwa_clid) nas últimas 24h. */
export async function resolveByRecentActivity(
  supabase: any,
  consultantId: string,
): Promise<LadderResult> {
  try {
    const active = await listActivePoolCampaigns(supabase, consultantId);
    if (active.length < 2) return null;
    const ids = active.map((a) => a.campaignId);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const { data } = await supabase
      .from("customers")
      .select("source_campaign_id, created_at, source_ad_id, source_ctwa_clid")
      .eq("consultant_id", consultantId)
      .in("source_campaign_id", ids)
      .gte("created_at", since)
      .or("source_ad_id.not.is.null,source_ctwa_clid.not.is.null")
      .order("created_at", { ascending: false })
      .limit(200);

    const byCamp = new Map<string, { count: number; last: string }>();
    for (const row of (data || []) as any[]) {
      const cid = String(row.source_campaign_id);
      const cur = byCamp.get(cid);
      if (!cur) byCamp.set(cid, { count: 1, last: row.created_at });
      else cur.count++;
    }
    if (byCamp.size !== 1) return null;
    const [cid, info] = [...byCamp.entries()][0];
    const minAgo = Math.round((Date.now() - new Date(info.last).getTime()) / 60000);
    return {
      campaignId: cid,
      method: "recent_strong_activity",
      sample: `única quente 24h: ${info.count} lead(s), último há ${minAgo}min`,
    };
  } catch (e) {
    console.warn("[resolveByRecentActivity] falhou:", (e as Error).message);
    return null;
  }
}

/** Degrau 8 — rodízio justo, com salvaguardas anti-contaminação entre pools.
 *  Regras (nesta ordem):
 *   a) filtra campanhas com "prova de vida" (≥1 lead nos últimos 7 dias);
 *   b) se o telefone tem UF conhecida, restringe às campanhas que miram essa UF;
 *   c) se sobrar exatamente 1 candidata → escolhe;
 *   d) se sobrar >1 → round-robin pela mais antiga (último lead há mais tempo);
 *   e) se sobrar 0 → devolve null (NÃO cruza pools; vai pra revisão manual).
 *  Nunca escolhe uma campanha fantasma (sem tráfego real).
 */
export async function resolveByFallbackRotation(
  supabase: any,
  consultantId: string,
  phone?: string | null,
): Promise<LadderResult> {
  try {
    const active = await listActivePoolCampaigns(supabase, consultantId);
    if (active.length === 0) return null;
    const ids = [...new Set(active.map((a) => a.campaignId))].sort();

    // (a) prova de vida — últimos 7 dias
    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("customers")
      .select("source_campaign_id, created_at")
      .eq("consultant_id", consultantId)
      .in("source_campaign_id", ids)
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(500);

    const lastByCamp = new Map<string, string>();
    const countByCamp = new Map<string, number>();
    for (const row of (data || []) as any[]) {
      const cid = String(row.source_campaign_id);
      if (!lastByCamp.has(cid)) lastByCamp.set(cid, row.created_at);
      countByCamp.set(cid, (countByCamp.get(cid) || 0) + 1);
    }
    const cutoff7 = Date.now() - 7 * 24 * 3600 * 1000;
    const alive = ids.filter((id) => {
      const last = lastByCamp.get(id);
      return last ? new Date(last).getTime() >= cutoff7 : false;
    });

    // Se nenhuma campanha teve tráfego real, NÃO cruza pools — manual.
    if (alive.length === 0) {
      console.warn("[fallback_rotation] nenhuma campanha viva; recusando para não contaminar pools");
      return null;
    }

    // (b) filtra por UF do DDD, se disponível
    const uf = ufFromPhone(phone);
    let candidates = alive;
    if (uf) {
      const byUf = alive.filter((id) => {
        const camp = active.find((a) => a.campaignId === id);
        return camp ? ufsFromCampaignCities(camp.cities).has(uf) : false;
      });
      if (byUf.length > 0) {
        candidates = byUf;
      } else {
        console.warn(`[fallback_rotation] DDD ${uf} sem campanha viva compatível; recusando`);
        return null;
      }
    }

    if (candidates.length === 0) return null;

    const ranked = candidates
      .map((id) => ({ id, last: lastByCamp.get(id) || null, n: countByCamp.get(id) || 0 }))
      .sort((a, b) => {
        if (a.last === null && b.last === null) return a.id.localeCompare(b.id);
        if (a.last === null) return -1;
        if (b.last === null) return 1;
        const cmp = a.last.localeCompare(b.last);
        return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
      });

    const winner = ranked[0];
    const summary = ranked
      .map((r) => {
        if (!r.last) return `${r.id.slice(0, 8)}(nunca)`;
        const h = Math.round((Date.now() - new Date(r.last).getTime()) / 3600000);
        return `${r.id.slice(0, 8)}(${h}h)`;
      })
      .join(" vs ");

    return {
      campaignId: winner.id,
      method: "fallback_rotation",
      sample: `rot${uf ? `[${uf}]` : ""}: ${summary} → ${winner.id.slice(0, 8)}`,
    };
  } catch (e) {
    console.warn("[resolveByFallbackRotation] falhou:", (e as Error).message);
    return null;
  }
}

/** Roda a escada 6→7→8 na ordem. Devolve null se nenhum degrau tiver certeza. */
export async function resolveCampaignAutoLadder(
  supabase: any,
  consultantId: string,
  ctx: { phone?: string | null; messageText?: string | null },
): Promise<LadderResult> {
  const step6 = await resolveByDddCity(supabase, consultantId, ctx.phone);
  if (step6) return step6;
  const step7 = await resolveByRecentActivity(supabase, consultantId);
  if (step7) return step7;
  const step8 = await resolveByFallbackRotation(supabase, consultantId, ctx.phone);
  if (step8) return step8;
  return null;
}


