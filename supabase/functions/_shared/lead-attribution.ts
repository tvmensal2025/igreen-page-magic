/**
 * lead-attribution.ts
 *
 * Identifica de qual campanha Facebook um lead veio e atribui:
 *   - customers.lead_source = "meta_ads"
 *   - customers.source_campaign_id = <uuid da campanha>
 *   - customers.source_ctwa_clid = <ctwa_clid do Meta>
 *   - customers.source_referral = <payload completo>
 *
 * Estratégias (em ordem de confiança):
 *   1. ctwa_clid + referral do payload Whapi/Evolution (sinal forte do Meta)
 *   2. Regex de palavras-chave de anúncio marca Meta Ads, mas não escolhe campanha.
 */

export interface AttributionResult {
  lead_source: "meta_ads" | null;
  source_campaign_id: string | null;
  source_ctwa_clid: string | null;
  source_referral: Record<string, unknown> | null;
  method: "ctwa_referral" | "regex_fallback" | "none";
}

const ADS_REGEX = /(tenho interesse.*mais informa[çc][õo]es|gostaria de saber mais|quero saber mais|vi seu an[uú]ncio|vim do an[uú]ncio|do an[uú]ncio|pelo an[uú]ncio|vi o an[uú]ncio|facebook|instagram|\bfb ads?\b|\bmeta ads?\b|patrocinad|reels|stories|sponsored)/i;

/**
 * Tenta atribuir o lead a uma campanha.
 *
 * @param supabase  Cliente Supabase com service role
 * @param consultantId  ID do consultor
 * @param customerId  ID do customer (para atualizar)
 * @param messageText  Texto da primeira mensagem do lead
 * @param rawMessage  Payload bruto da mensagem (para extrair referral/ctwa_clid)
 * @param isAudio  Se a mensagem é áudio (não compara texto)
 * @param isFile  Se a mensagem é arquivo (não compara texto)
 */
export async function attributeLeadSource(
  supabase: any,
  consultantId: string,
  customerId: string,
  messageText: string | null,
  rawMessage: Record<string, unknown>,
  isAudio = false,
  isFile = false,
): Promise<AttributionResult> {
  const result: AttributionResult = {
    lead_source: null,
    source_campaign_id: null,
    source_ctwa_clid: null,
    source_referral: null,
    method: "none",
  };

  try {
    // ── Estratégia 1: referral/ctwa_clid do Meta ──────────────────────
    // Whapi shape: messages[].context.ad = { ctwa, source: { id, type, url }, media_type, media_url, title, body }
    // Evolution/Cloud API shape: rawMessage.referral / context.referred_product / context.referral
    const ctxAd = (rawMessage.context as any)?.ad || null;
    const referral = (rawMessage.referral ||
      (rawMessage.context as any)?.referred_product ||
      (rawMessage.context as any)?.referral ||
      rawMessage.ad_reply ||
      ctxAd ||
      null) as Record<string, unknown> | null;
    const ctwaClid = (rawMessage.ctwa_clid ||
      (referral as any)?.ctwa_clid ||
      (ctxAd as any)?.ctwa ||
      (ctxAd as any)?.ctwa_clid ||
      null) as string | null;

    if (referral || ctwaClid) {
      result.lead_source = "meta_ads";
      result.source_ctwa_clid = ctwaClid;
      result.source_referral = referral as Record<string, unknown> | null;
      result.method = "ctwa_referral";

      // Tenta mapear para campanha específica via sinais fortes do Meta.
      const adId =
        (referral as any)?.ad_id ||
        (referral as any)?.source_id ||
        (ctxAd as any)?.source?.id ||
        null;
      const fbCampaignId = (referral as any)?.campaign_id || null;
      const sourceUrl =
        (referral as any)?.source_url ||
        (ctxAd as any)?.source?.url ||
        null;

      if (adId || fbCampaignId || sourceUrl || ctwaClid) {
        try {
          const { resolveCampaignFromStrongMeta } = await import("./deterministic-campaign-resolver.ts");
          const strong = await resolveCampaignFromStrongMeta(supabase, consultantId, {
            referral,
            ctwaClid,
            sourceAdId: adId ? String(adId) : null,
            sourceUrl: sourceUrl ? String(sourceUrl) : null,
            fbCampaignId: fbCampaignId ? String(fbCampaignId) : null,
          });
          if (strong?.campaignId) result.source_campaign_id = strong.campaignId;
        } catch { /* ignore */ }
      }

      await _persist(supabase, customerId, result);
      return result;
    }

    // Não atribuir campanha por initial_message: várias campanhas podem usar o
    // mesmo texto inicial. Só sinais fortes/protocolo definem campanha.

    // ── Estratégia 2: regex de palavras-chave (origem Meta, sem campanha) ──
    if (!isAudio && !isFile && messageText && ADS_REGEX.test(messageText)) {
      result.lead_source = "meta_ads";
      result.method = "regex_fallback";
      await _persist(supabase, customerId, result);
      console.log(`[lead-attribution] customer ${customerId} → meta_ads (regex_fallback)`);
      return result;
    }
  } catch (e: any) {
    console.warn("[lead-attribution] erro:", e?.message);
  }

  return result;
}

async function _persist(supabase: any, customerId: string, r: AttributionResult) {
  const patch: Record<string, unknown> = { lead_source: r.lead_source };
  if (r.source_campaign_id) patch.source_campaign_id = r.source_campaign_id;
  if (r.source_ctwa_clid) patch.source_ctwa_clid = r.source_ctwa_clid;
  if (r.source_referral) patch.source_referral = r.source_referral;
  await supabase.from("customers").update(patch).eq("id", customerId).is("lead_source", null);
}
