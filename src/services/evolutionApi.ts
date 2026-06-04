// Evolution API calls routed through Supabase Edge Function proxy
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsemFzZmhjeGN6bmFwcnJyYWdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzQ1NzAsImV4cCI6MjA4Njg1MDU3MH0.OJzRdi_Z_1TFZjQXmK8rJofBeHVZc27VSo2vMMw9Spo";
const PROXY_URL = `${SUPABASE_URL}/functions/v1/evolution-proxy`;

/** Custom error class for auth failures — hooks can check this to avoid crashing */
export class EvolutionAuthError extends Error {
  public readonly code = "auth_error";
  public readonly requiresRelogin: boolean;

  constructor(
    message = "Sessão expirada. Faça login novamente.",
    options?: { requiresRelogin?: boolean }
  ) {
    super(message);
    this.name = "EvolutionAuthError";
    this.requiresRelogin = options?.requiresRelogin ?? false;
  }
}

function normalizeQrBase64(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value;
}

async function readJsonSafe(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function signOutSilently() {
  try {
    await supabase.auth.signOut();
  } catch {
    // best-effort only
  }
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) return token;
  }

  // Sem sessão local (ou refresh forçado): tenta refresh uma vez.
  const refreshResult = await supabase.auth.refreshSession();
  const refreshedToken = refreshResult.data.session?.access_token;
  if (refreshedToken) return refreshedToken;

  // Sem token e sem refresh possível — não dispare chamada à edge function;
  // ela retornaria 401 e poluiria os logs/runtime-error tracker.
  throw new EvolutionAuthError("Sessão expirada. Faça login novamente.", {
    requiresRelogin: true,
  });
}


async function executeProxyRequest(
  token: string,
  path: string,
  method: string,
  body?: unknown
): Promise<Response> {
  const proxyBody: Record<string, unknown> = { path, method };
  if (body !== undefined) {
    proxyBody.body = body;
  }

  return fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(proxyBody),
  });
}

async function request<T>(
  path: string,
  method: string,
  body?: unknown,
  options?: { gracefulTimeout?: boolean }
): Promise<T> {
  try {
    let token = await getAccessToken();
    let retriedAfterAuthFailure = false;

    while (true) {
      const res = await executeProxyRequest(token, path, method, body);

      if (res.status === 401) {
        if (retriedAfterAuthFailure) {
          await signOutSilently();
          throw new EvolutionAuthError("Sessão expirada. Faça login novamente.", {
            requiresRelogin: true,
          });
        }

        token = await getAccessToken(true);
        retriedAfterAuthFailure = true;
        continue;
      }

      if (!res.ok) {
        let detail = res.statusText || "Erro na API";
        const json = await readJsonSafe(res);
        const msg =
          json?.response && typeof json.response === "object" && !Array.isArray(json.response)
            ? (json.response as Record<string, unknown>).message
            : json?.error || json?.message;

        if (Array.isArray(msg)) {
          // Handle nested arrays like [["instance requires..."]]
          const flat = msg.flat();
          detail = typeof flat[0] === "string" ? flat[0] : JSON.stringify(flat);
        } else if (typeof msg === "string") {
          detail = msg;
        }

        // Don't crash the whole app for "not connected" — let callers handle gracefully
        if (/not connected/i.test(detail)) {
          console.warn(`[EvolutionAPI] Instance not connected: ${detail}`);
        }

        throw new Error(detail);
      }

      const json = await res.json();

      // Detect graceful timeout/error responses from proxy (200 with error payload)
      if (json && typeof json === "object" && !Array.isArray(json)) {
        if ((json as Record<string, unknown>).timeout === true) {
          if (options?.gracefulTimeout) {
            return json as T;
          }
          throw new Error("Timeout ao processar requisição");
        }
        if ((json as Record<string, unknown>).unavailable === true) {
          if (options?.gracefulTimeout) {
            return json as T;
          }
          throw new Error(
            ((json as Record<string, unknown>).message as string) ||
              "Serviço temporariamente indisponível"
          );
        }
      }

      return json;
    }
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error("Erro de conexão. Verifique sua internet.");
    }
    throw err;
  }
}

// ─── Instance Management ───

export async function createInstance(instanceName: string) {
  const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution-webhook`;

  const response = await request<{
    instance?: { instanceName: string; status: string };
    qrcode?: { base64?: string | null; pairingCode?: string; count?: number };
  }>("instance/create", "POST", {
    instanceName,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
    webhook: {
      url: webhookUrl,
      byEvents: false,
      base64: true,
      enabled: true,
      events: [
        "MESSAGES_UPSERT",
        "MESSAGES_UPDATE",
        "CONNECTION_UPDATE",
      ],
    },
  });

  return {
    ...response,
    qrcode: response?.qrcode
      ? { ...response.qrcode, base64: normalizeQrBase64(response.qrcode.base64) }
      : undefined,
  };
}

/** Configure webhook on an existing instance */
export async function setInstanceWebhook(instanceName: string) {
  const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution-webhook`;

  return request(`webhook/set/${instanceName}`, "POST", {
    webhook: {
      url: webhookUrl,
      byEvents: false,
      base64: true,
      enabled: true,
      events: [
        "MESSAGES_UPSERT",
        "CONNECTION_UPDATE",
      ],
    },
  });
}

export async function connectInstance(instanceName: string) {
  const response = await request<{
    base64?: string | null;
    code?: string | null;
    pairingCode?: string;
    count?: number;
    qrcode?: { base64?: string | null; count?: number; pairingCode?: string };
  }>(`instance/connect/${instanceName}`, "GET");

  return {
    base64: normalizeQrBase64(response?.base64) ?? normalizeQrBase64(response?.qrcode?.base64),
    pairingCode: response?.pairingCode || response?.qrcode?.pairingCode || null,
  };
}

export async function getConnectionState(instanceName: string) {
  try {
    const response = await request<{ instance?: { state: string }; state?: string }>(
      `instance/connectionState/${instanceName}`,
      "GET"
    );
    const state = response?.instance?.state || response?.state;
    return { state: (state as "open" | "close" | "connecting") || "close" };
  } catch (err) {
    if (err instanceof EvolutionAuthError) throw err;
    const msg = err instanceof Error ? err.message : "";
    // "not connected" / "not found" → return close instead of crashing
    if (/not connected|not found|does not exist|instance.*not/i.test(msg)) {
      return { state: "close" as const };
    }
    throw err;
  }
}

export async function deleteInstance(instanceName: string) {
  return request<void>(`instance/delete/${instanceName}`, "DELETE");
}

export async function logoutInstance(instanceName: string) {
  return request<void>(`instance/logout/${instanceName}`, "DELETE");
}

export interface EvolutionInstanceSummary {
  instance?: {
    instanceName?: string;
    status?: string;
    owner?: string;
    ownerJid?: string;
  };
  name?: string;
  connectionStatus?: string;
  owner?: string;
  ownerJid?: string;
}

export async function fetchInstances() {
  return request<EvolutionInstanceSummary[]>("instance/fetchInstances", "GET");
}

// ─── Chat / Conversations ───

export interface EvolutionChat {
  id: string;
  remoteJid: string;
  name?: string;
  pushName?: string;
  profilePicUrl?: string;
  lastMsgTimestamp?: number;
  unreadMessages?: number;
  unreadCount?: number;
  lastMessage?: {
    key: { fromMe: boolean; remoteJid?: string; remoteJidAlt?: string; participantAlt?: string };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text: string };
      imageMessage?: { caption?: string };
      documentMessage?: { fileName?: string };
      audioMessage?: Record<string, unknown>;
    };
    messageTimestamp?: number;
  };
}

export async function findChats(instanceName: string): Promise<EvolutionChat[]> {
  return request<EvolutionChat[]>(`chat/findChats/${instanceName}`, "POST", {});
}

export interface EvolutionMessage {
  key: { remoteJid: string; remoteJidAlt?: string; fromMe: boolean; id: string };
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text: string };
    imageMessage?: { url?: string; caption?: string; mimetype?: string; base64?: string };
    documentMessage?: { url?: string; fileName?: string; mimetype?: string; base64?: string };
    audioMessage?: { url?: string; mimetype?: string; ptt?: boolean; base64?: string };
    videoMessage?: { url?: string; caption?: string; mimetype?: string; base64?: string };
    stickerMessage?: { url?: string; mimetype?: string; base64?: string };
  };
  messageTimestamp?: number;
  status?: number;
}

export async function getBase64FromMediaMessage(
  instanceName: string, messageId: string, remoteJid: string, fromMe: boolean
) {
  try {
    return await request<{ base64?: string; mimetype?: string }>(
      `chat/getBase64FromMediaMessage/${instanceName}`, "POST",
      { message: { key: { remoteJid, fromMe, id: messageId } }, convertToMp4: false }
    );
  } catch { return null; }
}

export async function findMessages(instanceName: string, remoteJid: string, limit = 50): Promise<EvolutionMessage[]> {
  const result = await request<{ messages?: { records: EvolutionMessage[] } } | EvolutionMessage[]>(
    `chat/findMessages/${instanceName}`, "POST", { where: { key: { remoteJid } }, limit }
  );
  if (Array.isArray(result)) return result;
  return result?.messages?.records || [];
}

export interface EvolutionContact { id: string; remoteJid: string; pushName?: string; profilePicUrl?: string }

export async function findContacts(instanceName: string): Promise<EvolutionContact[]> {
  return request<EvolutionContact[]>(`chat/findContacts/${instanceName}`, "POST", {});
}

// ─── Message Sending ───

export async function sendTextMessage(instanceName: string, phone: string, text: string, gracefulTimeout = false) {
  return request<{ key?: { id?: string }; status?: string; messageStatus?: string }>(
    `message/sendText/${instanceName}`,
    "POST",
    { number: phone, text },
    { gracefulTimeout }
  );
}

export async function sendMedia(
  instanceName: string, phone: string, mediaUrl: string, caption: string,
  mediatype: "image" | "video" | "document",
  gracefulTimeout = false
) {
  return request<{ key: { id: string } }>(`message/sendMedia/${instanceName}`, "POST", {
    number: phone, mediatype, media: mediaUrl, caption,
  }, { gracefulTimeout });
}

export async function sendAudio(instanceName: string, phone: string, audioUrl: string, gracefulTimeout = false) {
  return request<{ key: { id: string } }>(`message/sendWhatsAppAudio/${instanceName}`, "POST", {
    number: phone, audio: audioUrl,
  }, { gracefulTimeout });
}

export async function sendDocument(instanceName: string, phone: string, docUrl: string, fileName: string, gracefulTimeout = false) {
  return request<{ key: { id: string } }>(`message/sendMedia/${instanceName}`, "POST", {
    number: phone, mediatype: "document", media: docUrl, fileName,
  }, { gracefulTimeout });
}

// ─── Groups ───

export interface EvolutionGroup {
  id: string;
  subject: string;
  subjectOwner?: string;
  subjectTime?: number;
  size?: number;
  creation?: number;
  owner?: string;
  desc?: string;
  participants?: EvolutionGroupParticipant[];
}

export interface EvolutionGroupParticipant {
  id: string;
  admin?: string | null;
}

export async function fetchAllGroups(instanceName: string): Promise<EvolutionGroup[]> {
  try {
    return await request<EvolutionGroup[]>(`group/fetchAllGroups/${instanceName}`, "GET");
  } catch { return []; }
}

export async function getGroupParticipants(instanceName: string, groupJid: string): Promise<EvolutionGroupParticipant[]> {
  try {
    const result = await request<{ participants?: EvolutionGroupParticipant[] }>(
      `group/participants/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`, "GET"
    );
    return result?.participants || [];
  } catch { return []; }
}

// ─── Presence / Read ───

export async function markAsRead(instanceName: string, remoteJid: string, messageId: string, fromMe: boolean) {
  return request<void>(`chat/markMessageAsRead/${instanceName}`, "POST", {
    readMessages: [{ id: messageId, remoteJid, fromMe }],
  });
}

export async function getProfilePicture(instanceName: string, remoteJid: string) {
  try {
    const result = await request<{ profilePictureUrl?: string; wpiPicUrl?: string }>(
      `chat/fetchProfilePictureUrl/${instanceName}`, "POST", { number: remoteJid }
    );
    return result?.profilePictureUrl || result?.wpiPicUrl || null;
  } catch { return null; }
}
