/**
 * WAME API (api-wa.me) — cliente HTTP do canal piloto.
 *
 * Canal PARALELO ao Whapi. Não substitui nem toca no caminho Whapi/Evolution:
 * só é usado quando `customers.origin_channel = "wame"` ou a instância do
 * consultor começa com `wame`.
 *
 * Contrato REST (SDK @raphaelvserafim/client-api-whatsapp v1.9):
 *   base = `${server}/${key}`  → a API key vai no PATH, não em header
 *   POST {base}/message/text      { to, text, provider? }
 *   POST {base}/message/image     { to, url, caption, provider? }
 *   POST {base}/message/audio     { to, url, provider? }
 *   POST {base}/message/video     { to, url, caption, provider? }
 *   POST {base}/message/document  { to, url, mimetype, fileName, caption }
 *   POST {base}/message/presence  { to, status }
 *   POST {base}/message/button_reply { to, header, text, footer, buttons }
 *   GET  {base}/message/{id}/media?format=json
 *   GET  {base}/instance
 *
 * Multicanal: `provider` ("whatsapp" | "instagram" | "messenger") é aceito no
 * body dos envios. O piloto usa sempre "whatsapp"; o campo já existe aqui para
 * IG/Messenger entrarem depois sem reescrever o cliente.
 */

import { fetchWithTimeout, logStructured, normalizePhone } from "./utils.ts";
import {
  acquireOutboundSlot,
  recordOutboundResult,
  type AcquireOutboundSlotInput,
} from "./idempotency.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const TIMEOUT_WAME = 12_000;

export type WameProvider = "whatsapp" | "instagram" | "messenger";

export type WamePresence =
  | "composing"
  | "recording"
  | "paused"
  | "available"
  | "unavailable";

export interface WameIdempotencyOptions {
  idempotencyKey?: string;
  customerId?: string;
  consultantId?: string;
  payloadHash?: string;
  supabase?: SupabaseClient;
}

export interface WameSendOutcome {
  ok: boolean;
  messageId: string | null;
  /** Classificação para `SendResult.reason` do adapter. */
  failureKind?:
    | "network"
    | "rate_limited"
    | "unauthorized"
    | "invalid_payload"
    | "timeout"
    | "unknown";
  detail?: string;
}

export interface WameButton {
  id: string;
  title: string;
}

/** `to` aceito pela WAME: dígitos puros (ou JID de grupo `...@g.us`). */
export function toWameRecipient(phoneOrJid: string): string {
  const raw = String(phoneOrJid || "").trim();
  if (!raw) return "";
  if (raw.endsWith("@g.us")) return raw;
  const digits = raw.replace("@s.whatsapp.net", "").replace("@c.us", "");
  return normalizePhone(digits) || digits.replace(/\D/g, "");
}

function classifyStatus(status: number): WameSendOutcome["failureKind"] {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "invalid_payload";
  if (status >= 500) return "network";
  return "unknown";
}

/**
 * Cria o sender WAME. `server` sem barra final (ex.: `https://us.api-wa.me`).
 *
 * Piloto: sem resolução de 9º dígito BR via API (o Whapi faz via
 * `resolveWhatsAppChatId`). O número de teste é cadastrado já normalizado; se
 * o piloto crescer para leads antigos, plugar `action/check-registered` aqui.
 */
export function createWameSender(
  server: string,
  apiKey: string,
  opts?: { provider?: WameProvider },
) {
  const base = `${String(server || "").replace(/\/$/, "")}/${String(apiKey || "").trim()}`;
  const provider: WameProvider = opts?.provider || "whatsapp";

  async function withIdempotency(
    label: string,
    idempotency: WameIdempotencyOptions | undefined,
    doSend: () => Promise<WameSendOutcome>,
  ): Promise<WameSendOutcome> {
    const idemKey = idempotency?.idempotencyKey;
    const idemSupabase = idempotency?.supabase;
    const idemEnabled = !!(
      idemKey && idemSupabase &&
      idempotency?.customerId &&
      idempotency?.consultantId &&
      idempotency?.payloadHash
    );
    if (idemEnabled) {
      try {
        const slot = await acquireOutboundSlot(idemSupabase!, {
          idempotencyKey: idemKey!,
          customerId: idempotency!.customerId!,
          consultantId: idempotency!.consultantId!,
          payloadHash: idempotency!.payloadHash!,
        } as AcquireOutboundSlotInput);
        if (!slot.acquired && slot.previousResultStatus !== "failed") {
          logStructured("info", "wame_send_idempotent_replay", {
            kind: label,
            previous_status: slot.previousResultStatus ?? null,
          });
          return { ok: true, messageId: slot.previousMessageId ?? null };
        }
      } catch (e) {
        console.warn(`[wame-api] idempotency pre-check falhou; envia mesmo assim`, e);
      }
    }
    let outcome: WameSendOutcome = { ok: false, messageId: null, failureKind: "unknown" };
    try {
      outcome = await doSend();
    } finally {
      if (idemEnabled) {
        try {
          // Guarda o id: sem ele o webhook de status não casa o ACK.
          await recordOutboundResult(
            idemSupabase!,
            idemKey!,
            outcome.ok ? "sent" : "failed",
            outcome.messageId,
          );
        } catch (_) { /* swallow */ }
      }
    }
    return outcome;
  }

  async function post(
    route: string,
    body: Record<string, unknown>,
    label: string,
  ): Promise<WameSendOutcome> {
    const url = `${base}/${route}`;
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeout: TIMEOUT_WAME,
      });
      const text = await res.text();
      if (!res.ok) {
        logStructured("error", "wame_send_failed", {
          kind: label,
          status: res.status,
          body: text.slice(0, 300),
        });
        return {
          ok: false,
          messageId: null,
          failureKind: classifyStatus(res.status),
          detail: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      let messageId: string | null = null;
      try {
        const data = text ? JSON.parse(text) : null;
        messageId = String(
          data?.messageId ?? data?.message?.id ?? data?.id ?? data?.key?.id ?? "",
        ) || null;
      } catch (_) { /* resposta sem JSON — envio ok mesmo assim */ }
      return { ok: true, messageId };
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      const isTimeout = /abort|timeout/i.test(msg);
      logStructured("error", "wame_send_exception", { kind: label, error: msg });
      return {
        ok: false,
        messageId: null,
        failureKind: isTimeout ? "timeout" : "network",
        detail: msg,
      };
    }
  }

  return {
    provider,

    async sendText(
      to: string,
      text: string,
      idempotency?: WameIdempotencyOptions,
    ): Promise<WameSendOutcome> {
      const recipient = toWameRecipient(to);
      if (!recipient) {
        return { ok: false, messageId: null, failureKind: "invalid_payload", detail: "destino vazio" };
      }
      return await withIdempotency("text", idempotency, () =>
        post("message/text", { to: recipient, text, provider }, "text"));
    },

    async sendMedia(
      to: string,
      url: string,
      caption: string,
      kind: "image" | "audio" | "video" | "document",
      extra?: { filename?: string; mimetype?: string },
      idempotency?: WameIdempotencyOptions,
    ): Promise<WameSendOutcome> {
      const recipient = toWameRecipient(to);
      if (!recipient || !url) {
        return { ok: false, messageId: null, failureKind: "invalid_payload", detail: "destino/url vazio" };
      }
      const body: Record<string, unknown> = { to: recipient, url, provider };
      if (kind === "image" || kind === "video") body.caption = caption || "";
      if (kind === "document") {
        body.mimetype = extra?.mimetype || "application/pdf";
        body.fileName = extra?.filename || "arquivo";
        if (caption) body.caption = caption;
      }
      return await withIdempotency(kind, idempotency, () =>
        post(`message/${kind}`, body, kind));
    },

    /**
     * Quick replies. Mesmos limites do WhatsApp aplicados pelo Whapi:
     * no máximo 3 botões e título de 25 caracteres — acima disso o
     * WhatsApp rejeita a mensagem inteira.
     */
    async sendButtons(
      to: string,
      text: string,
      buttons: WameButton[],
      idempotency?: WameIdempotencyOptions,
    ): Promise<WameSendOutcome> {
      const recipient = toWameRecipient(to);
      if (!recipient || buttons.length === 0) {
        return { ok: false, messageId: null, failureKind: "invalid_payload", detail: "destino/botões vazios" };
      }
      const safeButtons = buttons.slice(0, 3).map((b) => ({
        type: "quick_reply",
        id: b.id,
        text: (b.title || "").substring(0, 25),
      }));
      const body = {
        to: recipient,
        text,
        footer: "iGreen Energy ☀️",
        provider,
        buttons: safeButtons,
      };
      return await withIdempotency("buttons", idempotency, () =>
        post("message/button_reply", body, "buttons"));
    },

    /** Presence é cosmética — nunca propaga erro. */
    async sendPresence(to: string, status: WamePresence): Promise<void> {
      const recipient = toWameRecipient(to);
      if (!recipient) return;
      try {
        await post("message/presence", { to: recipient, status, provider }, "presence");
      } catch (_) { /* cosmética */ }
    },

    /** Baixa mídia de uma mensagem recebida. Retorna base64 + mime, ou null. */
    async downloadMedia(
      messageId: string,
    ): Promise<{ base64: string; mime: string } | null> {
      if (!messageId) return null;
      try {
        const res = await fetchWithTimeout(
          `${base}/message/${encodeURIComponent(messageId)}/media?format=json`,
          { method: "GET", timeout: TIMEOUT_WAME },
        );
        if (!res.ok) return null;
        const data = await res.json();
        const b64 = data?.base64 ?? data?.data ?? data?.media;
        if (!b64) return null;
        return {
          base64: String(b64).replace(/^data:[^;]+;base64,/i, ""),
          mime: String(data?.mimeType ?? data?.mimetype ?? "application/octet-stream"),
        };
      } catch (_) {
        return null;
      }
    },

    /** Saúde da instância (QR conectado?). Nunca lança. */
    async getInstanceInfo(): Promise<Record<string, unknown> | null> {
      try {
        const res = await fetchWithTimeout(`${base}/instance`, {
          method: "GET",
          timeout: TIMEOUT_WAME,
        });
        if (!res.ok) return null;
        return await res.json();
      } catch (_) {
        return null;
      }
    },
  };
}

// ─── Inbound (webhook format = "meta") ────────────────────────────────────

export interface WameParsedInbound {
  provider: WameProvider;
  official: boolean;
  instanceId: string;
  messageId: string;
  /** Remetente cru do envelope (telefone no WhatsApp; IGSID/PSID no IG/FB). */
  from: string;
  /** Só preenchido no WhatsApp — IG/Messenger não têm telefone. */
  phone: string;
  fromMe: boolean;
  isGroup: boolean;
  messageText: string;
  buttonId: string | null;
  profileName: string;
  mediaKind: "image" | "audio" | "video" | "document" | null;
  mediaUrl: string;
  mediaMime: string;
  /** Referral CTWA (anúncio Meta) quando presente. */
  referralSourceId: string;
  eventType: string;
}

/**
 * O WhatsApp devolve o id do botão prefixado (`ButtonsV3:` / `ListV3:`)
 * dependendo da renderização. O funil compara o id CRU (ex.: `bill_value`),
 * então o prefixo tem que sair aqui — mesmo strip do `parseWhapiMessage`.
 */
function stripButtonProtocol(raw: unknown): string | null {
  const id = String(raw ?? "").replace(/^(ButtonsV3|ListV3):/, "").trim();
  return id || null;
}

function firstMessageChange(body: unknown): {
  entryId: string;
  value: Record<string, any>;
  msg: Record<string, any>;
} | null {
  const envelope = body as Record<string, any> | null;
  if (!envelope || !Array.isArray(envelope.entry)) return null;
  for (const entry of envelope.entry) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== "messages") continue;
      const value = change?.value ?? {};
      const messages = Array.isArray(value.messages) ? value.messages : [];
      if (messages.length === 0) continue;
      return { entryId: String(entry?.id ?? ""), value, msg: messages[0] };
    }
  }
  return null;
}

/**
 * Normaliza o envelope Meta da WAME para a forma usada pelo webhook do piloto.
 * Só a PRIMEIRA mensagem do lote — o webhook do piloto processa uma por vez
 * (paridade com `parseWhapiMessage`). Nunca lança: shape ruim → null.
 */
export function parseWameMessage(body: unknown): WameParsedInbound | null {
  try {
    const hit = firstMessageChange(body);
    if (!hit) return null;
    const envelope = body as Record<string, any>;
    const { entryId, value, msg } = hit;

    const contacts = Array.isArray(value.contacts) ? value.contacts : [];
    const contact = contacts.find(
      (c: any) => c?.wa_id === msg?.from || c?.user_id === msg?.from_user_id,
    ) ?? contacts[0];

    const provider = (envelope.provider as WameProvider) || "whatsapp";
    const from = String(msg?.from ?? "");
    const type = String(msg?.type ?? "");

    let messageText = "";
    let buttonId: string | null = null;
    let mediaKind: WameParsedInbound["mediaKind"] = null;
    let mediaUrl = "";
    let mediaMime = "";

    if (type === "text") {
      messageText = String(msg?.text?.body ?? "");
    } else if (type === "interactive") {
      const interactive = msg?.interactive ?? {};
      if (interactive?.button_reply) {
        buttonId = stripButtonProtocol(interactive.button_reply.id);
        messageText = String(interactive.button_reply.title ?? "");
      } else if (interactive?.list_reply) {
        buttonId = stripButtonProtocol(interactive.list_reply.id);
        messageText = String(interactive.list_reply.title ?? "");
      }
    } else if (type === "button") {
      buttonId = stripButtonProtocol(msg?.button?.payload);
      messageText = String(msg?.button?.text ?? "");
    } else if (type === "image" || type === "audio" || type === "video" || type === "document") {
      mediaKind = type;
      const media = msg?.[type] ?? {};
      mediaUrl = String(media?.url ?? "");
      mediaMime = String(media?.mime_type ?? "");
      messageText = String(media?.caption ?? "");
    }

    return {
      provider,
      official: envelope.official === true,
      instanceId: entryId,
      messageId: String(msg?.id ?? ""),
      from,
      phone: provider === "whatsapp" ? normalizePhone(from) : "",
      fromMe: msg?.from_me === true,
      isGroup: !!msg?.group_id,
      messageText,
      buttonId,
      profileName: String(contact?.profile?.name ?? contact?.profile?.username ?? ""),
      mediaKind,
      mediaUrl,
      mediaMime,
      referralSourceId: String(msg?.referral?.source_id ?? ""),
      eventType: type,
    };
  } catch (e) {
    console.warn("[wame-api] parseWameMessage falhou:", (e as Error)?.message ?? e);
    return null;
  }
}
