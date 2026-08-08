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
import { awaitWhapiSendSlot } from "./whapi-throttle.ts";
import {
  acquireOutboundSlot,
  recordOutboundResult,
  type AcquireOutboundSlotInput,
} from "./idempotency.ts";
import { resolveWhatsAppChatId } from "./resolve-whatsapp-chat-id.ts";
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

  /**
   * Antes de qualquer POST /messages/*: resolve wa_id real (BR 9º dígito).
   * invalid_whatsapp → não envia (evita pending eterno + falso "sent").
   */
  async function resolveDestination(
    remoteJid: string,
    idempotency?: WhapiIdempotencyOptions,
  ): Promise<string | null> {
    const resolved = await resolveWhatsAppChatId({
      phoneOrJid: remoteJid,
      apiToken,
      baseUrl: url,
      supabase: idempotency?.supabase,
      customerId: idempotency?.customerId,
    });
    if (!resolved.ok) {
      logStructured("error", "whapi_dest_unresolved", {
        reason: resolved.reason,
        detail: resolved.detail,
        customer_id: idempotency?.customerId,
      });
      return null;
    }
    return resolved.chatId;
  }

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
          if (slot.previousResultStatus === "failed") {
            logStructured("warn", "whapi_send_retry_after_failed", {
              kind: label,
              idempotency_key: idemKey,
            });
          } else {
            return true;
          }
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

  async function sendWithRetry(
    label: string,
    doSend: () => Promise<Response>,
    maxAttempts = 3,
  ): Promise<{ ok: boolean; messageId: string | null }> {
    let lastStatus = 0;
    let lastBody = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await doSend();
        if (res.ok) {
          let messageId: string | null = null;
          try {
            const data = await res.clone().json();
            messageId =
              data?.message?.id ??
              data?.id ??
              data?.messages?.[0]?.id ??
              null;
            if (messageId != null) messageId = String(messageId);
          } catch (_) { /* body não-json */ }
          return { ok: true, messageId };
        }
        lastStatus = res.status;
        lastBody = (await res.text()).substring(0, 200);
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break;
      } catch (error: any) {
        lastBody = error?.message || String(error);
      }
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 300 * Math.pow(3, attempt - 1)));
    }
    console.warn(`[whapi-api] ${label} failed status=${lastStatus} body=${lastBody}`);
    logStructured("error", `whapi_${label}_failed`, { status: lastStatus, error: lastBody });
    captureError(new Error(`Whapi ${label} failed: ${lastBody}`), {
      tags: { function: "whapi-api", kind: label },
    });
    return { ok: false, messageId: null };
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
    presence: "typing" | "recording" | "paused" | "composing" = "typing",
    delaySec = 3,
  ): Promise<boolean> {
    const to = remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`;
    const whapiPresence = presence === "composing" ? "typing" : presence;
    const r = await sendWithRetry("send_presence", () =>
      fetchWithTimeout(`${url}/presences/${encodeURIComponent(to)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ presence: whapiPresence, delay: Math.max(1, Math.min(25, delaySec)) }),
        timeout: TIMEOUT_WHAPI,
      })
    );
    return r.ok;
  }

  async function sendText(
    remoteJid: string,
    text: string,
    opts?: { typingSec?: number; idempotency?: WhapiIdempotencyOptions },
  ): Promise<boolean> {
    const r = await sendTextDetailed(remoteJid, text, opts);
    return r.ok;
  }

  async function sendTextDetailed(
    remoteJid: string,
    text: string,
    opts?: { typingSec?: number; idempotency?: WhapiIdempotencyOptions },
  ): Promise<{ ok: boolean; messageId: string | null }> {
    let messageId: string | null = null;
    const ok = await withIdempotency("send_text", opts?.idempotency, async () => {
      const to = await resolveDestination(remoteJid, opts?.idempotency);
      if (!to) return false;
      await awaitWhapiSendSlot(to, { kind: "send_text", supabase: opts?.idempotency?.supabase });
      const preview = (text || "").substring(0, 60).replace(/\n/g, " ");
      const typing = opts?.typingSec ?? typingTimeFor(text);
      console.log(`📤 [whapi:sendText] -> ${to} (typing ${typing}s) | "${preview}${text.length > 60 ? "..." : ""}"`);
      const r = await sendWithRetry("send_text", () =>
        fetchWithTimeout(`${url}/messages/text`, {
          method: "POST",
          headers,
          body: JSON.stringify({ to, body: text, typing_time: typing }),
          timeout: TIMEOUT_WHAPI + typing * 1000,
        })
      );
      messageId = r.messageId;
      console.log(`${r.ok ? "✅" : "❌"} [whapi:sendText] resultado=${r.ok} id=${r.messageId ?? "-"}`);
      return r.ok;
    });
    return { ok, messageId };
  }

  async function sendButtons(
    remoteJid: string,
    message: string,
    buttons: WhapiButton[],
    idempotency?: WhapiIdempotencyOptions,
  ): Promise<boolean> {
    const r = await sendButtonsDetailed(remoteJid, message, buttons, idempotency);
    return r.ok;
  }

  /**
   * Igual a `sendButtons`, mas devolve o id da mensagem. Sem ele o webhook de
   * status não casa o ACK e o motor de cadência trata a entrega como não
   * verificável (ver `cadence-ack-policy.ts`).
   */
  async function sendButtonsDetailed(
    remoteJid: string,
    message: string,
    buttons: WhapiButton[],
    idempotency?: WhapiIdempotencyOptions,
  ): Promise<{ ok: boolean; messageId: string | null }> {
    let messageId: string | null = null;
    const ok = await withIdempotency("send_buttons", idempotency, async () => {
      const to = await resolveDestination(remoteJid, idempotency);
      if (!to) return false;
      await awaitWhapiSendSlot(to, { kind: "send_buttons", supabase: idempotency?.supabase });
      const safeButtons = buttons.slice(0, 3).map((b) => ({
        type: "quick_reply" as const,
        title: (b.title || "").substring(0, 25),
        id: b.id,
      }));

      console.log(`📤 [whapi:sendButtons] -> ${to} (${safeButtons.length} botões: ${safeButtons.map(b => b.id).join(",")})`);
      const r = await sendWithRetry("send_buttons", () =>
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

      if (r.ok) {
        messageId = r.messageId;
        console.log(`✅ [whapi:sendButtons] botões entregues id=${r.messageId ?? "-"}`);
        return true;
      }

      console.warn(`⚠️ [whapi:sendButtons] FALHOU -> caindo para texto numerado`);
      const textWithOptions = `${message}\n\n${buttons.map((b, i) => `*${i + 1}.* ${b.title}`).join("\n")}\n\n_Digite o número da opção desejada._`;
      const fb = await sendTextDetailed(to, textWithOptions);
      messageId = fb.messageId;
      return fb.ok;
    });
    return { ok, messageId };
  }

  async function sendMedia(
    remoteJid: string,
    mediaUrl: string,
    caption: string,
    mediatype: "video" | "image" | "document" | "audio" | "voice" = "video",
    durationSec?: number,
    idempotency?: WhapiIdempotencyOptions,
  ): Promise<boolean> {
    const to = await resolveDestination(remoteJid, idempotency);
    if (!to) return false;
    const isAudio = mediatype === "audio" || mediatype === "voice";
    const urlPreview = String(mediaUrl || "").slice(-60);

    const cleanPath = (() => {
      try { return new URL(mediaUrl).pathname; } catch (_) { return mediaUrl.split("?")[0] || "media"; }
    })();
    const fileName = decodeURIComponent(cleanPath.split("/").pop() || (isAudio ? "audio.webm" : "media"));
    const lowerName = fileName.toLowerCase();

    // Sofia lote = MP3. Antes tudo ia como audio/webm → Whapi/WA aceitava 200
    // mas o áudio não tocava no celular. Detectar mime real pela extensão.
    const detectAudioMime = (): string => {
      if (/\.mp3($|\?)/i.test(lowerName) || /\.mp3($|\?)/i.test(mediaUrl)) return "audio/mpeg";
      if (/\.m4a($|\?)/i.test(lowerName) || /\.m4a($|\?)/i.test(mediaUrl)) return "audio/mp4";
      if (/\.ogg($|\?)/i.test(lowerName) || /\.ogg($|\?)/i.test(mediaUrl)) return "audio/ogg; codecs=opus";
      if (/\.opus($|\?)/i.test(lowerName)) return "audio/ogg; codecs=opus";
      if (/\.webm($|\?)/i.test(lowerName) || /\.webm($|\?)/i.test(mediaUrl)) return "audio/webm";
      return "audio/webm"; // legado gravador browser
    };
    const audioMime = isAudio ? detectAudioMime() : "";
    const isMp3Family = audioMime === "audio/mpeg" || audioMime === "audio/mp4";

    // Type widened para `string` para permitir comparação dinâmica com
    // "messages/audio" (alternativa de endpoint para áudio WebM/Opus que
    // o Whapi rejeita em messages/voice). Antes era literal union, o que
    // gerava TS2367 nas comparações `endpoint !== "messages/audio"`.
    // MP3 Sofia: messages/voice ainda funciona se o Whapi converter, mas
    // json_url sozinho costuma "ok" sem entregar — preferimos upload bytes.
    const endpoint: string = mediatype === "video" ? "messages/video"
      : mediatype === "image" ? "messages/image"
      : isAudio ? "messages/voice"
      : "messages/document";
    const contentType = isAudio ? audioMime
      : mediatype === "video" ? "video/mp4"
      : mediatype === "image" ? "image/jpeg"
      : "application/octet-stream";

    // Baixa a mídia uma única vez e devolve {bytes, mime}; usado para Base64 e multipart.
    let cachedDownload: { bytes: Uint8Array; mime: string } | null = null;
    const downloadMediaBytes = async (): Promise<{ bytes: Uint8Array; mime: string } | null> => {
      if (cachedDownload) return cachedDownload;
      try {
        const mediaRes = await fetchWithTimeout(mediaUrl, { method: "GET", timeout: isAudio ? 90_000 : 30_000 });
        if (!mediaRes.ok) {
          console.warn(`⚠️ [whapi:sendMedia] download da mídia falhou (${mediaRes.status})`);
          return null;
        }
        const bytes = new Uint8Array(await mediaRes.arrayBuffer());
        const headerMime = (mediaRes.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        // Preferir mime da extensão (MP3) sobre header genérico; não forçar webm em mpeg.
        let mime = contentType;
        if (headerMime.startsWith("audio/") && !isMp3Family) {
          mime = mediaRes.headers.get("content-type") || contentType;
        } else if (headerMime === "audio/mpeg" || headerMime === "audio/mp3") {
          mime = "audio/mpeg";
        } else if (isAudio) {
          mime = audioMime || contentType;
        }
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
    ): Promise<boolean> => {
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
      // Timeout em mídia pesada: NÃO assumir entregue (falso sent).
      // Caller pode retry; risco de duplicata é menor que marcar sent mentiroso.
      if (isHeavy && timedOut) {
        logStructured("warn", "whapi_send_media_timeout_failed", {
          path, label, mediatype, last_error: last,
        });
        console.warn(`⏳ [whapi:sendMedia] ${label} timeout em ${mediatype} — tratando como falha`);
        return false;
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
      return r === true;
    };

    const sendMultipart = async (path: string): Promise<boolean> => {
      const dl = await downloadMediaBytes();
      if (!dl) return false;
      try {
        const bytes = dl.bytes as unknown as Uint8Array<ArrayBuffer>;
        const blob = new Blob([bytes], { type: dl.mime });
        const form = new FormData();
        form.append("to", to);
        form.append("media", blob, fileName);
        if (caption && !isAudio) form.append("caption", caption);
        console.log(`📤 [whapi:sendMedia] multipart -> ${to} (${mediatype} via ${path}, ${blob.size} bytes, ${blob.type})`);
        const r = await sendWithRetry("send_media_multipart", () =>
          fetchWithTimeout(`${url}/${path}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiToken}` },
            body: form,
            timeout: 90_000,
          }),
        );
        return r.ok;
      } catch (e: any) {
        console.warn(`⚠️ [whapi:sendMedia] multipart falhou: ${e?.message || e}`);
        return false;
      }
    };

    // Anti-ban: fila espaçadora ANTES da presence/upload (slot cobre a mensagem toda).
    await awaitWhapiSendSlot(to, { kind: `send_media_${mediatype}` });

    // Presence “gravando…” / “digitando…” — intencional: o lead vê status humano
    // antes da mídia chegar. Não encurtar para áudio cacheado Sofia.
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

    console.log(
      `📤 [whapi:sendMedia] -> ${to} (${mediatype} via ${endpoint}, mime=${contentType}, mp3=${isMp3Family}, presence=${presenceSec}s) url=…${urlPreview}`,
    );

    // MP3 Sofia: json_url em messages/voice costuma retornar 200 sem o áudio
    // tocar no celular. Preferir upload (base64/multipart) com mime real para
    // o conversor do Whapi processar o arquivo de verdade.
    const tryJsonUrl = async (path: string): Promise<boolean> => {
      if (isAudio) {
        return await tryJsonSend("json_url", path, { to, media: mediaUrl, mime_type: contentType });
      }
      return await tryJsonSend("json_url", path, { to, media: mediaUrl, caption });
    };

    if (!isMp3Family) {
      const firstAttempt = await tryJsonUrl(endpoint);
      if (firstAttempt === true) {
        console.log(`✅ [whapi:sendMedia] ok via json_url (${mediatype} ${endpoint})`);
        return true;
      }
    } else {
      console.log(`ℹ️ [whapi:sendMedia] MP3 detectado — pulando json_url; upload com mime ${contentType}`);
    }

    // JSON Base64 com mime real (MP3 → audio/mpeg; webm → audio/webm)
    // MP3 longo (pós-venda ~1–2MB): messages/voice (PTT) falha mais —
    // tenta messages/audio primeiro quando o arquivo é grande.
    let preferAudioEndpoint = false;
    if (isMp3Family) {
      const dl = await downloadMediaBytes();
      preferAudioEndpoint = !!dl && dl.bytes.byteLength > 900_000;
    }
    if (preferAudioEndpoint) {
      if (await sendJsonBase64("messages/audio", "audio/mpeg", "json_base64_mp3_audio_first")) {
        console.log(`✅ [whapi:sendMedia] ok via json_base64_mp3_audio_first (messages/audio, large)`);
        return true;
      }
      if (await sendMultipart("messages/audio")) {
        console.log(`✅ [whapi:sendMedia] ok via multipart messages/audio (large first)`);
        return true;
      }
    }
    if (await sendJsonBase64(endpoint, contentType, "json_base64_real")) {
      console.log(`✅ [whapi:sendMedia] ok via json_base64_real (${mediatype} ${endpoint} ${contentType})`);
      return true;
    }

    // MP3: messages/audio com audio/mpeg (player de áudio no WA — ouve mesmo sem PTT)
    if (isMp3Family) {
      if (await sendJsonBase64("messages/audio", "audio/mpeg", "json_base64_mp3_audio_endpoint")) {
        console.log(`✅ [whapi:sendMedia] ok via json_base64_mp3 (messages/audio)`);
        return true;
      }
      if (await sendMultipart(endpoint)) {
        console.log(`✅ [whapi:sendMedia] ok via multipart voice (${contentType})`);
        return true;
      }
      if (await sendMultipart("messages/audio")) {
        console.log(`✅ [whapi:sendMedia] ok via multipart messages/audio`);
        return true;
      }
      // Último recurso: json_url (pode falhar no celular, mas tenta)
      const lateUrl = await tryJsonUrl(endpoint);
      if (lateUrl === true) {
        console.log(`✅ [whapi:sendMedia] ok via json_url tardio (mp3)`);
        return true;
      }
      console.log(`❌ [whapi:sendMedia] resultado=false (mp3 via ${endpoint})`);
      return false;
    }

    // WebM/Opus legado → alias OGG/Opus
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

  return {
    sendText,
    sendTextDetailed,
    sendButtons,
    sendButtonsDetailed,
    downloadMedia,
    sendMedia,
    sendPresence,
  };
}

/**
 * Parseia mensagem recebida do webhook Whapi
 * Retorna o mesmo formato que parseEvolutionMessage para compatibilidade com bot-flow.ts
 */
export function parseWhapiMessage(body: any) {
  const messages = body.messages || [];
  if (messages.length === 0) {
    console.log("[parseWhapiMessage] null reason=empty_messages");
    return null;
  }

  const msg = messages[0];

  // Ignorar grupos / status / broadcast
  const chatId = msg.chat_id || "";
  if (chatId.includes("@g.us") || chatId.includes("@newsletter") || chatId.includes("@broadcast") || chatId.includes("status@")) {
    console.log(`[parseWhapiMessage] null reason=non_user_chat chatId=${chatId} type=${msg.type}`);
    return null;
  }

  // Mensagem enviada por nós: se foi via API (bot/painel), ignorar.
  // Se foi digitada no app/web/desktop do WhatsApp pelo consultor, sinalizar
  // takeover humano. ALLOWLIST estrita para evitar pause-fantasma quando o
  // Whapi devolve o eco da própria mensagem do bot com source diferente de "api".
  if (msg.from_me) {
    const source = String(msg.source || "").toLowerCase();
    const HUMAN_SOURCES = new Set(["app", "iphone", "android", "web", "desktop", "mobile"]);
    if (source === "api" || source === "") {
      console.log(`[parseWhapiMessage] null reason=from_me_api source=${source}`);
      return null;
    }
    if (!HUMAN_SOURCES.has(source)) {
      console.log(`[parseWhapiMessage] null reason=from_me_unknown_source source=${source}`);
      return null;
    }
    // Texto/tipo para gravar em `conversations` (o feed da Captação só lê essa tabela).
    let humanText = "";
    let humanType = "text";
    const t = String(msg.type || "").toLowerCase();
    if (t === "text" || t === "conversation") {
      humanText = msg.text?.body || msg.body || msg.conversation || "";
    } else if (t === "image") {
      humanType = "image";
      humanText = msg.image?.caption || msg.image?.caption_text || "[imagem]";
    } else if (t === "document") {
      humanType = "document";
      humanText = msg.document?.file_name || msg.document?.filename || "[documento]";
    } else if (t === "voice" || t === "audio") {
      humanType = "audio";
      humanText = "[áudio]";
    } else if (t === "video") {
      humanType = "video";
      humanText = msg.video?.caption || msg.video?.caption_text || "[vídeo]";
    } else if (t === "sticker") {
      humanType = "sticker";
      humanText = "[sticker]";
    } else {
      humanText = msg.text?.body || msg.body || (t ? `[${t}]` : "");
    }
    return {
      outboundHuman: true,
      chatId,
      source,
      messageId: msg.id || "",
      messageText: String(humanText || "").trim(),
      messageType: humanType,
      messageTimestamp: msg.timestamp,
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

  const pickMediaId = (...candidates: unknown[]): string | null => {
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    return null;
  };

  // Imagem
  const hasImage = msg.type === "image";
  const imageMediaId = hasImage
    ? pickMediaId(msg.image?.id, msg.image?.file_id, msg.image?.media_id)
    : null;
  const imageMessage = hasImage
    ? {
      mimetype: msg.image?.mime_type || "image/jpeg",
      url: msg.image?.link,
      mediaId: imageMediaId,
      caption: msg.image?.caption || msg.image?.caption_text || "",
    }
    : null;

  // Documento
  const hasDocument = msg.type === "document";
  const documentMediaId = hasDocument
    ? pickMediaId(msg.document?.id, msg.document?.file_id, msg.document?.media_id)
    : null;
  const documentMessage = hasDocument
    ? {
      mimetype: msg.document?.mime_type || "application/pdf",
      url: msg.document?.link,
      mediaId: documentMediaId,
      fileName: msg.document?.file_name || msg.document?.filename || undefined,
    }
    : null;

  // Áudio / Voice note (PTT)
  const hasAudio = msg.type === "voice" || msg.type === "audio" || !!msg.voice || !!msg.audio;
  const audioPayload = msg.voice || msg.audio || null;
  const audioMediaId = hasAudio
    ? pickMediaId(audioPayload?.id, audioPayload?.file_id, audioPayload?.media_id)
    : null;
  const audioMessage = hasAudio
    ? {
      mimetype: audioPayload?.mime_type || "audio/ogg",
      url: audioPayload?.link,
      mediaId: audioMediaId,
      ptt: msg.type === "voice",
    }
    : null;

  // Vídeo
  const hasVideo = msg.type === "video" || !!msg.video;
  const videoPayload = msg.video || null;
  const videoMediaId = hasVideo
    ? pickMediaId(videoPayload?.id, videoPayload?.file_id, videoPayload?.media_id)
    : null;
  const videoMessage = hasVideo
    ? {
      mimetype: videoPayload?.mime_type || "video/mp4",
      url: videoPayload?.link,
      mediaId: videoMediaId,
      caption: videoPayload?.caption || videoPayload?.caption_text || "",
    }
    : null;

  const mediaId = imageMediaId || documentMediaId || audioMediaId || videoMediaId || null;
  const isFile = hasImage || hasDocument || hasAudio || hasVideo;
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
  if (hasVideo && videoPayload) {
    fileBase64 = videoPayload.data || null;
    fileUrl = videoPayload.link || null;
  }

  // Caption de mídia vira texto legível no log quando não há body.
  if (!messageText && hasImage && imageMessage?.caption) messageText = String(imageMessage.caption);
  if (!messageText && hasVideo && videoMessage?.caption) messageText = String(videoMessage.caption);

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
    hasVideo,
    isFile,
    isButton,
    imageMessage,
    documentMessage,
    audioMessage,
    videoMessage,
    mediaId,
    key: { remoteJid, fromMe: false, id: msg.id || "" },
    message: msg,
    messageTimestamp: msg.timestamp,
    messageId: msg.id || "",
    fileBase64,
    fileUrl,
  };
}

/** Metadados para gravar inbound em `conversations` com tipo/mídia corretos. */
export function resolveInboundConversationMeta(p: {
  hasAudio?: boolean;
  hasImage?: boolean;
  hasDocument?: boolean;
  hasVideo?: boolean;
  isFile?: boolean;
  messageText?: string | null;
  mediaId?: string | null;
}): { message_type: string; message_text: string; media_id: string | null } {
  const message_type = p.hasVideo
    ? "video"
    : p.hasAudio
    ? "audio"
    : p.hasDocument
    ? "document"
    : p.hasImage
    ? "image"
    : p.isFile
    ? "image"
    : "text";
  const placeholders: Record<string, string> = {
    video: "[vídeo]",
    audio: "[áudio]",
    document: "[documento]",
    image: "[imagem]",
  };
  const trimmed = String(p.messageText || "").trim();
  const message_text = message_type === "text"
    ? trimmed
    : (trimmed || placeholders[message_type] || "[arquivo]");
  return {
    message_type,
    message_text,
    media_id: p.mediaId || null,
  };
}
