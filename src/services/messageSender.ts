/**
 * Unified message sending pipeline.
 * Routes to the correct Evolution API function and returns typed results.
 */
import {
  sendTextMessage,
  sendMedia,
  sendAudio,
  sendDocument,
  sendSticker,
} from "@/services/evolutionApi";
import { whapiSendText, whapiSendMedia } from "@/services/whapiApi";
import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/lib/logger";

const logger = createLogger("messageSender");

export type SendStatus = "sent" | "pending" | "timeout" | "failed";

export interface SendResult {
  status: SendStatus;
  error?: string;
  messageId?: string;
}

export type MediaCategory = "text" | "image" | "video" | "audio" | "document" | "sticker";

export interface SendPayload {
  instanceName: string;
  phone: string;
  mediaCategory: MediaCategory;
  text?: string;
  mediaUrl?: string;
  fileName?: string;
  /** Quando true, envia via Whapi (super admin) em vez de Evolution */
  isWhapi?: boolean;
  /** Quando informado, grava outbound em `conversations` para o chat atualizar via realtime */
  customerId?: string | null;
  conversationStep?: string;
}

function isTimeoutResponse(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as Record<string, unknown>).timeout === true
  );
}

function isUnavailableResponse(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    ((result as Record<string, unknown>).unavailable === true ||
      (result as Record<string, unknown>).connectionClosed === true)
  );
}

// ── Rate limiting per contact ──────────────────────────────────────────
const lastSendTimestamp = new Map<string, number>();
const MIN_INTERVAL_PER_CONTACT_MS = 5000;

async function enforcePerContactRateLimit(phone: string): Promise<void> {
  const normalized = phone.replace(/\D/g, "");
  const last = lastSendTimestamp.get(normalized);
  if (last) {
    const elapsed = Date.now() - last;
    if (elapsed < MIN_INTERVAL_PER_CONTACT_MS) {
      const waitMs = MIN_INTERVAL_PER_CONTACT_MS - elapsed;
      logger.info(`Rate limit: aguardando ${waitMs}ms para ${normalized}`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  lastSendTimestamp.set(normalized, Date.now());
}

/** Grava outbound da plataforma — dispara realtime no chat aberto (useMessages). */
export async function logPlatformOutbound(params: {
  customerId?: string | null;
  text: string;
  messageType?: string;
  conversationStep?: string;
}): Promise<void> {
  if (!params.customerId || !params.text.trim()) return;
  try {
    // Rastreabilidade: quem clicou (sent_by) e a origem manual — este caminho
    // só é percorrido em envios iniciados pelo operador na plataforma.
    const { data: auth } = await supabase.auth.getUser();
    await supabase.from("conversations").insert({
      customer_id: params.customerId,
      message_direction: "outbound",
      message_text: params.text.slice(0, 2000),
      message_type: params.messageType || "text",
      conversation_step: params.conversationStep || "platform_send",
      origin: "manual",
      sent_by: auth?.user?.id ?? null,
    });
  } catch {
    // non-critical — o polling de 6s ainda cobre
  }
}

function buildOutboundLogText(
  mediaCategory: MediaCategory,
  text?: string,
  fileName?: string,
): string {
  if (mediaCategory === "text") return text || "";
  if (mediaCategory === "document") return fileName || "[documento]";
  if (mediaCategory === "sticker") return "[sticker]";
  return `[${mediaCategory}]${text ? `: ${text}` : ""}`;
}

function notifyChatOutbound(
  payload: Pick<SendPayload, "customerId" | "conversationStep">,
  mediaCategory: MediaCategory,
  text?: string,
  fileName?: string,
): void {
  const logText = buildOutboundLogText(mediaCategory, text, fileName);
  if (!logText.trim()) return;
  void logPlatformOutbound({
    customerId: payload.customerId,
    text: logText,
    messageType: mediaCategory,
    conversationStep: payload.conversationStep,
  });
}

/**
 * Send a single message through the correct Evolution API endpoint.
 * Returns a typed SendResult instead of throwing on timeout.
 */
export async function sendWhatsAppMessage(payload: SendPayload): Promise<SendResult> {
  const {
    instanceName,
    phone: rawPhone,
    mediaCategory,
    text,
    mediaUrl,
    fileName,
    isWhapi,
    customerId,
    conversationStep,
  } = payload;

  // Normaliza telefone BR (DDI 55) — mesmo critério do bot (manual-step-send).
  const phone = normalizeBrazilPhone(rawPhone) || rawPhone.replace(/\D/g, "");

  // Block invalid placeholder phones before hitting the API
  if (!phone || /sem_celular/i.test(phone) || phone.replace(/\D/g, "").length < 8) {
    logger.warn("Número inválido ignorado:", phone);
    return { status: "failed", error: `Número inválido: ${phone}` };
  }

  // Enforce per-contact rate limiting
  await enforcePerContactRateLimit(phone);

  try {
    let result: unknown;

    if (isWhapi) {
      switch (mediaCategory) {
        case "text":
          if (!text?.trim()) return { status: "failed", error: "Texto vazio" };
          await whapiSendText(phone, text);
          notifyChatOutbound(payload, mediaCategory, text);
          return { status: "sent" };
        case "audio":
          if (!mediaUrl) return { status: "failed", error: "URL de áudio ausente" };
          await whapiSendMedia(phone, mediaUrl, "audio");
          notifyChatOutbound(payload, mediaCategory);
          return { status: "sent" };
        case "document":
          if (!mediaUrl) return { status: "failed", error: "URL do documento ausente" };
          await whapiSendMedia(phone, mediaUrl, "document", undefined, fileName || "documento");
          notifyChatOutbound(payload, mediaCategory, text, fileName);
          return { status: "sent" };
        case "image":
        case "video":
          if (!mediaUrl) return { status: "failed", error: "URL da mídia ausente" };
          await whapiSendMedia(phone, mediaUrl, mediaCategory, text || undefined);
          notifyChatOutbound(payload, mediaCategory, text);
          return { status: "sent" };
        case "sticker":
          if (!mediaUrl) return { status: "failed", error: "URL do sticker ausente" };
          await whapiSendMedia(phone, mediaUrl, "sticker");
          notifyChatOutbound(payload, mediaCategory);
          return { status: "sent" };
        default:
          return { status: "failed", error: `Tipo desconhecido: ${mediaCategory}` };
      }
    }

    switch (mediaCategory) {
      case "text":
        if (!text?.trim()) return { status: "failed", error: "Texto vazio" };
        result = await sendTextMessage(instanceName, phone, text, true);
        break;

      case "audio":
        if (!mediaUrl) return { status: "failed", error: "URL de áudio ausente" };
        result = await sendAudio(instanceName, phone, mediaUrl, true);
        break;

      case "document":
        if (!mediaUrl) return { status: "failed", error: "URL do documento ausente" };
        result = await sendDocument(
          instanceName,
          phone,
          mediaUrl,
          fileName || "documento",
          true
        );
        break;

      case "image":
      case "video":
        if (!mediaUrl) return { status: "failed", error: "URL da mídia ausente" };
        result = await sendMedia(
          instanceName,
          phone,
          mediaUrl,
          text || "",
          mediaCategory,
          true
        );
        break;

      case "sticker":
        if (!mediaUrl) return { status: "failed", error: "URL do sticker ausente" };
        result = await sendSticker(instanceName, phone, mediaUrl, true);
        break;

      default:
        return { status: "failed", error: `Tipo desconhecido: ${mediaCategory}` };
    }

    if (isTimeoutResponse(result)) {
      logger.warn("Timeout ao enviar", { phone, mediaCategory });
      return { status: "timeout", error: "Timeout ao enviar mensagem" };
    }

    if (isUnavailableResponse(result)) {
      logger.warn("Serviço indisponível ao enviar", { phone, mediaCategory });
      return { status: "timeout", error: "Serviço temporariamente indisponível" };
    }

    // Detect Evolution PENDING status (message queued but not confirmed by WhatsApp).
    // Evolution returns 2xx with body { status: "PENDING", key: { id } } when the
    // message was accepted by the API but Baileys has not yet received server ACK.
    // We surface this distinctly so the UI can show "pendente" instead of "enviado".
    const resObj = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
    const rawStatus = String(resObj.status ?? resObj.messageStatus ?? "").toUpperCase();
    const messageId = (resObj.key as { id?: string } | undefined)?.id || (resObj as { messageId?: string }).messageId;

    if (rawStatus === "PENDING") {
      logger.warn("Envio em estado PENDING (não confirmado pelo WhatsApp ainda)", { phone, messageId });
      notifyChatOutbound(payload, mediaCategory, text, fileName);
      return { status: "pending", messageId, error: "Mensagem na fila — aguardando confirmação do WhatsApp." };
    }

    // Sem key.id é suspeito — provavelmente não chegou no servidor.
    if (!messageId && (rawStatus === "" || rawStatus === "ERROR")) {
      logger.warn("Resposta sem messageId — possivelmente não enviada", { phone, rawStatus });
      return { status: "failed", error: "Servidor não confirmou o envio." };
    }

    notifyChatOutbound(payload, mediaCategory, text, fileName);
    return { status: "sent", messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    logger.error("Falha no envio:", msg);
    return { status: "failed", error: msg };
  }
}

/**
 * Normaliza um `phone_whatsapp` do banco para o formato de envio aceito pela
 * Evolution/Whapi (só dígitos, com DDI 55). Espelha a validação usada pelo
 * caminho do bot (`manual-step-send` linhas 116-135) — fonte de verdade do
 * destinatário. Retorna null quando claramente inválido (placeholder
 * `sem_celular`, curto demais ou fora do padrão BR de 12-13 dígitos).
 */
export function normalizeBrazilPhone(raw: string | null | undefined): string | null {
  const original = String(raw || "");
  if (/sem_celular/i.test(original)) return null;
  let digits = original.replace(/\D/g, "");
  if (!digits || digits.length < 10) return null;
  // 10 (DDD + 8) ou 11 (DDD + 9) → prefixa o DDI 55.
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}

/**
 * Resolve the recipient from a JID for sending.
 * - @s.whatsapp.net → extract phone number
 * - @lid → send full JID (Evolution handles it)
 * - plain number → use as-is
 */
export function resolveRecipient(targetJid: string): string {
  if (targetJid.endsWith("@s.whatsapp.net")) {
    return targetJid.split("@")[0];
  }
  if (targetJid.endsWith("@lid")) {
    return targetJid; // Evolution API handles @lid JIDs
  }
  return targetJid;
}
