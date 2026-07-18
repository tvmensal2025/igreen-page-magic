/**
 * Resolve mídia de linhas em `conversations` — mesmo pipeline do chat/captação.
 * Fallbacks: URL embutida → media_id → biblioteca → last_inbound → Whapi API → Evolution.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseConversationEmbeddedMediaUrl } from "@/lib/captacao/conversationMediaUrl";
import { whapiDownloadMedia, whapiListMessagesForChat } from "@/services/whapiApi";
import {
  findMessagesForChat,
  getBase64FromMediaMessage,
  type EvolutionMessage,
} from "@/services/evolutionApi";

export type ConversationMessageRow = {
  id: string;
  message_direction: string;
  message_text: string | null;
  message_type: string | null;
  media_id: string | null;
  external_message_id: string | null;
  created_at: string;
};

export type LastInboundMedia = {
  url: string | null;
  messageId: string | null;
  kind: string | null;
  mime?: string | null;
  at?: string | null;
};

export const CONVERSATION_MESSAGE_SELECT =
  "id, message_direction, message_text, message_type, media_id, external_message_id, created_at";

const mediaCache = new Map<string, string>();

const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
] as const;

function unwrapMessageContent(m: unknown, depth = 0): Record<string, unknown> | null {
  if (!m || typeof m !== "object" || depth > 6) return null;
  const obj = m as Record<string, unknown>;
  for (const key of WRAPPER_KEYS) {
    const inner = obj[key];
    if (inner && typeof inner === "object" && "message" in (inner as object)) {
      return unwrapMessageContent((inner as { message: unknown }).message, depth + 1);
    }
    if (inner && typeof inner === "object") {
      return unwrapMessageContent(inner, depth + 1);
    }
  }
  return obj;
}

type ExtractedMedia = {
  url?: string;
  base64?: string;
  mimetype?: string;
  mediaId?: string;
  kind?: string;
};

function extractEvolutionMedia(msg: EvolutionMessage): ExtractedMedia | null {
  const m = unwrapMessageContent(msg.message);
  if (!m) return null;

  if (m.imageMessage && typeof m.imageMessage === "object") {
    const im = m.imageMessage as Record<string, unknown>;
    return {
      kind: "image",
      url: im.url as string | undefined,
      base64: im.base64 as string | undefined,
      mimetype: (im.mimetype as string) || "image/jpeg",
      mediaId: (im.mediaId as string) || (im.id as string) || undefined,
    };
  }
  if (m.videoMessage && typeof m.videoMessage === "object") {
    const vm = m.videoMessage as Record<string, unknown>;
    return {
      kind: "video",
      url: vm.url as string | undefined,
      base64: vm.base64 as string | undefined,
      mimetype: (vm.mimetype as string) || "video/mp4",
      mediaId: (vm.mediaId as string) || (vm.id as string) || undefined,
    };
  }
  if (m.ptvMessage && typeof m.ptvMessage === "object") {
    const pm = m.ptvMessage as Record<string, unknown>;
    return {
      kind: "video",
      url: pm.url as string | undefined,
      base64: pm.base64 as string | undefined,
      mimetype: (pm.mimetype as string) || "video/mp4",
      mediaId: (pm.mediaId as string) || (pm.id as string) || undefined,
    };
  }
  if (m.audioMessage && typeof m.audioMessage === "object") {
    const am = m.audioMessage as Record<string, unknown>;
    return {
      kind: "audio",
      url: am.url as string | undefined,
      base64: am.base64 as string | undefined,
      mimetype: (am.mimetype as string) || "audio/ogg; codecs=opus",
      mediaId: (am.mediaId as string) || (am.id as string) || undefined,
    };
  }
  if (m.documentMessage && typeof m.documentMessage === "object") {
    const dm = m.documentMessage as Record<string, unknown>;
    return {
      kind: "document",
      url: dm.url as string | undefined,
      base64: dm.base64 as string | undefined,
      mimetype: (dm.mimetype as string) || "application/pdf",
      mediaId: (dm.mediaId as string) || (dm.id as string) || undefined,
    };
  }
  if (m.stickerMessage && typeof m.stickerMessage === "object") {
    const sm = m.stickerMessage as Record<string, unknown>;
    return {
      kind: "sticker",
      url: sm.url as string | undefined,
      base64: sm.base64 as string | undefined,
      mimetype: (sm.mimetype as string) || "image/webp",
      mediaId: (sm.mediaId as string) || (sm.id as string) || undefined,
    };
  }
  return null;
}

function looksLikeUuid(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function normalizeJid(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (phone.includes("@")) return phone;
  return `${digits}@s.whatsapp.net`;
}

function toDataUrl(mimetype: string, base64: string): string {
  return `data:${mimetype || "application/octet-stream"};base64,${base64}`;
}

async function resolveHttpOrData(raw: string, fallbackMime?: string): Promise<string | null> {
  if (!raw) return null;
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("http")) {
    const dl = await whapiDownloadMedia({ url: raw });
    if (dl?.base64) return toDataUrl(dl.mimetype || fallbackMime || "application/octet-stream", dl.base64);
    return raw;
  }
  return null;
}

async function downloadWhapiMedia(url?: string | null, mediaId?: string | null, fallbackMime?: string): Promise<string | null> {
  if (!url && !mediaId) return null;
  const dl = await whapiDownloadMedia({ url: url || "", mediaId: mediaId || "" });
  if (dl?.base64) return toDataUrl(dl.mimetype || fallbackMime || "application/octet-stream", dl.base64);
  if (url?.startsWith("http")) return resolveHttpOrData(url, fallbackMime);
  return null;
}

function msgTimestampMs(msg: EvolutionMessage): number {
  const n = Number(msg.messageTimestamp);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 10_000_000_000 ? n : n * 1000;
}

function pickMessageByTime(msgs: EvolutionMessage[], targetIso: string, kind: string): EvolutionMessage | undefined {
  const target = new Date(targetIso).getTime();
  let best: EvolutionMessage | undefined;
  let bestDiff = Infinity;
  for (const m of msgs) {
    const media = extractEvolutionMedia(m);
    if (!media?.kind) continue;
    if (kind && media.kind !== kind) continue;
    const diff = Math.abs(msgTimestampMs(m) - target);
    if (diff < bestDiff && diff <= 3 * 60_000) {
      best = m;
      bestDiff = diff;
    }
  }
  return best;
}

async function mediaFromEvolutionMessage(msg: EvolutionMessage, fallbackMime?: string): Promise<string | null> {
  const extracted = extractEvolutionMedia(msg);
  if (!extracted) return null;
  if (extracted.base64) return toDataUrl(extracted.mimetype || fallbackMime || "application/octet-stream", extracted.base64);
  return downloadWhapiMedia(extracted.url, extracted.mediaId, extracted.mimetype || fallbackMime);
}

type CustomerMediaCtx = {
  phone: string;
  jid: string;
  consultantId: string | null;
  lastInbound: LastInboundMedia & { mime?: string | null; at?: string | null };
};

async function loadCustomerCtx(customerId: string): Promise<CustomerMediaCtx | null> {
  const { data } = await supabase
    .from("customers")
    .select(
      "phone_whatsapp, consultant_id, last_inbound_media_url, last_inbound_media_message_id, last_inbound_media_kind, last_inbound_media_mime, last_inbound_media_at",
    )
    .eq("id", customerId)
    .maybeSingle();
  if (!data?.phone_whatsapp) return null;
  return {
    phone: data.phone_whatsapp,
    jid: normalizeJid(data.phone_whatsapp),
    consultantId: data.consultant_id ?? null,
    lastInbound: {
      url: data.last_inbound_media_url ?? null,
      messageId: data.last_inbound_media_message_id ?? null,
      kind: data.last_inbound_media_kind ?? null,
      mime: data.last_inbound_media_mime ?? null,
      at: data.last_inbound_media_at ?? null,
    },
  };
}

async function fetchFromProviderHistory(
  ctx: CustomerMediaCtx,
  row: ConversationMessageRow,
): Promise<string | null> {
  const kind = (row.message_type || "").toLowerCase();
  const fromMe = row.message_direction === "outbound";
  const extId = row.external_message_id;

  // Whapi — lista recente e casa por id ou horário
  try {
    const msgs = await whapiListMessagesForChat(ctx.jid, null, 100);
    let hit = extId ? msgs.find((m) => m.key?.id === extId) : undefined;
    if (!hit && kind) hit = pickMessageByTime(msgs, row.created_at, kind);
    if (hit) {
      const url = await mediaFromEvolutionMessage(hit);
      if (url) return url;
    }
  } catch {
    /* tenta Evolution */
  }

  if (!ctx.consultantId) return null;
  const { data: inst } = await supabase
    .from("whatsapp_instances")
    .select("instance_name")
    .eq("consultant_id", ctx.consultantId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const instanceName = inst?.instance_name;
  if (!instanceName) return null;

  if (extId) {
    const direct = await getBase64FromMediaMessage(instanceName, extId, ctx.jid, fromMe);
    if (direct?.base64) return toDataUrl(direct.mimetype || kind || "application/octet-stream", direct.base64);
  }

  try {
    const msgs = await findMessagesForChat(instanceName, ctx.jid, null, 80);
    let hit = extId ? msgs.find((m) => m.key?.id === extId) : undefined;
    if (!hit && kind) hit = pickMessageByTime(msgs, row.created_at, kind);
    if (hit) {
      const url = await mediaFromEvolutionMessage(hit);
      if (url) return url;
      if (hit.key?.id) {
        const direct = await getBase64FromMediaMessage(instanceName, hit.key.id, ctx.jid, !!hit.key.fromMe);
        if (direct?.base64) return toDataUrl(direct.mimetype || kind || "application/octet-stream", direct.base64);
      }
    }
  } catch {
    /* fim */
  }

  return null;
}

export async function resolveConversationMediaDataUrl(opts: {
  row: ConversationMessageRow;
  customerId: string;
  lastInbound?: LastInboundMedia;
}): Promise<string | null> {
  const { row, customerId } = opts;
  const cached = mediaCache.get(row.id);
  if (cached) return cached;

  const type = (row.message_type || "text").toLowerCase();
  const inbound = row.message_direction !== "outbound";
  const lastInbound = { ...opts.lastInbound };

  // 1) URL embutida [image] https://...
  const embedded = parseConversationEmbeddedMediaUrl(row.message_text);
  if (embedded?.url) {
    const got = await resolveHttpOrData(embedded.url);
    if (got) { mediaCache.set(row.id, got); return got; }
  }

  // 2) data: no texto
  const rawText = (row.message_text || "").trim();
  if (rawText.startsWith("data:")) {
    mediaCache.set(row.id, rawText);
    return rawText;
  }

  // 3) media_id Whapi
  if (row.media_id && !looksLikeUuid(row.media_id)) {
    const got = await downloadWhapiMedia(null, row.media_id);
    if (got) { mediaCache.set(row.id, got); return got; }
  }

  // 4) Biblioteca interna (UUID)
  if (row.media_id && looksLikeUuid(row.media_id)) {
    const { data: lib } = await supabase
      .from("ai_media_library")
      .select("url, kind")
      .eq("id", row.media_id)
      .maybeSingle();
    if (lib?.url) {
      const got = await resolveHttpOrData(String(lib.url));
      if (got) { mediaCache.set(row.id, got); return got; }
    }
  }

  const ctx = await loadCustomerCtx(customerId);
  const li = ctx?.lastInbound ?? lastInbound;

  // 5) last_inbound do cliente (mesma mensagem ou janela curta)
  if (inbound && li?.url) {
    const idMatch = row.external_message_id && li.messageId && row.external_message_id === li.messageId;
    const timeMatch = li.at && Math.abs(new Date(row.created_at).getTime() - new Date(li.at).getTime()) < 120_000;
    const kindMatch = !li.kind || li.kind === type || (type === "audio" && li.kind === "audio");
    if (idMatch || (timeMatch && kindMatch)) {
      const got = await resolveHttpOrData(li.url, li.mime || undefined);
      if (got) { mediaCache.set(row.id, got); return got; }
    }
  }

  // 6) Whapi download combinado (media_id + URL se houver)
  if (row.media_id || embedded?.url) {
    const got = await downloadWhapiMedia(embedded?.url, row.media_id, type);
    if (got) { mediaCache.set(row.id, got); return got; }
  }

  // 7) Histórico Whapi / Evolution
  if (ctx) {
    const fromHistory = await fetchFromProviderHistory(ctx, row);
    if (fromHistory) { mediaCache.set(row.id, fromHistory); return fromHistory; }
  }

  return null;
}

export function clearConversationMediaCache() {
  mediaCache.clear();
}
