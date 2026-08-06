/**
 * Adapter Whapi → mesma forma das respostas Evolution.
 * Permite reuso dos mappers em useChats / useMessages.
 */
import { supabase } from "@/integrations/supabase/client";
import type { EvolutionChat, EvolutionMessage } from "@/services/evolutionApi";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo";
const PROXY_URL = `${SUPABASE_URL}/functions/v1/whapi-proxy`;

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");

  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ action, payload }),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = (j?.error && (j.error.message || JSON.stringify(j.error))) || j?.message || detail;
    } catch { /* ignore */ }
    throw new Error(detail || "Erro WhatsApp");
  }
  return (await res.json()) as T;
}

function normalizeJid(jid: string): string {
  if (!jid) return jid;
  if (jid.includes("@")) return jid;
  const digits = jid.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

export function whapiListChats(): Promise<EvolutionChat[]> {
  // Whapi proxy aceita até 200; lista maior evita sumir conversa antiga/fechada.
  return call<EvolutionChat[]>("list_chats", { count: 200 });
}

export function whapiListMessages(
  chatId: string,
  count = 50,
  offset = 0,
): Promise<EvolutionMessage[]> {
  return call<EvolutionMessage[]>("list_messages", {
    chatId: normalizeJid(chatId),
    count,
    offset,
  });
}

/** Mesma lógica de findMessagesForChat — Whapi/Evolution podem indexar msgs em JIDs diferentes. */
export async function whapiListMessagesForChat(
  remoteJid: string,
  altJid?: string | null,
  count = 50,
  offset = 0,
): Promise<EvolutionMessage[]> {
  const jids = new Set<string>([normalizeJid(remoteJid)]);
  if (altJid) jids.add(normalizeJid(altJid));
  const altPhone = altJid?.endsWith("@s.whatsapp.net") ? altJid.split("@")[0] : null;
  if (altPhone) jids.add(normalizeJid(`${altPhone}@s.whatsapp.net`));

  const batches = await Promise.all(
    Array.from(jids).map((jid) =>
      whapiListMessages(jid, count, offset).catch(() => [] as EvolutionMessage[]),
    ),
  );

  const seen = new Set<string>();
  const merged: EvolutionMessage[] = [];
  for (const batch of batches) {
    for (const msg of batch) {
      const id = msg.key?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(msg);
    }
  }
  // Sempre antigo → recente, independente da ordem/sort da API Whapi.
  return merged.sort((a, b) => {
    const ta = Number(a.messageTimestamp) > 10_000_000_000
      ? Number(a.messageTimestamp) / 1000
      : Number(a.messageTimestamp) || 0;
    const tb = Number(b.messageTimestamp) > 10_000_000_000
      ? Number(b.messageTimestamp) / 1000
      : Number(b.messageTimestamp) || 0;
    if (ta !== tb) return ta - tb;
    return String(a.key?.id || "").localeCompare(String(b.key?.id || ""));
  });
}

export async function whapiGetProfilePicture(chatId: string): Promise<string | null> {
  try {
    const r = await call<{ url: string | null }>("get_profile_pic", { chatId: normalizeJid(chatId) });
    return r?.url || null;
  } catch {
    return null;
  }
}

export async function whapiSendText(
  to: string,
  text: string,
  opts?: { intent?: "bulk" | "reply"; customerId?: string },
): Promise<{ key: { id: string } }> {
  return call<{ key: { id: string } }>("send_text", {
    to: normalizeJid(to),
    text,
    ...(opts?.intent ? { intent: opts.intent } : {}),
    ...(opts?.customerId ? { customerId: opts.customerId } : {}),
  });
}

export async function whapiSendMedia(
  to: string,
  mediaUrl: string,
  mediatype: "image" | "video" | "document" | "audio" | "sticker",
  caption?: string,
  fileName?: string,
  opts?: { intent?: "bulk" | "reply"; customerId?: string },
): Promise<{ key: { id: string } }> {
  return call<{ key: { id: string } }>("send_media", {
    to: normalizeJid(to),
    mediaUrl,
    mediatype,
    caption,
    fileName,
    ...(opts?.intent ? { intent: opts.intent } : {}),
    ...(opts?.customerId ? { customerId: opts.customerId } : {}),
  });
}

/** Botão quick_reply Whapi (até 3). Se a API falhar, o proxy cai em texto numerado. */
export async function whapiSendButtons(
  to: string,
  text: string,
  buttons: Array<{ id: string; title: string }>,
  opts?: { intent?: "bulk" | "reply"; customerId?: string; footer?: string },
): Promise<{ key: { id: string }; mode?: "quick_reply" | "numbered_fallback" }> {
  return call<{ key: { id: string }; mode?: "quick_reply" | "numbered_fallback" }>("send_buttons", {
    to: normalizeJid(to),
    text,
    buttons: buttons.slice(0, 3).map((b) => ({
      id: String(b.id || "").slice(0, 64),
      title: String(b.title || "").slice(0, 25),
    })),
    ...(opts?.footer ? { footer: opts.footer } : {}),
    ...(opts?.intent ? { intent: opts.intent } : {}),
    ...(opts?.customerId ? { customerId: opts.customerId } : {}),
  });
}

/** Baixa mídia via proxy (URL pública ou mediaId Whapi → base64). */
export async function whapiDownloadMedia(opts: {
  url?: string;
  mediaId?: string;
}): Promise<{ base64: string; mimetype: string } | null> {
  try {
    const r = await call<{ base64?: string; mimetype?: string; error?: string }>("download_media", {
      url: opts.url || "",
      mediaId: opts.mediaId || "",
    });
    if (!r?.base64) return null;
    return { base64: r.base64, mimetype: r.mimetype || "application/octet-stream" };
  } catch {
    return null;
  }
}
