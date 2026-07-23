/**
 * Recupera context.ad / ctwa_clid quando o webhook Whapi chegou sem referral.
 * Meta/Whapi às vezes omitem o bloco no POST; o GET /messages/list ainda traz.
 *
 * Não envia mensagem ao lead — só lê histórico.
 */

import { extractMetaReferralFields, type MetaReferralFields } from "./deterministic-campaign-resolver.ts";
import { findReferralPaths } from "./ctwa-referral-probe.ts";

const DEFAULT_BASE = "https://gate.whapi.cloud";

export type WhapiCtwaEnrichResult = MetaReferralFields & {
  recoveredFrom: "messages_list" | "messages_get";
  messageId: string | null;
};

function chatIdFromPhone(phoneOrJid: string): string {
  const raw = String(phoneOrJid || "").trim();
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

function fieldsFromMessage(msg: any, root?: unknown): MetaReferralFields | null {
  if (!msg || typeof msg !== "object") return null;
  const fields = extractMetaReferralFields(msg, root ?? msg);
  if (fields.sourceAdId || fields.ctwaClid || fields.sourceUrl || fields.fbCampaignId) {
    return fields;
  }
  const hit = findReferralPaths(msg);
  if (hit.sourceAdId || hit.ctwaClid || hit.sourceUrl) {
    return {
      referral: hit.raw,
      ctwaClid: hit.ctwaClid,
      sourceAdId: hit.sourceAdId,
      sourceUrl: hit.sourceUrl,
      fbCampaignId: null,
    };
  }
  return null;
}

async function whapiGetJson(
  token: string,
  baseUrl: string,
  path: string,
): Promise<any | null> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.warn(`[ctwa-whapi-enrich] GET ${path} → ${r.status}`);
      return null;
    }
    return await r.json().catch(() => null);
  } catch (e) {
    console.warn(`[ctwa-whapi-enrich] GET ${path} falhou:`, (e as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Tenta recuperar AD ID / ctwa_clid via API Whapi após webhook sem context.ad.
 */
export async function enrichCtwaFromWhapiApi(opts: {
  token: string;
  baseUrl?: string;
  phoneOrChatId: string;
  messageId?: string | null;
  count?: number;
}): Promise<WhapiCtwaEnrichResult | null> {
  const token = String(opts.token || "").trim();
  if (!token) return null;
  const base = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  const chatId = chatIdFromPhone(opts.phoneOrChatId);
  const count = Math.min(20, Math.max(3, opts.count ?? 8));

  const mid = String(opts.messageId || "").trim();
  if (mid) {
    const one = await whapiGetJson(token, base, `/messages/${encodeURIComponent(mid)}`);
    const msg = one?.message || one?.messages?.[0] || one;
    const fields = fieldsFromMessage(msg, one);
    if (fields) {
      return {
        ...fields,
        recoveredFrom: "messages_get",
        messageId: mid,
      };
    }
  }

  const list = await whapiGetJson(
    token,
    base,
    `/messages/list/${encodeURIComponent(chatId)}?count=${count}&sort=desc`,
  );
  const msgs: any[] = list?.messages || list?.data || [];
  for (const msg of msgs) {
    if (msg?.from_me) continue;
    const fields = fieldsFromMessage(msg, list);
    if (fields) {
      return {
        ...fields,
        recoveredFrom: "messages_list",
        messageId: msg?.id ? String(msg.id) : null,
      };
    }
  }

  return null;
}
