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
 *   2. Match exato do texto da mensagem com facebook_campaigns.initial_message
 *   3. Regex de palavras-chave de anúncio (fallback fraco)
 */

export interface AttributionResult {
  lead_source: "meta_ads" | null;
  source_campaign_id: string | null;
  source_ctwa_clid: string | null;
  source_referral: Record<string, unknown> | null;
  method: "ctwa_referral" | "initial_message_match" | "regex_fallback" | "none";
}

const ADS_REGEX = /(tenho interesse.*mais informa[çc][õo]es|gostaria de saber mais|quero saber mais|vi seu an[uú]ncio|vim do an[uú]ncio|do an[uú]ncio|pelo an[uú]ncio|vi o an[uú]ncio|facebook|instagram|\bfb ads?\b|\bmeta ads?\b|patrocinad|reels|stories|sponsored)/i;

/**
 * Normaliza texto para comparação: lowercase, sem acentos, sem pontuação extra.
 */
function normalizeText(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calcula similaridade simples entre dois textos normalizados.
 * Retorna 0..1. Usa Jaccard de bigramas de palavras.
 */
function textSimilarity(a: string, b: string): number {
  const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  wa.forEach((w) => { if (wb.has(w)) inter++; });
  return inter / Math.max(wa.size, wb.size);
}

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

      // Tenta mapear para campanha específica via ad_id ou campaign_id do referral
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

      if (adId || fbCampaignId) {
        let q = supabase
          .from("facebook_campaigns")
          .select("id")
          .eq("consultant_id", consultantId);
        if (fbCampaignId) {
          q = q.eq("fb_campaign_id", String(fbCampaignId));
        } else if (adId) {
          // fb_ad_ids é jsonb array
          q = q.contains("fb_ad_ids", [String(adId)]);
        }
        const { data: camp } = await q.maybeSingle();
        if (camp?.id) result.source_campaign_id = camp.id;
      }

      // Safety-net: se ainda não achou campanha, tenta extrair ad_id da source_url
      if (!result.source_campaign_id && sourceUrl) {
        try {
          const { extractAdIdFromSourceUrl } = await import("./ctwa-url-extractor.ts");
          const urlAdId = extractAdIdFromSourceUrl(String(sourceUrl));
          if (urlAdId) {
            const { data: camp } = await supabase
              .from("facebook_campaigns")
              .select("id")
              .eq("consultant_id", consultantId)
              .contains("fb_ad_ids", [urlAdId])
              .maybeSingle();
            if ((camp as any)?.id) result.source_campaign_id = (camp as any).id;
          }
        } catch { /* ignore */ }
      }

      await _persist(supabase, customerId, result);
      return result;
    }

    // ── Estratégia 2: match com initial_message das campanhas ─────────
    if (!isAudio && !isFile && messageText && messageText.trim().length >= 5) {
      const normMsg = normalizeText(messageText);

      const { data: campaigns } = await supabase
        .from("facebook_campaigns")
        .select("id, initial_message")
        .eq("consultant_id", consultantId)
        .not("initial_message", "is", null)
        .neq("initial_message", "");

      let bestCampaignId: string | null = null;
      let bestScore = 0;

      for (const camp of (campaigns || []) as Array<{ id: string; initial_message: string }>) {
        if (!camp.initial_message) continue;
        const normInitial = normalizeText(camp.initial_message);
        const score = textSimilarity(normMsg, normInitial);
        // Threshold: 0.6 = 60% das palavras em comum (robusto a variações)
        if (score > bestScore && score >= 0.6) {
          bestScore = score;
          bestCampaignId = camp.id;
        }
      }

      if (bestCampaignId) {
        result.lead_source = "meta_ads";
        result.source_campaign_id = bestCampaignId;
        result.method = "initial_message_match";
        await _persist(supabase, customerId, result);
        console.log(`[lead-attribution] customer ${customerId} → campanha ${bestCampaignId} (score=${bestScore.toFixed(2)} initial_message_match)`);
        return result;
      }
    }

    // ── Estratégia 3: regex de palavras-chave (fallback fraco) ────────
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
