// Lead source tagging (Phase E Task 27 do whatsapp-flow-architecture-v3).
//
// Marca origem Meta por sinais fortes (AD ID/CTWA) ou regex de anúncio.
// Não atribui campanha por texto inicial. Roda fire-and-forget via `queueMicrotask` no
// webhook — falha de tagging NUNCA trava o turno do bot.
//
// Move o bloco `5.5 Auto-tag lead source` que vivia inline em
// `evolution-webhook/index.ts:341-460` para módulo dedicado, sem mudar
// a lógica de match.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonLog } from "../audit.ts";
import { extractMetaReferralFields, resolveCampaignFromStrongMeta } from "../deterministic-campaign-resolver.ts";

export interface TagLeadSourceInput {
  customer: {
    id: string;
    consultant_id: string;
    source_campaign_id?: string | null;
    lead_source?: string | null;
  };
  /** Texto da primeira mensagem (para match de initial_message ou regex). */
  messageText: string | null;
  /** Payload bruto do webhook (para extrair externalAdReply / ctwaClid). */
  rawWebhookBody: unknown;
  /** True quando inbound é mídia (regex ads não dispara em mídia). */
  isFile: boolean;
}

const ADS_REGEX = /(tenho interesse.*mais informa[çc][õo]es|gostaria de saber mais|quero saber mais|vi seu an[uú]ncio|vim do an[uú]ncio|do an[uú]ncio|pelo an[uú]ncio|vi o an[uú]ncio|facebook|instagram|\bfb ads?\b|\bmeta ads?\b|patrocinad|reels|stories|sponsored)/i;

/**
 * Roda detecção de origem do lead. NUNCA lança — todo erro vira `jsonLog`.
 *
 * Idempotente: se `customer.source_campaign_id` ou `customer.lead_source`
 * já estão setados, retorna imediatamente.
 */
export async function tagLeadSource(
  supabase: SupabaseClient,
  input: TagLeadSourceInput,
): Promise<void> {
  try {
    if (input.customer.source_campaign_id || input.customer.lead_source) {
      return; // já tageado
    }
    const body = input.rawWebhookBody as any;
    const msgData = body?.data?.message ?? body?.messages?.[0] ?? {};
    const ctxInfo =
      msgData?.extendedTextMessage?.contextInfo ||
      msgData?.imageMessage?.contextInfo ||
      msgData?.documentMessage?.contextInfo ||
      msgData?.videoMessage?.contextInfo ||
      msgData?.audioMessage?.contextInfo ||
      null;
    const externalAdReply = ctxInfo?.externalAdReply || null;
    const fields = extractMetaReferralFields(msgData, body);
    const ctwaClid = fields.ctwaClid || body?.data?.ctwaClid || externalAdReply?.ctwaClid || null;
    const sourceAdId = fields.sourceAdId || externalAdReply?.sourceId || externalAdReply?.source_id || null;
    const sourceUrl = fields.sourceUrl || externalAdReply?.sourceUrl || externalAdReply?.source_url || null;
    const hasReferral = !!(externalAdReply || ctwaClid || sourceAdId || sourceUrl);

    const referralPayload = externalAdReply
      ? {
          title: externalAdReply.title,
          body: externalAdReply.body,
          source_url: sourceUrl,
          source_id: sourceAdId,
          media_url: externalAdReply.thumbnailUrl,
          ctwa_clid: ctwaClid,
        }
      : ctwaClid
      ? { ctwa_clid: ctwaClid }
      : null;

    let sourceCampaignId: string | null = null;
    let matchMethod = "unmatched";

    // 1) Match por sinais fortes do Meta. Não usa texto inicial nem similaridade.
    if (hasReferral) {
      try {
        const strong = await resolveCampaignFromStrongMeta(supabase, input.customer.consultant_id, {
          referral: fields.referral || externalAdReply || null,
          ctwaClid,
          sourceAdId,
          sourceUrl,
          fbCampaignId: fields.fbCampaignId,
        });
        if (strong?.campaignId) {
          sourceCampaignId = strong.campaignId;
          matchMethod = strong.method;
        }
      } catch (e: any) {
        console.warn("[lead-source] strong meta lookup falhou:", e?.message);
      }
    }

    // Não atribuir campanha por initial_message/tsvector: texto não prova campanha.

    // 3) Regex fallback de frases típicas de anúncio
    const textMatch = !input.isFile && input.messageText && ADS_REGEX.test(input.messageText);

    if (hasReferral || textMatch || sourceCampaignId) {
      const patch: Record<string, unknown> = { lead_source: "meta_ads" };
      if (sourceCampaignId) patch.source_campaign_id = sourceCampaignId;
      if (ctwaClid) patch.source_ctwa_clid = ctwaClid;
      if (sourceAdId) patch.source_ad_id = String(sourceAdId);
      if (referralPayload) patch.source_referral = referralPayload;

      try {
        await supabase.from("customers").update(patch).eq("id", input.customer.id);
      } catch (e: any) {
        jsonLog("warn", "lead_source_tag_failed", {
          customer_id: input.customer.id,
          stage: "update_customers",
          message: e?.message,
        });
        return;
      }

      jsonLog("info", "lead_source_tagged", {
        customer_id: input.customer.id,
        consultant_id: input.customer.consultant_id,
        source_campaign_id: sourceCampaignId,
        ctwa_clid: ctwaClid,
        match_method: matchMethod,
      });
    }

    // Auditoria de match (best-effort, fail-open)
    try {
      await supabase.from("campaign_match_log").insert({
        customer_id: input.customer.id,
        campaign_id: sourceCampaignId,
        method: matchMethod,
        similarity_score: null,
        message_sample: input.messageText ? String(input.messageText).slice(0, 200) : null,
      });
    } catch (e: any) {
      console.warn("[campaign-match-log] insert falhou:", e?.message);
    }
  } catch (e: any) {
    // Captura final — tagging não pode quebrar o turno.
    jsonLog("warn", "lead_source_tag_failed", {
      customer_id: input.customer.id,
      stage: "outer_exception",
      message: e?.message ?? String(e),
    });
  }
}
