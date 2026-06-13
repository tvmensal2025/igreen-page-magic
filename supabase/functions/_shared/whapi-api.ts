/**
 * Whapi Cloud API Helper
 * Usado EXCLUSIVAMENTE pelo super admin (rafael.ids@icloud.com)
 * Suporta botões reais do WhatsApp (quick_reply)
 * 
 * NÃO interfere nas instâncias Evolution dos consultores.
 */

import { fetchWithTimeout, logStructured, TIMEOUT_WHAPI } from "./utils.ts";
import { captureError } from "./sentry.ts";
import { shouldUseFastClock } from "./test-mode.ts";
import { isFlowInstantMode } from "./flow-pace.ts";
import {
  acquireOutboundSlot,
  recordOutboundResult,
  type AcquireOutboundSlotInput,
} from "./idempotency.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface WhapiIdempotencyOptions {
  idempotencyKey?: string;
  customerId?: string;
  consultantId?: string;
  payloadHash?: string;
  supabase?: SupabaseClient;
}

export interface WhapiButton {
  id: string;
  title: string;
}

/**
 * Cria sender para Whapi Cloud API
 * Retorna a mesma interface do Evolution sender (sendText, sendButtons, sendMedia, downloadMedia)
 * para que o bot-flow.ts funcione sem alteração.
 */
export function createWhapiSender(apiToken: string, baseUrl = "https://gate.whapi.cloud") {
  const url = baseUrl.replace(/\/$/, "");

  async function withIdempotency(
    label: string,
    idempotency: WhapiIdempotencyOptions | undefined,
    doSend: () => Promise<boolean>,
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
          logStructured("info", "whapi_send_idempotent_replay", {
            kind: label,
            previous_status: slot.previousResultStatus ?? null,
          });
          return slot.previousResultStatus !== "failed";
        }
      } catch (e) {
        console.warn(`[whapi-api] idempotency pre-check threw; sending anyway`, e);
      }
    }
    let ok = false;
    try {
      ok = await doSend();
    } finally {
      if (idemEnabled) {
        try {
          await recordOutboundResult(idemSupabase!, idemKey!, ok ? "sent" : "failed", null);
        } catch (_) { /* swallow */ }
      }
    }
    return ok;
  }

  async function sendWithRetry(label: string, doSend: () => Promise<Response>, maxAttempts = 3): Promise<boolean> {
    let lastStatus = 0;
    let lastBody = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await doSend();
        if (res.ok) return true;
        lastStatus = res.status;
        lastBody = (await res.text()).substring(0, 200);
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break;
      } catch (error: any) {
        lastBody = error?.message || String(error);
      }
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 300 * Math.pow(3, attempt - 1)));
    }
    logStructured("error", `whapi_${label}_failed`, { status: lastStatus, error: lastBody });
    captureError(new Error(`Whapi ${label} failed: ${lastBody}`), {
      tags: { function: "whapi-api", kind: label },
    });
    return false;
  }

  const headers = {
    "Authorization": `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  // Calcula tempo de "digitando" (em segundos) baseado no tamanho do texto.
  // Whapi mantém o status até `typing_time` segundos antes de entregar a mensagem.
  // Limite seguro: 1s mínimo, 15s máximo.
  function typingTimeFor(text: string): number {
    if (shouldUseFastClock()) return 1; // simulador real → typing mínimo
    // Modo instantâneo: typing mínimo aceito pelo Whapi (1s).
    // Whapi não suporta typing_time=0, então 1s é o "instantâneo real".
    if (isFlowInstantMode()) return 1;
    const len = (text || "").length;
    const ms = 1500 + len * 35; // ~mesma curva do humanPace
    return Math.max(1, Math.min(15, Math.round(ms / 1000)));
  }

  async function sendPresence(
    remoteJid: string,
    presence: "typing" | "recording" | "paused" = "typing",
    delaySec = 3,
  ): Promise<boolean> {
    const to = remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`;
    return sendWithRetry("send_presence", () =>
      fetchWithTimeout(`${url}/presences/${encodeURIComponent(to)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ presence, delay: Math.max(1, Math.min(25, delaySec)) }),
        timeout: TIMEOUT_WHAPI,
      })
    );
  }

  async function sendText(
    remoteJid: string,
    text: string,
    opts?: { typingSec?: number; idempotency?: WhapiIdempotencyOptions },
  ): Promise<boolean> {
    return withIdempotency("send_text", opts?.idempotency, async () => {
      // Whapi usa chatId no formato "5511999990001@s.whatsapp.net"
      const to = remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`;
      const preview = (text || "").substring(0, 60).replace(/\n/g, " ");
      const typing = opts?.typingSec ?? typingTimeFor(text);
      console.log(`📤 [whapi:sendText] -> ${to} (typing ${typing}s) | "${preview}${text.length > 60 ? "..." : ""}"`);
      const ok = await sendWithRetry("send_text", () =>
        fetchWithTimeout(`${url}/messages/text`, {
          method: "POST",
          headers,
          body: JSON.stringify({ to, body: text, typing_time: typing }),
          timeout: TIMEOUT_WHAPI + typing * 1000,
        })
      );
      console.log(`${ok ? "✅" : "❌"} [whapi:sendText] resultado=${ok}`);
      return ok;
    });
  }

  async function sendButtons(
    remoteJid: string,
    message: string,
    buttons: WhapiButton[],
    idempotency?: WhapiIdempotencyOptions,
  ): Promise<boolean> {
    return withIdempotency("send_buttons", idempotency, async () => {
      const to = remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`;
      const safeButtons = buttons.slice(0, 3).map((b) => ({
        type: "quick_reply" as const,
        title: (b.title || "").substring(0, 25),
        id: b.id,
      }));

      console.log(`📤 [whapi:sendButtons] -> ${to} (${safeButtons.length} botões: ${safeButtons.map(b => b.id).join(",")})`);
      const ok = await sendWithRetry("send_buttons", () =>
        fetchWithTimeout(`${url}/messages/interactive`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            to,
            type: "button",
            body: { text: message },
            footer: { text: "iGreen Energy ☀️" },
            action: { buttons: safeButtons },
          }),
          timeout: TIMEOUT_WHAPI,
        })
      );

      if (ok) {
        console.log(`✅ [whapi:sendButtons] botões entregues`);
        return true;
      }

      // Fallback: texto numerado (sem re-acquire de idempotência)
      console.warn(`⚠️ [whapi:sendButtons] FALHOU -> caindo para texto numerado`);
      const textWithOptions = `${message}\n\n${buttons.map((b, i) => `*${i + 1}.* ${b.title}`).join("\n")}\n\n_Digite o número da opção desejada._`;
      return sendText(remoteJid, textWithOptions);
    });
  }

  async function sendMedia(
    remoteJid: string,
    mediaUrl: string,
    caption: string,
    mediatype: "video" | "image" | "document" | "audio" | "voice" = "video",
    durationSec?: number,
  ): Promise<boolean> {
    const to = remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`;
    const isAudio = mediatype === "audio" || mediatype === "voice";
    // Type widened para `string` para permitir comparação dinâmica com
    // "messages/audio" (alternativa de endpoint para áudio WebM/Opus que
    // o Whapi rejeita em messages/voice). Antes era literal union, o que
    // gerava TS2367 nas comparações `endpoint !== "messages/audio"`.
    const endpoint: string = mediatype === "video" ? "messages/video"
      : mediatype === "image" ? "messages/image"
      : isAudio ? "messages/voice"
      : "messages/document";
    const urlPreview = String(mediaUrl || "").slice(-60);

    const cleanPath = (() => {
      try { return new URL(mediaUrl).pathname; } catch (_) { return mediaUrl.split("?")[0] || "media"; }
    })();
    const fileName = decodeURIComponent(cleanPath.split("/").pop() || (isAudio ? "audio.webm" : "media"));
    const contentType = isAudio ? "audio/webm"
      : mediatype === "video" ? "video/mp4"
      : mediatype === "image" ? "image/jpeg"
      : "application/octet-stream";

    // Baixa a mídia uma única vez e devolve {bytes, mime}; usado para Base64 e multipart.
    let cachedDownload: { bytes: Uint8Array; mime: string } | null = null;
    const downloadMediaBytes = async (): Promise<{ bytes: Uint8Array; mime: string } | null> => {
      if (cachedDownload) return cachedDownload;
      try {
        const mediaRes = await fetchWithTimeout(mediaUrl, { method: "GET", timeout: 30_000 });
        if (!mediaRes.ok) {
          console.warn(`⚠️ [whapi:sendMedia] download da mídia falhou (${mediaRes.status})`);
          return null;
        }
        const bytes = new Uint8Array(await mediaRes.arrayBuffer());
        const mime = mediaRes.headers.get("content-type") || contentType;
        console.log(`📥 [whapi:sendMedia] mídia baixada (${bytes.byteLength} bytes, ${mime})`);
        cachedDownload = { bytes, mime };
        return cachedDownload;
      } catch (e: any) {
        console.warn(`⚠️ [whapi:sendMedia] download falhou: ${e?.message || e}`);
        return null;
      }
    };

    // base64 sem estouro de stack (chunks)
    const bytesToBase64 = (bytes: Uint8Array): string => {
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return btoa(bin);
    };

    // Vídeo/imagem grandes não são idempotentes: timeout do cliente NÃO significa
    // que o Whapi não entregou. Para evitar enviar 2x, tratamos timeout como
    // "provavelmente entregue" (otimista) e usamos só 1 tentativa por chamada.
    // Áudio/documento (pequenos) mantêm o retry tradicional.
    const isHeavy = mediatype === "video" || mediatype === "image";
    const perAttemptTimeout = isHeavy ? 120_000 : 60_000;
    const maxAttempts = isHeavy ? 1 : 3;

    const tryJsonSend = async (
      label: string,
      path: string,
      jsonBody: Record<string, unknown>,
    ): Promise<boolean | "timeout_optimistic"> => {
      let last = "";
      let timedOut = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetchWithTimeout(`${url}/${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(jsonBody),
            timeout: perAttemptTimeout,
          });
          if (res.ok) return true;
          last = `${res.status} ${(await res.text()).substring(0, 180)}`;
          if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break;
        } catch (e: any) {
          last = e?.message || String(e);
          if (/timed out|timeout|aborted/i.test(last)) timedOut = true;
        }
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 300 * Math.pow(3, attempt - 1)));
      }
      // Para vídeo/imagem grandes: se foi timeout, assumimos que o Whapi entregou
      // e evitamos o fallback que duplicaria a mensagem no WhatsApp do lead.
      if (isHeavy && timedOut) {
        logStructured("warn", "whapi_send_media_timeout_optimistic", {
          path, label, mediatype, last_error: last,
        });
        console.warn(`⏳ [whapi:sendMedia] ${label} timeout em ${mediatype} — assumindo entregue (sem retry para não duplicar)`);
        return "timeout_optimistic";
      }
      logStructured("warn", "whapi_send_media_attempt_failed", {
        path, label, mediatype, last_error: last,
      });
      console.warn(`⚠️ [whapi:sendMedia] ${label} falhou (${mediatype} via ${path}). Último erro: ${last}`);
      return false;
    };

    const sendJsonBase64 = async (
      path: string,
      dataUriMime: string,
      label: string,
    ): Promise<boolean> => {
      const dl = await downloadMediaBytes();
      if (!dl) return false;
      const b64 = bytesToBase64(dl.bytes);
      const dataUri = `data:${dataUriMime};base64,${b64}`;
      console.log(`📤 [whapi:sendMedia] ${label} -> ${to} (${mediatype} via ${path}, ${dl.bytes.byteLength} bytes, declarado=${dataUriMime})`);
      const body: Record<string, unknown> = isAudio
        ? { to, media: dataUri }
        : { to, media: dataUri, caption };
      const r = await tryJsonSend(label, path, body);
      return r === true || r === "timeout_optimistic";
    };

    const sendMultipart = async (path: string): Promise<boolean> => {
      const dl = await downloadMediaBytes();
      if (!dl) return false;
      try {
        // Cast para Uint8Array com ArrayBuffer concreto. Tipos novos do TS
        // distinguem `ArrayBufferLike` (que pode ser `SharedArrayBuffer`) de
        // `ArrayBuffer`, e `Blob` exige o segundo.
        const bytes = dl.bytes as unknown as Uint8Array<ArrayBuffer>;
        const blob = new Blob([bytes], { type: dl.mime });
        const form = new FormData();
        form.append("to", to);
        form.append("media", blob, fileName);
        if (caption && !isAudio) form.append("caption", caption);
        console.log(`📤 [whapi:sendMedia] multipart -> ${to} (${mediatype} via ${path}, ${blob.size} bytes, ${blob.type})`);
        return await sendWithRetry("send_media_multipart", () =>
          fetchWithTimeout(`${url}/${path}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiToken}` },
            body: form,
            timeout: 90_000,
          }),
        );
      } catch (e: any) {
        console.warn(`⚠️ [whapi:sendMedia] multipart falhou: ${e?.message || e}`);
        return false;
      }
    };

    // Presence realista antes do upload:
    // - Áudio: "gravando" pelo tempo real do arquivo (+1s buffer), entre 4s e 25s.
    // - Imagem/Vídeo: "digitando" 4-6s aleatório (humano).
    // Aguardamos o presence subir + pequena pausa para o status aparecer ANTES da mídia.
    const presenceSec = isAudio
      ? Math.max(4, Math.min(25, Math.round((durationSec && durationSec > 0 ? durationSec : 6)) + 1))
      : (4 + Math.floor(Math.random() * 3)); // 4-6s
    try {
      await sendPresence(remoteJid, isAudio ? "recording" : "typing", presenceSec);
    } catch (_) { /* segue mesmo se presence falhar */ }
    await new Promise((r) => setTimeout(r, 700 + Math.floor(Math.random() * 400))); // 0.7-1.1s

    console.log(`📤 [whapi:sendMedia] -> ${to} (${mediatype} via ${endpoint}, presence=${presenceSec}s) url=…${urlPreview}`);

    // 1ª tentativa: JSON com URL (rápido quando funciona)
    const initialBody: Record<string, unknown> = isAudio
      ? { to, media: mediaUrl }
      : { to, media: mediaUrl, caption };
    const firstAttempt = await tryJsonSend("json_url", endpoint, initialBody);
    if (firstAttempt === true) {
      console.log(`✅ [whapi:sendMedia] ok via json_url (${mediatype} ${endpoint})`);
      return true;
    }
    if (firstAttempt === "timeout_optimistic") {
      // Não tentar fallback: o Whapi provavelmente entregou e um 2º envio duplicaria.
      console.log(`✅ [whapi:sendMedia] assumido entregue após timeout (${mediatype} ${endpoint})`);
      return true;
    }

    // 2ª: JSON Base64 declarando o mime real
    const realMime = isAudio ? "audio/webm" : contentType;
    if (await sendJsonBase64(endpoint, realMime, "json_base64_real")) {
      console.log(`✅ [whapi:sendMedia] ok via json_base64_real (${mediatype} ${endpoint})`);
      return true;
    }

    // 3ª: Para áudio WebM/Opus → tentar alias OGG/Opus (mesmo codec, container aceito pelo WhatsApp)
    if (isAudio) {
      if (await sendJsonBase64(endpoint, "audio/ogg; codecs=opus", "json_base64_ogg_alias")) {
        console.log(`✅ [whapi:sendMedia] ok via json_base64_ogg_alias (${mediatype} ${endpoint})`);
        return true;
      }
      if (endpoint !== "messages/audio" && await sendJsonBase64("messages/audio", "audio/ogg; codecs=opus", "json_base64_ogg_audio_endpoint")) {
        console.log(`✅ [whapi:sendMedia] ok via json_base64_ogg_alias (messages/audio)`);
        return true;
      }
    }

    // 4ª: multipart como último recurso
    if (await sendMultipart(endpoint)) {
      console.log(`✅ [whapi:sendMedia] ok via multipart (${mediatype} ${endpoint})`);
      return true;
    }
    if (isAudio && endpoint !== "messages/audio" && await sendMultipart("messages/audio")) {
      console.log(`✅ [whapi:sendMedia] ok via multipart messages/audio`);
      return true;
    }

    console.log(`❌ [whapi:sendMedia] resultado=false (${mediatype} via ${endpoint})`);
    return false;
  }

  async function downloadMedia(_key: any, _message: any): Promise<string | null> {
    // Whapi entrega base64 diretamente no webhook payload (campo media.link ou media.data)
    // Não precisa de chamada extra como Evolution
    console.log(`ℹ️ [whapi:downloadMedia] Whapi entrega mídia no webhook — não precisa download separado`);
    return null;
  }

  return { sendText, sendButtons, downloadMedia, sendMedia, sendPresence };
}

/**
 * Parseia mensagem recebida do webhook Whapi
 * Retorna o mesmo formato que parseEvolutionMessage para compatibilidade com bot-flow.ts
 */
export function parseWhapiMessage(body: any) {
  const messages = body.messages || [];
  if (messages.length === 0) return null;

  const msg = messages[0];

  // Ignorar grupos
  const chatId = msg.chat_id || "";
  if (chatId.includes("@g.us") || chatId.includes("@newsletter") || chatId.includes("@broadcast")) return null;

  // Mensagem enviada por nós: se foi via API (bot/painel), ignorar.
  // Se foi digitada no app/web/desktop do WhatsApp pelo consultor, sinalizar
  // takeover humano para o webhook pausar o bot.
  if (msg.from_me) {
    const source = String(msg.source || "").toLowerCase();
    if (source === "api" || source === "") {
      // API ou desconhecido (assumir API para não pausar erroneamente)
      return null;
    }
    return {
      outboundHuman: true,
      chatId,
      source,
      messageId: msg.id || "",
    } as any;
  }

  const remoteJid = chatId || `${msg.from}@s.whatsapp.net`;

  // Texto
  let messageText = "";
  if (msg.type === "text" || msg.type === "conversation") {
    messageText = msg.text?.body || msg.body || msg.conversation || "";
  }

  // Resposta de botão (quick_reply)
  let buttonId: string | null = null;
  if (msg.type === "reply" && msg.reply?.type === "buttons_reply") {
    buttonId = msg.reply.buttons_reply.id?.replace(/^ButtonsV3:/, "") || null;
    messageText = msg.reply.buttons_reply.title || "";
  }
  // Resposta de lista
  if (msg.type === "reply" && msg.reply?.type === "list_reply") {
    buttonId = msg.reply.list_reply.id?.replace(/^ListV3:/, "") || null;
    messageText = msg.reply.list_reply.title || "";
  }

  // Imagem
  const hasImage = msg.type === "image";
  const imageMessage = hasImage ? { mimetype: msg.image?.mime_type || "image/jpeg", url: msg.image?.link } : null;

  // Documento
  const hasDocument = msg.type === "document";
  const documentMessage = hasDocument ? { mimetype: msg.document?.mime_type || "application/pdf", url: msg.document?.link } : null;

  // Áudio / Voice note (PTT)
  const hasAudio = msg.type === "voice" || msg.type === "audio" || !!msg.voice || !!msg.audio;
  const audioPayload = msg.voice || msg.audio || null;
  const audioMessage = hasAudio
    ? { mimetype: audioPayload?.mime_type || "audio/ogg", url: audioPayload?.link, ptt: msg.type === "voice" }
    : null;

  const isFile = hasImage || hasDocument || hasAudio;
  const isButton = !!buttonId;

  // Extrair base64 se disponível (Whapi pode enviar inline)
  let fileBase64: string | null = null;
  let fileUrl: string | null = null;
  if (hasImage && msg.image) {
    fileBase64 = msg.image.data || null;
    fileUrl = msg.image.link || null;
  }
  if (hasDocument && msg.document) {
    fileBase64 = msg.document.data || null;
    fileUrl = msg.document.link || null;
  }
  if (hasAudio && audioPayload) {
    fileBase64 = audioPayload.data || null;
    fileUrl = audioPayload.link || null;
  }

  // Nome do remetente vindo do WhatsApp (pushName)
  const fromName: string | null = msg.from_name || msg.pushname || msg.notify_name || null;

  return {
    remoteJid,
    fromName,
    messageText: messageText.trim(),
    buttonId,
    hasImage,
    hasDocument,
    hasAudio,
    hasVideo: false,
    isFile,
    isButton,
    imageMessage,
    documentMessage,
    audioMessage,
    videoMessage: null,
    key: { remoteJid, fromMe: false, id: msg.id || "" },
    message: msg,
    messageTimestamp: msg.timestamp,
    messageId: msg.id || "",
    fileBase64,
    fileUrl,
  };
}
