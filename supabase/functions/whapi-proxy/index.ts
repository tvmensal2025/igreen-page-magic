/**
 * Whapi Proxy — encaminha chamadas REST do front para gate.whapi.cloud
 * Restrito ao super admin (consultant_id = settings.superadmin_consultant_id).
 *
 * Body: { action: "list_chats" | "list_messages" | "send_text" | "send_media" | "send_audio" | "get_profile_pic", payload: any }
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WHAPI_BASE = "https://gate.whapi.cloud";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function whapiFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${WHAPI_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function whapiFetchMultipart(token: string, path: string, form: FormData) {
  const res = await fetch(`${WHAPI_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// Retry com backoff exponencial para erros transitórios (500/502/503/504, network).
// Usado em send_media para mitigar instabilidades do gate Whapi (Fase 7).
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
async function whapiFetchWithRetry(
  token: string,
  path: string,
  init: RequestInit = {},
  opts: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {},
) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 600;
  const label = opts.label ?? path;
  let lastResult: { ok: boolean; status: number; data: any } | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await whapiFetch(token, path, init);
      lastResult = r;
      if (r.ok) {
        if (attempt > 1) {
          console.info(`[whapi-proxy] ✅ ${label} ok após ${attempt} tentativas`);
        }
        return r;
      }
      if (!RETRYABLE_STATUS.has(r.status) || attempt === maxAttempts) {
        return r;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
      console.warn(
        `[whapi-proxy] ⚠️ ${label} status=${r.status} tentativa ${attempt}/${maxAttempts} — retry em ${delay}ms`,
      );
      await new Promise((res) => setTimeout(res, delay));
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
      console.warn(
        `[whapi-proxy] ⚠️ ${label} network err tentativa ${attempt}/${maxAttempts} — retry em ${delay}ms:`,
        (err as any)?.message || err,
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  if (lastResult) return lastResult;
  return { ok: false, status: 599, data: { error: (lastError as any)?.message || "network error" } };
}

// ── Mappers Whapi → formato Evolution (para reaproveitar UI) ──
function mapChat(c: any) {
  const lm = c.last_message || c.lastMessage || null;
  const lmType = lm?.type;
  const lmText =
    lm?.text?.body ||
    lm?.caption ||
    lm?.image?.caption ||
    lm?.video?.caption ||
    lm?.document?.file_name ||
    "";
  return {
    id: c.id,
    remoteJid: c.id,
    name: c.name || c.first_name || undefined,
    pushName: c.name || c.pushname || undefined,
    profilePicUrl: c.profile_pic_full || c.profile_pic || c.icon_full || c.icon || undefined,
    unreadCount: c.unread_count ?? c.unread ?? 0,
    lastMsgTimestamp: lm?.timestamp || c.timestamp || 0,
    lastMessage: lm
      ? {
          key: { fromMe: !!lm.from_me, remoteJid: c.id, id: lm.id || "" },
          pushName: lm.from_name || undefined,
          messageTimestamp: lm.timestamp,
          message: {
            ...(lmType === "text" || !lmType ? { conversation: lmText } : {}),
            ...(lmType === "image" ? { imageMessage: { caption: lmText } } : {}),
            ...(lmType === "video" ? { videoMessage: { caption: lmText } } : {}),
            ...(lmType === "audio" || lmType === "voice" ? { audioMessage: {} } : {}),
            ...(lmType === "document" ? { documentMessage: { fileName: lm.document?.file_name } } : {}),
          },
        }
      : undefined,
  };
}

function mapMessage(m: any, chatId: string) {
  const t = m.type;
  const message: any = {};
  if (t === "text" || !t) message.conversation = m.text?.body || "";
  if (t === "image") message.imageMessage = {
    url: m.image?.link, caption: m.image?.caption || m.caption,
    mimetype: m.image?.mime_type || "image/jpeg",
  };
  if (t === "video") message.videoMessage = {
    url: m.video?.link, caption: m.video?.caption || m.caption,
    mimetype: m.video?.mime_type || "video/mp4",
  };
  if (t === "audio" || t === "voice") message.audioMessage = {
    url: (m.audio || m.voice)?.link,
    mimetype: (m.audio || m.voice)?.mime_type || "audio/ogg; codecs=opus",
    ptt: t === "voice",
  };
  if (t === "document") message.documentMessage = {
    url: m.document?.link, fileName: m.document?.file_name,
    mimetype: m.document?.mime_type || "application/pdf",
  };
  if (t === "sticker") message.stickerMessage = {
    url: m.sticker?.link, mimetype: m.sticker?.mime_type || "image/webp",
  };
  return {
    key: {
      id: m.id,
      remoteJid: m.chat_id || chatId,
      fromMe: !!m.from_me,
    },
    pushName: m.from_name,
    messageTimestamp: m.timestamp || 0,
    status: m.status === "read" ? 4 : m.status === "delivered" ? 3 : m.status === "sent" ? 2 : 1,
    message,
  };
}

function normalizeChatId(raw: string): string {
  if (!raw) return raw;
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json(401, { error: "Unauthorized" });
    const userId = claims.claims.sub as string;

    // Service role para ler settings sem RLS
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: settingsRows } = await admin
      .from("settings")
      .select("key, value")
      .in("key", ["superadmin_consultant_id", "whapi_token"]);
    const settings: Record<string, string> = {};
    settingsRows?.forEach((r: any) => { settings[r.key] = r.value; });

    if (settings.superadmin_consultant_id !== userId) {
      return json(403, { error: "Acesso restrito ao super admin" });
    }
    const whapiToken = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
    if (!whapiToken) return json(500, { error: "WHAPI_TOKEN não configurado" });

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;
    const payload = body?.payload || {};

    switch (action) {
      case "list_chats": {
        const count = Math.min(Number(payload.count) || 100, 200);
        const r = await whapiFetch(whapiToken, `/chats?count=${count}`, { method: "GET" });
        if (!r.ok) {
          const msg = JSON.stringify(r.data || "");
          if (r.status === 404 || /channel not found|unauthorized|invalid token/i.test(msg)) {
            console.warn("[whapi-proxy] list_chats: canal indisponível, retornando []");
            return json(200, []);
          }
          return json(r.status, { error: r.data });
        }
        const list = (r.data?.chats || []).map(mapChat);
        return json(200, list);
      }

      case "list_messages": {
        const chatId = normalizeChatId(String(payload.chatId || ""));
        const count = Math.min(Number(payload.count) || 50, 200);
        if (!chatId) return json(400, { error: "chatId obrigatório" });
        const r = await whapiFetch(
          whapiToken,
          `/messages/list/${encodeURIComponent(chatId)}?count=${count}`,
          { method: "GET" },
        );
        if (!r.ok) {
          const msg = JSON.stringify(r.data || "");
          if (r.status === 404 || /channel not found|unauthorized|invalid token/i.test(msg)) {
            console.warn("[whapi-proxy] list_messages: canal indisponível, retornando []");
            return json(200, []);
          }
          return json(r.status, { error: r.data });
        }
        const list = (r.data?.messages || []).map((m: any) => mapMessage(m, chatId));
        return json(200, list);
      }

      case "send_text": {
        const to = normalizeChatId(String(payload.to || ""));
        const text = String(payload.text || "");
        if (!to || !text) return json(400, { error: "to e text obrigatórios" });
        const r = await whapiFetch(whapiToken, `/messages/text`, {
          method: "POST",
          body: JSON.stringify({ to, body: text }),
        });
        if (!r.ok) return json(r.status, { error: r.data });
        return json(200, { key: { id: r.data?.message?.id || r.data?.id || "" } });
      }

      case "send_media": {
        const to = normalizeChatId(String(payload.to || ""));
        const mediaUrl = String(payload.mediaUrl || "");
        const caption = payload.caption ? String(payload.caption) : undefined;
        const fileName = payload.fileName ? String(payload.fileName) : undefined;
        const mediatype = String(payload.mediatype || "image");
        if (!to || !mediaUrl) return json(400, { error: "to e mediaUrl obrigatórios" });

        const path =
          mediatype === "video" ? "/messages/video"
          : mediatype === "document" ? "/messages/document"
          : mediatype === "audio" ? "/messages/voice"
          : "/messages/image";
        const isAudio = mediatype === "audio";

        const baseBody: Record<string, unknown> = { to, media: mediaUrl };
        if (caption) baseBody.caption = caption;
        if (fileName) baseBody.file_name = fileName;

        // 1) JSON com URL
        let r = await whapiFetchWithRetry(whapiToken, path, {
          method: "POST",
          body: JSON.stringify(baseBody),
        }, { maxAttempts: 3, baseDelayMs: 800, label: `send_media:${mediatype}:json_url` });

        let cached: { bytes: Uint8Array; mime: string; b64: string } | null = null;
        const ensureDownload = async () => {
          if (cached) return cached;
          try {
            const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(30_000) });
            if (!res.ok) return null;
            const bytes = new Uint8Array(await res.arrayBuffer());
            const mime = res.headers.get("content-type") || (isAudio ? "audio/webm" : "application/octet-stream");
            let bin = "";
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
            cached = { bytes, mime, b64: btoa(bin) };
            return cached;
          } catch { return null; }
        };

        const sendBase64 = async (p: string, mimeAlias: string) => {
          const dl = await ensureDownload();
          if (!dl) return null;
          const body: Record<string, unknown> = { to, media: `data:${mimeAlias};base64,${dl.b64}` };
          if (caption) body.caption = caption;
          if (fileName) body.file_name = fileName;
          return await whapiFetch(whapiToken, p, { method: "POST", body: JSON.stringify(body) });
        };

        if (!r.ok) {
          const realMime = (await ensureDownload())?.mime || (isAudio ? "audio/webm" : "application/octet-stream");
          const r2 = await sendBase64(path, realMime);
          if (r2?.ok) r = r2;
        }
        if (!r.ok && isAudio) {
          const r3 = await sendBase64(path, "audio/ogg; codecs=opus");
          if (r3?.ok) r = r3;
        }
        if (!r.ok && isAudio && path !== "/messages/audio") {
          const r4 = await sendBase64("/messages/audio", "audio/ogg; codecs=opus");
          if (r4?.ok) r = r4;
        }

        // Último recurso: multipart limpo
        if (!r.ok) {
          const dl = await ensureDownload();
          if (dl) {
            const safeName = fileName || (isAudio ? "audio.webm" : "media");
            const blob = new Blob([dl.bytes], { type: dl.mime });
            const form = new FormData();
            form.append("to", to);
            form.append("media", blob, safeName);
            if (caption && !isAudio) form.append("caption", caption);
            const rm = await whapiFetchMultipart(whapiToken, path, form);
            if (rm.ok) r = rm;
            else if (isAudio && path !== "/messages/audio") {
              const rm2 = await whapiFetchMultipart(whapiToken, "/messages/audio", form);
              r = rm2.ok ? rm2 : rm;
            } else r = rm;
          }
        }

        if (!r.ok) return json(r.status, { error: r.data });
        return json(200, { key: { id: r.data?.message?.id || r.data?.id || "" } });
      }

      case "get_profile_pic": {
        const chatId = normalizeChatId(String(payload.chatId || ""));
        if (!chatId) return json(400, { error: "chatId obrigatório" });
        const phone = chatId.split("@")[0];
        const r = await whapiFetch(whapiToken, `/contacts/${phone}/profile`, { method: "GET" });
        if (!r.ok) return json(200, { url: null });
        return json(200, { url: r.data?.profile_pic_full || r.data?.icon_full || r.data?.profile_pic || null });
      }

      case "download_media": {
        // Proxy de download de mídia (contorna CORS do CDN do Whapi)
        // necessário para re-uploadar a mídia como template.
        const url = String(payload.url || "");
        if (!url) return json(400, { error: "url obrigatória" });
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(45_000) });
          if (!r.ok) return json(502, { error: `download falhou (${r.status})` });
          const buf = new Uint8Array(await r.arrayBuffer());
          let bin = "";
          const chunk = 0x8000;
          for (let i = 0; i < buf.length; i += chunk) {
            bin += String.fromCharCode(...buf.subarray(i, i + chunk));
          }
          const b64 = btoa(bin);
          const mime = r.headers.get("content-type") || "application/octet-stream";
          return json(200, { base64: b64, mimetype: mime });
        } catch (e: any) {
          return json(502, { error: e?.message || "download error" });
        }
      }

      default:
        return json(400, { error: `Ação desconhecida: ${action}` });
    }
  } catch (err: any) {
    const msg =
      err?.message ||
      (typeof err === "string" ? err : null) ||
      (() => { try { return JSON.stringify(err); } catch { return null; } })() ||
      "Erro interno desconhecido";
    console.error("[whapi-proxy] erro:", msg, err);
    // Retorna 200 com fallback p/ não derrubar a UI (blank screen)
    return json(200, { error: msg, fallback: true });
  }
});
