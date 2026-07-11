// Reconciliação de sinal forte do Meta em MENSAGEM SUBSEQUENTE.
//
// Problema: hoje a atribuição de campanha só roda quando o customer ainda não
// tem `source_campaign_id`/`lead_source`. Se a primeira mensagem chega SEM
// referral (ad_id/ctwa_clid) e o fallback escolhe a campanha errada, a segunda
// mensagem — que traz o ad_id verdadeiro — é ignorada e o lead fica preso na
// campanha errada (ex.: lead do ad Jaraguá indo pro pool do Horácio).
//
// Este helper roda ANTES do bloco de atribuição em todo webhook e:
// 1. Extrai sinais fortes (ad_id, ad_id em URL, fb_campaign_id, ctwa_clid).
// 2. Se resolve uma campanha DIFERENTE da persistida, sobrescreve, registra a
//    correção em `campaign_match_log` e persiste `source_ad_id`/`ctwa_clid`.
// 3. Não toca em nada quando não há sinal forte OU quando a campanha já bate.

import {
  campaignContainsAdId,
  extractMetaReferralFields,
  resolveCampaignFromStrongMeta,
} from "./deterministic-campaign-resolver.ts";

export type ReconcileResult =
  | { changed: false; reason: "no_strong_signal" | "no_resolution" | "already_correct" }
  | { changed: true; fromCampaignId: string | null; toCampaignId: string; method: string };

export async function reconcileStrongMetaCampaign(
  supabase: any,
  customer: any,
  rawMessage: any,
  rootPayload: unknown,
): Promise<ReconcileResult> {
  try {
    const consultantId = customer?.consultant_id;
    const customerId = customer?.id;
    if (!consultantId || !customerId) {
      return { changed: false, reason: "no_strong_signal" };
    }

    const fields = extractMetaReferralFields(rawMessage, rootPayload);
    const hasAnyStrong =
      !!fields.sourceAdId || !!fields.ctwaClid || !!fields.fbCampaignId || !!fields.sourceUrl;
    if (!hasAnyStrong) {
      return { changed: false, reason: "no_strong_signal" };
    }

    const strong = await resolveCampaignFromStrongMeta(supabase, consultantId, fields);
    if (!strong) {
      // Ainda assim persistimos os identificadores fortes para retro-atribuição.
      const patch: Record<string, any> = {};
      if (fields.sourceAdId && !customer.source_ad_id) patch.source_ad_id = String(fields.sourceAdId);
      if (fields.ctwaClid && !customer.ctwa_clid) patch.ctwa_clid = String(fields.ctwaClid);
      if (Object.keys(patch).length > 0) {
        await supabase.from("customers").update(patch).eq("id", customerId);
        Object.assign(customer, patch);
      }
      return { changed: false, reason: "no_resolution" };
    }

    const currentCampaignId: string | null = customer.source_campaign_id || null;
    if (currentCampaignId === strong.campaignId) {
      return { changed: false, reason: "already_correct" };
    }

    // Se já existe uma campanha persistida, só sobrescreve quando o ad_id
    // resolvido NÃO pertence à campanha atual (evita ping-pong desnecessário).
    if (currentCampaignId && strong.sourceAdId) {
      const currentBelongs = await campaignContainsAdId(
        supabase,
        currentCampaignId,
        strong.sourceAdId,
      );
      if (currentBelongs) {
        return { changed: false, reason: "already_correct" };
      }
    }

    // Sobrescreve a campanha; limpa o parceiro (rodízio será recalculado no
    // fluxo abaixo com a campanha correta).
    const patch: Record<string, any> = {
      source_campaign_id: strong.campaignId,
      lead_source: "meta_ads",
    };
    if (strong.sourceAdId) patch.source_ad_id = String(strong.sourceAdId);
    if (fields.ctwaClid) patch.ctwa_clid = String(fields.ctwaClid);
    if (currentCampaignId && currentCampaignId !== strong.campaignId) {
      patch.referral_partner_id = null;
    }

    await supabase.from("customers").update(patch).eq("id", customerId);
    Object.assign(customer, patch);

    // Registra a correção; método com prefixo "override_" para auditoria.
    try {
      await supabase.from("campaign_match_log").insert({
        customer_id: customerId,
        campaign_id: strong.campaignId,
        method: `override_${strong.method}`,
        similarity: null,
      });
    } catch { /* audit best-effort */ }

    console.log(
      `[reconcile-strong-meta] customer=${customerId} campanha corrigida de ${currentCampaignId ?? "null"} → ${strong.campaignId} (${strong.method}, ad_id=${strong.sourceAdId ?? "-"})`,
    );

    return {
      changed: true,
      fromCampaignId: currentCampaignId,
      toCampaignId: strong.campaignId,
      method: strong.method,
    };
  } catch (e) {
    console.warn("[reconcile-strong-meta] falhou:", (e as Error).message);
    return { changed: false, reason: "no_strong_signal" };
  }
}
