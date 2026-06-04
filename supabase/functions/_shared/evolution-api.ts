/**
 * Evolution API Helper
 * Funções para enviar mensagens via Evolution API
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout, logStructured, TIMEOUT_WHAPI } from "./utils.ts";
import { captureError } from "./sentry.ts";
import {
  acquireOutboundSlot,
  type AcquireOutboundSlotInput,
  recordOutboundResult,
} from "./idempotency.ts";

export interface EvolutionButton {
  id: string;
  title: string;
}

/**
 * Detailed result of a send call. Distinguishes:
 *   - `ok`: Evolution HTTP returned 2xx (request accepted by Evolution)
 *   - `pending`: Evolution body carried status="PENDING" (Baileys hasn't
 *     confirmed delivery yet — WhatsApp may or may not deliver it)
 *   - `messageId`: external Evolution/WhatsApp message id when present
 *   - `error`: short error message when `ok === false`
 *
 * Callers MUST treat `ok && !pending` as the only "sent" state.
 * `ok && pending` is "queued" and needs ACK confirmation.
 */
export interface SendResult {
  ok: boolean;
  pending: boolean;
  messageId: string | null;
  status: number;
  error?: string;
}

/**
 * Optional idempotency context attached to a send. When all four fields are
 * present **and** a Supabase client is provided, `sendWithRetry` will:
 *   1. Acquire an outbound slot in `outbound_message_log` BEFORE sending —
 *      a duplicate (same `idempotencyKey`) short-circuits with `true` and
 *      no HTTP call to Evolution.
 *   2. Record the outcome (`sent` / `failed`) after the retry loop, so a
 *      future redelivery hitting the same key can replay the result.
 *
 * Omitting these fields keeps the legacy behavior verbatim — every call
 * site that pre-dates `whatsapp-flow-reliability-fix` continues to work
 * exactly as before. The flag-gated migration of call sites is tracked by
 * tasks 6, 9, 10 and downstream of design §3.2.
 */
export interface IdempotencyOptions {
  /** Result of `computeIdempotencyKey`. Empty string disables the path. */
  idempotencyKey?: string;
  /** Owner of the conversation (used to populate the audit row). */
  customerId?: string;
  /** Owner of the bot/instance (used to populate the audit row). */
  consultantId?: string;
  /** Stable hash of the actual payload for audit. */
  payloadHash?: string;
  /**
   * Supabase client with permissions on `outbound_message_log`. When
   * omitted, idempotency is silently skipped.
   */
  supabase?: SupabaseClient;
}

export interface EvolutionInstance {
  id: string;
  instance_name: string;
  api_url: string;
  api_key: string;
  phone_number?: string;
  status: string;
}

/**
 * Cria sender para Evolution API
 */
export function createEvolutionSender(apiUrl: string, apiKey: string, instanceName: string) {
  const baseUrl = apiUrl.replace(/\/$/, "");

  /**
   * Evolution API v2 (/message/sendText, /sendButtons, /sendMedia,
   * /sendWhatsAppAudio, /chat/sendPresence) espera `number` em dígitos puros.
   * Quando recebe JID completo (`5511…@s.whatsapp.net`) responde 2xx mas
   * Baileys silenciosamente NÃO entrega a mensagem. Normalize sempre aqui.
   */
  const toEvolutionNumber = (jid: string) =>
    String(jid || "").split("@")[0].replace(/\D/g, "");


  // Retry helper para envios — exponential backoff (300ms, 900ms, 2.7s).
  //
  // Optional `idempotencyOpts`:
  //   - When `idempotencyKey` + `supabase` are provided, the helper takes
  //     a slot in `outbound_message_log` BEFORE the first attempt. If the
  //     row already exists (redelivery / network retry / advisory-lock
  //     loss), it returns `true` immediately without sending again.
  //   - After the attempt loop, the outcome (`sent` / `failed`) is
  //     recorded so a future redelivery can replay it.
  //   - Any error inside the idempotency layer fails open — the send
  //     proceeds — to preserve §3.2's "never silence the customer" rule.
  //
  // When `idempotencyOpts` is absent, behavior is byte-for-byte identical
  // to the pre-bugfix implementation.

  async function sendWithRetry(
    label: string,
    doSend: () => Promise<Response>,
    idempotencyOpts?: IdempotencyOptions,
  ): Promise<SendResult> {
    // ── Idempotency pre-check ────────────────────────────────────────
    const idemKey = idempotencyOpts?.idempotencyKey;
    const idemSupabase = idempotencyOpts?.supabase;
    const idemEnabled = !!(
      idemKey && idemSupabase &&
      idempotencyOpts?.customerId &&
      idempotencyOpts?.consultantId &&
      idempotencyOpts?.payloadHash
    );
    if (idemEnabled) {
      try {
        const slot = await acquireOutboundSlot(
          idemSupabase!,
          {
            idempotencyKey: idemKey!,
            customerId: idempotencyOpts!.customerId!,
            consultantId: idempotencyOpts!.consultantId!,
            payloadHash: idempotencyOpts!.payloadHash!,
          } as AcquireOutboundSlotInput,
        );
        if (!slot.acquired) {
          // Replay previous outcome without re-sending.
          logStructured("info", "evolution_send_idempotent_replay", {
            instance: instanceName,
            kind: label,
            previous_status: slot.previousResultStatus ?? null,
            previous_message_id: slot.previousMessageId ?? null,
          });
          const replayOk = slot.previousResultStatus !== "failed";
          return {
            ok: replayOk,
            pending: false,
            messageId: slot.previousMessageId ?? null,
            status: 0,
            error: replayOk ? undefined : "idempotent_replay_previous_failure",
          };
        }
      } catch (e) {
        // Fail open — proceed with the actual send.
        console.warn(
          `[evolution-api] idempotency pre-check threw; sending anyway`,
          e,
        );
      }
    }

    let lastStatus = 0;
    let lastBody = "";
    let succeeded = false;
    let messageId: string | null = null;
    let pendingOnly = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await doSend();
        if (res.ok) {
          succeeded = true;
          lastStatus = res.status;
          // Tenta capturar `key.id` e `status` da resposta Evolution v2.
          try {
            const data = await res.clone().json();
            messageId = data?.key?.id ?? data?.messageId ?? data?.id ?? null;
            const rawStatus = String(data?.status ?? data?.messageStatus ?? "").toUpperCase();
            if (rawStatus === "PENDING") pendingOnly = true;
          } catch (_) { /* body não-json, ignora */ }
          break;
        }
        lastStatus = res.status;
        lastBody = (await res.text()).substring(0, 200);
        // 4xx (exceto 408/429) não vale retry
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          break;
        }
        // 5xx pós-200 com "Connection Closed" indica sessão derrubada — não
        // adianta retentar, marcamos `needs_reconnect` mais abaixo (3.27).
        if (lastStatus === 500 && /connection closed/i.test(lastBody)) {
          break;
        }
      } catch (error: any) {
        lastBody = error?.message || String(error);
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 300 * Math.pow(3, attempt - 1)));
      }
    }

    if (succeeded) {
      logStructured(pendingOnly ? "warn" : "info", pendingOnly ? "evolution_send_pending" : "evolution_send_ok", {
        instance: instanceName,
        kind: label,
        message_id: messageId,
        pending: pendingOnly,
      });
      // ── Idempotency post-record (success) ─────────────────────────
      // Diferenciamos: "sent" só quando a Evolution efetivamente confirmou
      // (não-PENDING). PENDING fica como "queued" para que um retry possa
      // ressubmeter caso o ACK nunca chegue. Isso evita que uma redelivery
      // do webhook NÃO reenvie uma mensagem que ficou presa na fila.
      if (idemEnabled) {
        try {
          await recordOutboundResult(
            idemSupabase!,
            idemKey!,
            pendingOnly ? "queued" : "sent",
            messageId,
          );
        } catch (_) { /* swallow */ }
      }
      return {
        ok: true,
        pending: pendingOnly,
        messageId,
        status: lastStatus,
      };
    }

    // Detecta sessão WhatsApp derrubada do lado do servidor Evolution.
    // Sintoma típico: HTTP 500 + body contendo "Connection Closed".
    const isConnectionClosed =
      lastStatus === 500 && /connection closed/i.test(lastBody);

    logStructured("error", `evolution_${label}_failed_final`, {
      instance: instanceName,
      status: lastStatus,
      error: lastBody,
      connection_closed: isConnectionClosed,
    });

    if (isConnectionClosed) {
      // Marca instância como needs_reconnect — super-admin recebe alerta visual.
      try {
        const sbUrl = Deno.env.get("SUPABASE_URL");
        const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (sbUrl && sbKey) {
          await fetch(`${sbUrl}/rest/v1/whatsapp_instances?instance_name=eq.${instanceName}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: sbKey,
              Authorization: `Bearer ${sbKey}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              status: "needs_reconnect",
              updated_at: new Date().toISOString(),
            }),
          });
        }
      } catch (_) { /* swallow */ }
    }

    captureError(new Error(`Evolution ${label} failed after 3 attempts: ${lastBody}`), {
      tags: {
        function: "evolution-api",
        instance: instanceName,
        kind: label,
        connection_closed: String(isConnectionClosed),
      },
      extra: { status: lastStatus },
    });

    // ── Idempotency post-record (failure) ──────────────────────────────
    if (idemEnabled) {
      try {
        await recordOutboundResult(idemSupabase!, idemKey!, "failed", null);
      } catch (_) { /* swallow */ }
    }
    return {
      ok: false,
      pending: false,
      messageId: null,
      status: lastStatus,
      error: lastBody || "send_failed",
    };
  }

  async function sendTextDetailed(
    remoteJid: string,
    text: string,
    idempotency?: IdempotencyOptions,
  ): Promise<SendResult> {
    const number = toEvolutionNumber(remoteJid);
    const preview = (text || "").substring(0, 60).replace(/\n/g, " ");
    console.log(`📤 [sendText] -> ${number} | "${preview}${text.length > 60 ? "..." : ""}"`);
    const result = await sendWithRetry("send_text", () =>
      fetchWithTimeout(`${baseUrl}/message/sendText/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": apiKey },
        body: JSON.stringify({ number, text }),
        timeout: TIMEOUT_WHAPI,
      }),
      idempotency,
    );
    console.log(`${result.ok ? (result.pending ? "🟡" : "✅") : "❌"} [sendText] ok=${result.ok} pending=${result.pending} id=${result.messageId ?? "-"}`);
    return result;
  }

  async function sendText(
    remoteJid: string,
    text: string,
    idempotency?: IdempotencyOptions,
  ): Promise<boolean> {
    const r = await sendTextDetailed(remoteJid, text, idempotency);
    return r.ok;
  }

  async function sendButtons(
    remoteJid: string,
    message: string,
    buttons: EvolutionButton[],
    idempotency?: IdempotencyOptions,
  ): Promise<boolean> {
    console.log(`📤 [sendButtons→text] -> ${toEvolutionNumber(remoteJid)} (${buttons.length} opções: ${buttons.map(b => b.id).join(",")})`);
    logStructured("info", "evolution_buttons_as_text", { instance: instanceName, count: buttons.length });
    const textWithOptions = `${message}\n\n${buttons.map((b, i) => `*${i + 1}.* ${b.title}`).join("\n")}\n\n_Digite o número da opção desejada._`;
    return sendText(remoteJid, textWithOptions, idempotency);
  }



  async function downloadMedia(key: any, message: any): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/chat/getBase64FromMediaMessage/${instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": apiKey,
        },
        body: JSON.stringify({
          message: {
            key,
            message,
          },
        }),
        timeout: 30_000,
      });

      if (!res.ok) {
        const errorText = await res.text();
        logStructured("error", "evolution_download_media_failed", {
          instance: instanceName,
          status: res.status,
          error: errorText.substring(0, 200),
        });
        return null;
      }

      const data = await res.json();
      return data.base64 || null;
    } catch (error: any) {
      logStructured("error", "evolution_download_media_exception", {
        instance: instanceName,
        error: error?.message,
      });
      return null;
    }
  }

  // Run a single-shot send (no retry loop) wrapped in the idempotency
  // dance. Mirrors `sendWithRetry`'s pre-check + post-record without
  // changing the legacy retry behavior of `sendMedia`/`sendAudio`.
  async function withIdempotency(
    label: string,
    idempotency: IdempotencyOptions | undefined,
    doIt: () => Promise<boolean>,
  ): Promise<boolean> {
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
        const slot = await acquireOutboundSlot(
          idemSupabase!,
          {
            idempotencyKey: idemKey!,
            customerId: idempotency!.customerId!,
            consultantId: idempotency!.consultantId!,
            payloadHash: idempotency!.payloadHash!,
          } as AcquireOutboundSlotInput,
        );
        if (!slot.acquired) {
          logStructured("info", "evolution_send_idempotent_replay", {
            instance: instanceName,
            kind: label,
            previous_status: slot.previousResultStatus ?? null,
            previous_message_id: slot.previousMessageId ?? null,
          });
          return slot.previousResultStatus !== "failed";
        }
      } catch (e) {
        console.warn(
          `[evolution-api] idempotency pre-check threw; sending anyway`,
          e,
        );
      }
    }
    let ok = false;
    try {
      ok = await doIt();
    } finally {
      if (idemEnabled) {
        try {
          await recordOutboundResult(
            idemSupabase!,
            idemKey!,
            ok ? "sent" : "failed",
            null,
          );
        } catch (_) { /* swallow */ }
      }
    }
    return ok;
  }

  async function sendMedia(
    remoteJid: string,
    mediaUrl: string,
    caption: string,
    mediatype: "video" | "image" | "document" | "audio" | "voice" = "video",
    _durationSec?: number,
    idempotency?: IdempotencyOptions,
  ): Promise<boolean> {
    // Áudio é tratado por endpoint dedicado para virar voice note (PTT) no WhatsApp.
    if (mediatype === "audio" || mediatype === "voice") {
      return sendAudio(remoteJid, mediaUrl, idempotency);
    }
    return withIdempotency("send_media", idempotency, async () => {
      // Evolution API espera apenas o número, sem sufixo JID
      const number = toEvolutionNumber(remoteJid);
      try {
        const res = await fetchWithTimeout(`${baseUrl}/message/sendMedia/${instanceName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": apiKey,
          },
          body: JSON.stringify({
            number,
            mediatype,
            mimetype: mediatype === "video" ? "video/mp4" : mediatype === "image" ? "image/jpeg" : "application/pdf",
            caption,
            media: mediaUrl,
            fileName: mediatype === "video" ? "video.mp4" : mediatype === "image" ? "image.jpg" : "document.pdf",
          }),
          timeout: 120_000,
        });

        if (!res.ok) {
          const errorText = await res.text();
          logStructured("error", "evolution_send_media_failed", {
            instance: instanceName,
            status: res.status,
            error: errorText.substring(0, 200),
          });
          return false;
        }

        return true;
      } catch (error: any) {
        logStructured("error", "evolution_send_media_exception", {
          instance: instanceName,
          error: error?.message,
        });
        return false;
      }
    });
  }

  async function sendAudio(
    remoteJid: string,
    audioUrl: string,
    idempotency?: IdempotencyOptions,
  ): Promise<boolean> {
    return withIdempotency("send_audio", idempotency, async () => {
      const number = toEvolutionNumber(remoteJid);
      try {
        const res = await fetchWithTimeout(`${baseUrl}/message/sendWhatsAppAudio/${instanceName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": apiKey },
          body: JSON.stringify({ number, audio: audioUrl, encoding: true }),
          timeout: 120_000,
        });
        if (!res.ok) {
          const errorText = await res.text();
          logStructured("error", "evolution_send_audio_failed", { instance: instanceName, status: res.status, error: errorText.substring(0, 200) });
          return false;
        }
        return true;
      } catch (error: any) {
        logStructured("error", "evolution_send_audio_exception", { instance: instanceName, error: error?.message });
        return false;
      }
    });
  }

  /**
   * Envia presença (composing/recording/paused) ao contato — simula "digitando…".
   * Não falha o fluxo se der erro: presença é cosmética.
   */
  async function sendPresence(
    remoteJid: string,
    presence: "composing" | "recording" | "paused" | "available" = "composing",
    delayMs = 1200,
  ): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/chat/sendPresence/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": apiKey },
        body: JSON.stringify({ number: toEvolutionNumber(remoteJid), presence, delay: delayMs }),
        timeout: 8000,
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  return { sendText, sendTextDetailed, sendButtons, downloadMedia, sendMedia, sendAudio, sendPresence };
}

/**
 * Extrai dados da mensagem Evolution API
 *
 * @param body Payload bruto da Evolution
 * @param instanceConnectedPhone (opcional) Telefone conectado da instância — se o remoteJid
 *        for o próprio número conectado, ignoramos a mensagem (auto-mensagem do consultor).
 */
export function parseEvolutionMessage(body: any, instanceConnectedPhone?: string | null) {
  const data = body.data || body;
  const key = data.key || {};
  const message = data.message || {};
  const messageTimestamp = data.messageTimestamp || key.timestamp;

  // Remote JID (número do remetente)
  const remoteJid = key.remoteJid || "";
  const fromMe = key.fromMe || false;

  // Ignorar mensagens enviadas por nós
  if (fromMe) {
    return null;
  }

  // Ignorar grupos, newsletters e canais
  if (
    remoteJid.includes("@g.us") ||
    remoteJid.includes("@newsletter") ||
    remoteJid.includes("@broadcast")
  ) {
    return null;
  }

  // ── BLINDAGEM ANTI-SELF-MESSAGE ──
  // Se o número remetente == número conectado da instância, é auto-mensagem
  // (consultor mandando do próprio celular). Ignoramos para não criar lead lixo.
  if (instanceConnectedPhone) {
    const remotePhone = remoteJid.replace(/@s\.whatsapp\.net$/, "").replace(/@c\.us$/, "").replace(/\D/g, "");
    const connected = String(instanceConnectedPhone).replace(/\D/g, "");
    if (remotePhone && connected && (remotePhone === connected || remotePhone.endsWith(connected) || connected.endsWith(remotePhone))) {
      logStructured("info", "evolution_self_message_ignored", { remoteJid, connected_phone: connected });
      return null;
    }
  }

  // Extrair texto
  let messageText = "";
  if (message.conversation) {
    messageText = message.conversation;
  } else if (message.extendedTextMessage?.text) {
    messageText = message.extendedTextMessage.text;
  }

  // Extrair resposta de botão
  let buttonId: string | null = null;
  if (message.buttonsResponseMessage?.selectedButtonId) {
    buttonId = message.buttonsResponseMessage.selectedButtonId;
  } else if (message.listResponseMessage?.singleSelectReply?.selectedRowId) {
    buttonId = message.listResponseMessage.singleSelectReply.selectedRowId;
  }

  // Extrair imagem
  const imageMessage = message.imageMessage;
  const hasImage = !!imageMessage;

  // Extrair documento
  const documentMessage = message.documentMessage;
  const hasDocument = !!documentMessage;

  // Extrair áudio
  const audioMessage = message.audioMessage;
  const hasAudio = !!audioMessage;

  // Extrair vídeo
  const videoMessage = message.videoMessage;
  const hasVideo = !!videoMessage;

  // Task 12 do whatsapp-flow-reliability-fix: incluir áudio em isFile e expor
  // mediaKind para o webhook decidir transcrição automática (Task 17). Não
  // mexemos em hasImage/hasDocument para preservar contratos antigos. O webhook
  // que precisar do comportamento legado pode usar `hasImage || hasDocument`.
  const isFile = hasImage || hasDocument || hasAudio;
  const isButton = !!buttonId;

  // mediaKind: kind canônico do anexo. Null quando inbound é texto puro.
  let mediaKind: "image" | "document" | "audio" | "video" | null = null;
  if (hasImage) mediaKind = "image";
  else if (hasDocument) mediaKind = "document";
  else if (hasAudio) mediaKind = "audio";
  else if (hasVideo) mediaKind = "video";

  return {
    remoteJid,
    messageText: messageText.trim(),
    buttonId,
    hasImage,
    hasDocument,
    hasAudio,
    hasVideo,
    isFile,
    isButton,
    mediaKind,
    imageMessage,
    documentMessage,
    audioMessage,
    videoMessage,
    key,
    message,
    messageTimestamp,
  };
}

/**
 * Extrai URL de mídia da mensagem (se disponível)
 */
export function extractMediaUrl(message: any): string | null {
  if (message.imageMessage?.url) {
    return message.imageMessage.url;
  }
  if (message.documentMessage?.url) {
    return message.documentMessage.url;
  }
  if (message.videoMessage?.url) {
    return message.videoMessage.url;
  }
  if (message.audioMessage?.url) {
    return message.audioMessage.url;
  }
  return null;
}
