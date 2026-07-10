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
const WHAPI_BILLING_URL = "https://panel.whapi.cloud/billing";
const WHAPI_PANEL_URL = "https://panel.whapi.cloud";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export type WhapiReasonCode =
  | "unpaid"
  | "channel_not_found"
  | "invalid_token"
  | "channel_error"
  | "offline"
  | "rate_limited"
  | "unknown";

/**
 * Classifica a resposta de erro da Whapi para que o front mostre
 * a mensagem certa (especialmente "bloqueado por falta de pagamento",
 * que hoje aparece como 404 genérico).
 */
function classifyWhapiError(status: number, data: any): {
  reasonCode: WhapiReasonCode;
  httpStatus: number;
  error: string;
  helpUrl: string | null;
} {
  const blob = (() => {
    try { return JSON.stringify(data || "").toLowerCase(); } catch { return ""; }
  })();

  // Pagamento/suspensão — Whapi pode devolver 402, 403, ou 404 com mensagem específica.
  if (
    status === 402 ||
    /unpaid|payment required|payment_required|billing|suspend|suspended|blocked|expired|trial.*(ended|over)|no.*active.*subscription/i.test(blob)
  ) {
    return {
      reasonCode: "unpaid",
      httpStatus: 402,
      error: "Canal Whapi bloqueado por falta de pagamento. Acesse panel.whapi.cloud → Billing para regularizar.",
      helpUrl: WHAPI_BILLING_URL,
    };
  }

  if (status === 404 || /channel not found|channel_not_found|no channel/i.test(blob)) {
    return {
      reasonCode: "channel_not_found",
      httpStatus: 404,
      error: "Canal Whapi não existe mais (foi removido no painel). Crie um canal novo e atualize o token.",
      helpUrl: WHAPI_PANEL_URL,
    };
  }

  const hasInvalidTokenSignal = /invalid[\s_-]*token|token.*invalid|api[\s_-]*key.*invalid|bearer.*invalid/i.test(blob);
  const hasChannelAuthSignal =
    /need.*channel.*authorization|channel.*authorization|channel.*not.*authorized|not.*authorized.*channel|authorize.*channel|login|logout|qr|session|device/i.test(blob);

  if (status === 401 || /unauthorized|invalid token|invalid_token|forbidden/i.test(blob)) {
    // Whapi usa 401 para dois cenários diferentes:
    // 1) token realmente inválido;
    // 2) token aceito, mas o canal WhatsApp não está autorizado para ENVIAR
    //    (mensagem oficial: "Need channel authorization for send message").
    // Não rotulamos o segundo caso como invalid_token para não orientar o usuário
    // a trocar token quando a ação correta é reconectar o canal.
    if (hasChannelAuthSignal && !hasInvalidTokenSignal) {
      return {
        reasonCode: "channel_error",
        httpStatus: 503,
        error:
          "Canal Whapi sem autorização para envio. No painel Whapi, faça Logout/Login do canal e escaneie o QR novamente.",
        helpUrl: WHAPI_PANEL_URL,
      };
    }

    return {
      reasonCode: "invalid_token",
      httpStatus: 401,
      error: "Token Whapi inválido. Cole o token novo do painel da Whapi.",
      helpUrl: WHAPI_PANEL_URL,
    };
  }

  if (status === 429 || /rate.?limit|too many/i.test(blob)) {
    return {
      reasonCode: "rate_limited",
      httpStatus: 429,
      error: "Whapi limitou as requisições. Tente novamente em alguns segundos.",
      helpUrl: null,
    };
  }

  return {
    reasonCode: "offline",
    httpStatus: 503,
    error: "Canal WhatsApp (Whapi) offline. Verifique conexão / QR no painel de reconexão.",
    helpUrl: null,
  };
}

async function classifyWhapiSendError(token: string, status: number, data: any): Promise<{
  reasonCode: WhapiReasonCode;
  httpStatus: number;
  error: string;
  helpUrl: string | null;
}> {
  const cls = classifyWhapiError(status, data);
  if (status !== 401 || cls.reasonCode !== "invalid_token") return cls;

  // Prova de token válido: se endpoints de leitura respondem, o problema não é
  // o token; é autorização/sessão do canal especificamente para envio.
  try {
    const [profile, chats] = await Promise.all([
      whapiFetch(token, "/users/profile", { method: "GET" }).catch(() => null),
      whapiFetch(token, "/chats?count=1", { method: "GET" }).catch(() => null),
    ]);
    if (profile?.ok || chats?.ok) {
      return {
        reasonCode: "channel_error",
        httpStatus: 503,
        error:
          "Token Whapi aceito, mas o canal não está autorizado para enviar mensagens. Faça Logout/Login do canal na Whapi e escaneie o QR novamente.",
        helpUrl: WHAPI_PANEL_URL,
      };
    }
  } catch (_) { /* mantém classificação original */ }

  return cls;
}

function isWhapiErrorBlob(status: number, data: any): boolean {
  if (status >= 400) return true;
  const blob = (() => { try { return JSON.stringify(data || "").toLowerCase(); } catch { return ""; } })();
  return /channel not found|unauthorized|invalid token|unpaid|suspend|blocked/i.test(blob);
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
      .in("key", ["superadmin_consultant_id", "whapi_token", "whapi_connected_phone"]);
    const settings: Record<string, string> = {};
    settingsRows?.forEach((r: any) => { settings[r.key] = r.value; });

    let isAuthorized = settings.superadmin_consultant_id === userId;
    if (!isAuthorized) {
      // Fallback seguro: confirma o papel pela função is_super_admin
      // (SECURITY DEFINER), evitando bloqueios quando settings está fora do ar
      // ou foi corrompida.
      try {
        const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: userId });
        if (isSuper === true) isAuthorized = true;
      } catch (_) { /* ignora */ }
    }
    if (!isAuthorized) {
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
        // Whapi aceita count 1–500; offset para histórico antigo ao rolar pra cima.
        const count = Math.min(Math.max(Number(payload.count) || 50, 1), 500);
        const offset = Math.max(Number(payload.offset) || 0, 0);
        if (!chatId) return json(400, { error: "chatId obrigatório" });
        const qs = new URLSearchParams({
          count: String(count),
          offset: String(offset),
          sort: "desc",
        });
        const r = await whapiFetch(
          whapiToken,
          `/messages/list/${encodeURIComponent(chatId)}?${qs.toString()}`,
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
        if (!r.ok) {
          if (isWhapiErrorBlob(r.status, r.data)) {
            const cls = await classifyWhapiSendError(whapiToken, r.status, r.data);
            console.warn(`[whapi-proxy] send_text bloqueado (${cls.reasonCode})`);
            return json(cls.httpStatus, { error: cls.error, reasonCode: cls.reasonCode, helpUrl: cls.helpUrl });
          }
          return json(r.status, { error: r.data });
        }
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

        if (!r.ok) {
          if (isWhapiErrorBlob(r.status, r.data)) {
            const cls = await classifyWhapiSendError(whapiToken, r.status, r.data);
            console.warn(`[whapi-proxy] send_media(${mediatype}) bloqueado (${cls.reasonCode})`);
            return json(cls.httpStatus, { error: cls.error, reasonCode: cls.reasonCode, helpUrl: cls.helpUrl });
          }
          return json(r.status, { error: r.data });
        }
        return json(200, { key: { id: r.data?.message?.id || r.data?.id || "" } });
      }

      case "health_check": {
        // Prova de vida REAL: /health é informativo, mas /users/profile diz se o canal opera.
        // Além disso, buscamos as últimas mensagens outbound para detectar
        // "device físico offline" — cenário em que a Whapi autentica (token OK),
        // mas o celular perdeu conexão com o WhatsApp e as msgs ficam em `pending`.
        const [r, profileResp, settingsResp, messagesResp] = await Promise.all([
          whapiFetch(whapiToken, `/health`, { method: "GET" }),
          whapiFetch(whapiToken, `/users/profile`, { method: "GET" })
            .catch(() => ({ ok: false, status: 0, data: null })),
          whapiFetch(whapiToken, `/settings`, { method: "GET" })
            .catch(() => ({ ok: false, status: 0, data: null })),
          whapiFetch(whapiToken, `/messages/list?count=30&sort=desc`, { method: "GET" })
            .catch(() => ({ ok: false, status: 0, data: null })),
        ]);

        const statusCodeNum: number | null =
          typeof r.data?.status?.code === "number" ? r.data.status.code : null;
        const statusText: string =
          String(r.data?.status?.text || r.data?.status || "UNKNOWN").toUpperCase();
        const phone = r.data?.user?.id || (profileResp as any)?.data?.id || null;
        const channelId = r.data?.channel_id || r.data?.channel?.id || null;

        const expectedWebhookUrl = `${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/whapi-webhook`;
        const webhooks: any[] = (settingsResp as any)?.data?.webhooks || [];
        const webhookOk = webhooks.some(
          (w: any) => String(w?.url || "").includes("/functions/v1/whapi-webhook"),
        );

        if (phone) {
          try {
            await admin.from("settings").upsert(
              { key: "whapi_connected_phone", value: `+${String(phone)}` },
              { onConflict: "key" },
            );
          } catch (_) { /* ignora */ }
        }

        // ── Device presence: analisa msgs outbound recentes ──
        // Se houver >=3 msgs enviadas nos últimos 10min TODAS em "pending"
        // (sem sent/delivered/read), o celular provavelmente está offline.
        let outboundRecentCount = 0;
        let outboundPendingCount = 0;
        let outboundDeliveredCount = 0;
        let lastOutboundAt: number | null = null;
        let lastOutboundStatus: string | null = null;
        let deviceLikelyOffline = false;
        try {
          const msgs: any[] = Array.isArray((messagesResp as any)?.data?.messages)
            ? (messagesResp as any).data.messages
            : Array.isArray((messagesResp as any)?.data)
            ? (messagesResp as any).data
            : [];
          const nowSec = Math.floor(Date.now() / 1000);
          const windowSec = 10 * 60; // 10 minutos
          for (const m of msgs) {
            if (!m?.from_me) continue;
            const ts = Number(m?.timestamp || 0);
            if (!ts) continue;
            if (lastOutboundAt === null || ts > lastOutboundAt) {
              lastOutboundAt = ts;
              lastOutboundStatus = String(m?.status || "").toLowerCase() || null;
            }
            if (nowSec - ts > windowSec) continue;
            outboundRecentCount++;
            const s = String(m?.status || "").toLowerCase();
            if (s === "pending" || s === "" || s === "queued") {
              outboundPendingCount++;
            } else if (s === "sent" || s === "delivered" || s === "read") {
              outboundDeliveredCount++;
            }
          }
          // Regra: >=3 msgs em 10min e >=80% ainda em pending = celular offline
          if (
            outboundRecentCount >= 3 &&
            outboundPendingCount / outboundRecentCount >= 0.8 &&
            outboundDeliveredCount === 0
          ) {
            deviceLikelyOffline = true;
          }
        } catch (e) {
          console.warn("[whapi-proxy] device presence probe falhou:", (e as any)?.message);
        }

        // Fonte da verdade: /users/profile. Se responder 200, canal está saudável
        // (Whapi devolve /health code=5 ERROR mesmo com o canal operando).
        const profileOk = (profileResp as any)?.ok === true;

        let reasonCode: WhapiReasonCode | null = null;
        let helpUrl: string | null = null;
        let reasonMessage: string | null = null;
        let status = statusText;

        if (profileOk) {
          status = "AUTH";
        } else {
          const pStatus = (profileResp as any)?.status || 0;
          const pData = (profileResp as any)?.data;
          if (pStatus === 401 || pStatus === 403) {
            const cls = classifyWhapiError(pStatus, pData);
            reasonCode = cls.reasonCode;
            helpUrl = cls.helpUrl;
            reasonMessage = cls.error;
            status = "OFFLINE";
          } else if (pStatus === 402) {
            const cls = classifyWhapiError(pStatus, pData);
            reasonCode = cls.reasonCode;
            helpUrl = cls.helpUrl;
            reasonMessage = cls.error;
            status = "OFFLINE";
          } else if (pStatus === 404) {
            const cls = classifyWhapiError(pStatus, pData);
            reasonCode = cls.reasonCode;
            helpUrl = cls.helpUrl;
            reasonMessage = cls.error;
            status = "OFFLINE";
          } else {
            // Fallback: só marca channel_error se /health realmente indicar desautenticação.
            const txt = String(pData?.message || pData?.error || "").toLowerCase();
            const looksDeauthed =
              txt.includes("not authorized") || txt.includes("logout") || txt.includes("qr");
            if (looksDeauthed || statusCodeNum === 6) {
              reasonCode = "channel_error";
              helpUrl = WHAPI_PANEL_URL;
              reasonMessage = "Canal desautenticado. Reescaneie o QR no painel Whapi.";
              status = "OFFLINE";
            } else if (statusCodeNum === 2) {
              status = "QR";
            } else if (statusCodeNum === 0 || statusCodeNum === 1 || statusCodeNum === 4) {
              status = "INIT";
            }
          }
        }

        return json(200, {
          ok: profileOk,
          status,
          statusCode: statusCodeNum,
          statusText,
          phone: phone ? `+${phone}` : null,
          channel_id: channelId,
          webhook_ok: webhookOk,
          expected_webhook_url: expectedWebhookUrl,
          reasonCode,
          reasonMessage,
          helpUrl,
          profile_ok: profileOk,
          // Presença do device físico (celular do super admin)
          device_likely_offline: deviceLikelyOffline,
          outbound_recent_count: outboundRecentCount,
          outbound_pending_count: outboundPendingCount,
          outbound_delivered_count: outboundDeliveredCount,
          last_outbound_at: lastOutboundAt,
          last_outbound_status: lastOutboundStatus,
        });
      }


      case "request_qr": {
        // Pede QR code de pareamento (canal precisa estar em INIT/QR).
        const r = await whapiFetch(whapiToken, `/users/login`, { method: "GET" });
        if (!r.ok) {
          if (isWhapiErrorBlob(r.status, r.data)) {
            const cls = classifyWhapiError(r.status, r.data);
            return json(cls.httpStatus, { error: cls.error, reasonCode: cls.reasonCode, helpUrl: cls.helpUrl });
          }
          return json(r.status, { error: r.data });
        }
        return json(200, { qr: r.data?.base64 || r.data?.qr || null, raw: r.data });
      }

      case "logout": {
        const r = await whapiFetch(whapiToken, `/users/logout`, { method: "POST" });
        return json(r.ok ? 200 : r.status, { ok: r.ok, raw: r.data });
      }

      case "refresh_webhook": {
        // Reaplica o webhook do whapi-webhook nas configs da Whapi.
        const url = `${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/whapi-webhook`;
        const body = {
          webhooks: [
            {
              url,
              mode: "body",
              events: [
                { type: "messages", method: "post" },
                { type: "statuses", method: "post" },
              ],
            },
          ],
        };
        const r = await whapiFetch(whapiToken, `/settings`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        return json(r.ok ? 200 : r.status, { ok: r.ok, url, raw: r.data });
      }

      case "reauth": {
        // Logout + request_qr em sequência, num único clique.
        await whapiFetch(whapiToken, `/users/logout`, { method: "POST" }).catch(() => null);
        await new Promise((res) => setTimeout(res, 1500));
        const qr = await whapiFetch(whapiToken, `/users/login`, { method: "GET" });
        if (!qr.ok) {
          if (isWhapiErrorBlob(qr.status, qr.data)) {
            const cls = classifyWhapiError(qr.status, qr.data);
            return json(cls.httpStatus, { error: cls.error, reasonCode: cls.reasonCode, helpUrl: cls.helpUrl });
          }
          return json(qr.status, { error: qr.data });
        }
        return json(200, { qr: qr.data?.base64 || qr.data?.qr || null, raw: qr.data });
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
