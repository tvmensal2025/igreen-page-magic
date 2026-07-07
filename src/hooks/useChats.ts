import { useState, useEffect, useCallback, useRef } from "react";
import { findChats, findContacts, getProfilePicture, type EvolutionChat, type EvolutionContact } from "@/services/evolutionApi";
import { whapiListChats, whapiGetProfilePicture } from "@/services/whapiApi";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ChatItem {
  remoteJid: string;
  sendTargetJid?: string;
  name: string;
  lastMessage: string;
  lastMessageTimestamp: number;
  unreadCount: number;
  profilePicUrl?: string;
  isGroup: boolean;
}

function extractLastMessage(chat: EvolutionChat): string {
  const msg = chat.lastMessage?.message;
  if (!msg) return "";
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    (msg.imageMessage ? "📷 Imagem" : "") ||
    msg.documentMessage?.fileName ||
    (msg.audioMessage ? "🎵 Áudio" : "") ||
    ""
  );
}

function formatPhoneNumber(raw: string): string {
  if (/^55\d{10,11}$/.test(raw)) {
    const ddd = raw.slice(2, 4);
    const number = raw.slice(4);
    if (number.length === 9) return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    if (number.length === 8) return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  }
  if (raw.length > 8) {
    return `+${raw.slice(0, 2)} ${raw.slice(2)}`;
  }
  return raw;
}

function isSystemChatJid(jid: string): boolean {
  return jid === "status@broadcast" || jid === "0@s.whatsapp.net" || jid.endsWith("@broadcast");
}

function canFetchProfilePicture(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

function mapChat(chat: EvolutionChat, contactsMap: Map<string, EvolutionContact>): ChatItem | null {
  const jid = chat.remoteJid || chat.id;
  if (!jid || isSystemChatJid(jid)) return null;

  const contact = contactsMap.get(jid);

  const altJid = chat.lastMessage?.key?.remoteJidAlt || chat.lastMessage?.key?.participantAlt;
  const realPhone = altJid ? altJid.split("@")[0] : null;

  const rawJidNumber = jid.split("@")[0];
  const isLid = jid.endsWith("@lid");

  const hasName = chat.pushName || chat.lastMessage?.pushName || contact?.pushName || chat.name;
  if (isLid && !hasName && !realPhone) return null;

  const lastMsgPushName = chat.lastMessage?.key?.fromMe ? undefined : chat.lastMessage?.pushName;
  const nameSource = chat.pushName || lastMsgPushName || contact?.pushName || chat.name;
  const phoneSource = realPhone || (isLid ? null : rawJidNumber);
  const displayName = nameSource || (phoneSource ? formatPhoneNumber(phoneSource) : `Contato ${rawJidNumber.slice(-4)}`);

  const sendTargetJid =
    altJid ||
    (isLid ? undefined : jid);

  return {
    remoteJid: jid,
    sendTargetJid,
    name: displayName,
    lastMessage: extractLastMessage(chat),
    lastMessageTimestamp: chat.lastMsgTimestamp || chat.lastMessage?.messageTimestamp || 0,
    unreadCount: chat.unreadMessages || chat.unreadCount || 0,
    profilePicUrl: contact?.profilePicUrl || chat.profilePicUrl,
    isGroup: jid.endsWith("@g.us"),
  };
}

function deduplicateChats(chats: ChatItem[]): ChatItem[] {
  const map = new Map<string, ChatItem>();
  for (const chat of chats) {
    // Resolve the "real phone" key: prefer sendTargetJid (@s.whatsapp.net), fallback to remoteJid
    const key =
      (chat.sendTargetJid && chat.sendTargetJid.endsWith("@s.whatsapp.net")
        ? chat.sendTargetJid
        : null) ||
      (chat.remoteJid.endsWith("@s.whatsapp.net") ? chat.remoteJid : null) ||
      chat.remoteJid; // fallback for pure LID with no alt

    const existing = map.get(key);
    if (!existing) {
      map.set(key, chat);
    } else {
      // Merge: keep the one with the most recent message, sum unread, preserve pic
      const keep = chat.lastMessageTimestamp > existing.lastMessageTimestamp ? chat : existing;
      const other = keep === chat ? existing : chat;
      map.set(key, {
        ...keep,
        unreadCount: keep.unreadCount + other.unreadCount,
        profilePicUrl: keep.profilePicUrl || other.profilePicUrl,
        name: keep.name.startsWith("Contato ") && !other.name.startsWith("Contato ") ? other.name : keep.name,
        sendTargetJid: keep.sendTargetJid || other.sendTargetJid,
      });
    }
  }
  return Array.from(map.values());
}

// Low-concurrency queue
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

interface PicCacheEntry {
  url: string | null;
  fetchedAt: number;
}

const GLOBAL_PIC_PAUSE_TTL = 5 * 60 * 1000; // 5 minutes

const TRUSTED_NAME_SOURCES = new Set([
  "self_introduced", "user_confirmed", "ocr_conta", "ocr_doc", "ocr_cnh", "ocr_rg", "manual", "freeform_multi",
  "igreen_portal", // nome vindo do portal iGreen (ficha oficial do cliente)
]);

function digitsOnly(v: string | null | undefined): string {
  return String(v || "").replace(/\D/g, "");
}

export function useChats(instanceName: string | null, isWhapi: boolean = false) {
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [customerNames, setCustomerNames] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMessageAlert, setNewMessageAlert] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contactsMapRef = useRef<Map<string, EvolutionContact>>(new Map());
  const profilePicCacheRef = useRef<Map<string, PicCacheEntry>>(new Map());
  const fetchingChatsRef = useRef(false);
  const fetchingPicsRef = useRef(false);
  const globalPicPauseUntilRef = useRef(0);
  const { toast } = useToast();

  // Overlay nomes capturados (self_introduced/OCR/user_confirmed) sobre o pushName
  // do WhatsApp para que a sidebar e o header reflitam o nome real do lead.
  const refreshCustomerNames = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("customers")
        .select("name, name_source, phone_whatsapp")
        .in("name_source", Array.from(TRUSTED_NAME_SOURCES))
        .not("name", "is", null)
        .limit(2000);
      const map = new Map<string, string>();
      (data || []).forEach((c: any) => {
        const d = digitsOnly(c.phone_whatsapp);
        if (d && c.name) map.set(d, String(c.name));
      });
      setCustomerNames(map);
    } catch { /* non-critical */ }
  }, []);

  const fetchContacts = useCallback(async () => {
    if (isWhapi) { contactsMapRef.current = new Map(); return; }
    if (!instanceName) return;
    try {
      const contacts = await findContacts(instanceName);
      const map = new Map<string, EvolutionContact>();
      (contacts || []).forEach((c) => {
        const jid = c.remoteJid || c.id;
        if (jid) map.set(jid, c);
      });
      contactsMapRef.current = map;
    } catch {
      // contacts are optional enrichment
    }
  }, [instanceName, isWhapi]);

  const fetchChats = useCallback(async () => {
    if (!isWhapi && !instanceName) return;
    // Prevent overlapping fetches
    if (fetchingChatsRef.current) return;
    fetchingChatsRef.current = true;

    try {
      setIsLoading((prev) => (!prev ? true : prev));
      const raw = isWhapi
        ? await whapiListChats()
        : await findChats(instanceName!);
      const cache = profilePicCacheRef.current;

      const rawMapped = (Array.isArray(raw) ? raw : [])
        .map((c) => {
          const item = mapChat(c, contactsMapRef.current);
          if (!item) return null;
          const cached = cache.get(item.remoteJid);
          if (cached?.url && !item.profilePicUrl) {
            item.profilePicUrl = cached.url;
          }
          return item;
        })
        .filter((c): c is ChatItem => c !== null && !c.isGroup);

      const mapped = deduplicateChats(rawMapped)
        .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
      setChats(mapped);
      setError(null);

      // Fetch profile pictures — skip if another pic fetch is in progress
      if (fetchingPicsRef.current) {
        return; // don't start another pic round
      }

      const CACHE_TTL = 60 * 60 * 1000; // 1 hour
      const now = Date.now();
      const missingPics = mapped
        .filter((c) => {
          const targetJid = c.sendTargetJid || c.remoteJid;
          if (!canFetchProfilePicture(targetJid)) return false;
          if (c.profilePicUrl) return false;
          const cached = cache.get(c.remoteJid);
          if (cached && now - cached.fetchedAt < CACHE_TTL) return false;
          return true;
        })
        .slice(0, 3);

      if (missingPics.length > 0 && (isWhapi || instanceName) && now >= globalPicPauseUntilRef.current) {
        fetchingPicsRef.current = true;
        processWithConcurrency(missingPics, 1, async (chat) => {
          const targetJid = chat.sendTargetJid || chat.remoteJid;
          try {
            const picUrl = isWhapi
              ? await whapiGetProfilePicture(targetJid)
              : await getProfilePicture(instanceName!, targetJid);
            cache.set(chat.remoteJid, { url: picUrl || null, fetchedAt: Date.now() });
            return { jid: chat.remoteJid, picUrl };
          } catch {
            cache.set(chat.remoteJid, { url: null, fetchedAt: Date.now() });
            return { jid: chat.remoteJid, picUrl: null };
          }
        }).then((results) => {
          const picMap = new Map(
            results.filter((r) => r.picUrl).map((r) => [r.jid, r.picUrl!])
          );
          if (picMap.size > 0) {
            setChats((prev) =>
              prev.map((c) => (picMap.has(c.remoteJid) ? { ...c, profilePicUrl: picMap.get(c.remoteJid) } : c))
            );
          } else {
            // All returned null — pause globally for 5 minutes
            globalPicPauseUntilRef.current = Date.now() + GLOBAL_PIC_PAUSE_TTL;
          }
        }).catch(() => { /* non-critical */ })
          .finally(() => { fetchingPicsRef.current = false; });
      }
    } catch {
      // Silently ignore auth / transient errors on polling — next interval will retry
    } finally {
      fetchingChatsRef.current = false;
      setIsLoading(false);
    }
  }, [instanceName, isWhapi]);

  // Supabase Realtime subscription for inbound messages
  useEffect(() => {
    const channel = supabase
      .channel("conversations-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations", filter: "message_direction=eq.inbound" },
        (payload) => {
          const msg = payload.new as any;
          if (msg.message_text) {
            toast({
              title: "💬 Nova mensagem recebida",
              description: msg.message_text.slice(0, 80),
            });
            setNewMessageAlert(true);
            // Trigger refetch
            fetchChats();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [toast, fetchChats]);

  useEffect(() => {
    if (!isWhapi && !instanceName) {
      setChats([]);
      return;
    }

    const init = async () => {
      await fetchContacts();
      await Promise.all([fetchChats(), refreshCustomerNames()]);
    };
    init();

    const startPolling = () => {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(fetchChats, 45000);
    };
    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    startPolling();

    const onVisibility = () => {
      if (document.hidden) stopPolling();
      else { fetchChats(); startPolling(); }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Realtime: quando customer.name muda (bot capturou nome do lead), atualiza overlay
    const customerCh = supabase
      .channel(`customers-names-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers" }, () => {
        refreshCustomerNames();
      })
      .subscribe();

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(customerCh);
    };
  }, [fetchContacts, fetchChats, refreshCustomerNames, instanceName, isWhapi]);

  // Apply customer-name overlay on top of WhatsApp pushNames
  const chatsWithNames = customerNames.size === 0
    ? chats
    : chats.map((c) => {
        const phoneDigits = digitsOnly((c.sendTargetJid || c.remoteJid).split("@")[0]);
        const overriddenName = customerNames.get(phoneDigits);
        return overriddenName && overriddenName !== c.name ? { ...c, name: overriddenName } : c;
      });

  return { chats: chatsWithNames, isLoading, error, refetch: fetchChats, newMessageAlert, clearAlert: () => setNewMessageAlert(false) };
}
