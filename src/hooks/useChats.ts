import { useState, useEffect, useCallback, useRef } from "react";
import { findChats, findContacts, getProfilePicture, type EvolutionChat, type EvolutionContact } from "@/services/evolutionApi";
import { whapiListChats, whapiGetProfilePicture } from "@/services/whapiApi";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ChatItem {
  remoteJid: string;
  sendTargetJid?: string;
  name: string;
  /** Nome do perfil WhatsApp (quando disponível). */
  pushName?: string | null;
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
    msg.videoMessage?.caption ||
    (msg.videoMessage ? "🎬 Vídeo" : "") ||
    msg.documentMessage?.fileName ||
    (msg.audioMessage ? "🎵 Áudio" : "") ||
    (msg.stickerMessage ? "Sticker" : "") ||
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

/** Normaliza timestamp pra segundos (lista ordena por atividade recente). */
function normalizeChatTimestamp(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 10_000_000_000 ? Math.floor(n / 1000) : n;
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
    lastMessageTimestamp: normalizeChatTimestamp(
      chat.lastMsgTimestamp || chat.lastMessage?.messageTimestamp || 0,
    ),
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

const GLOBAL_PIC_PAUSE_TTL = 2 * 60 * 1000; // 2 min — só em rate-limit / falha em massa
const PIC_BATCH_SIZE = 8; // antes: 3 — lista grande ficava sem foto por muito tempo
const PIC_NULL_TTL = 15 * 60 * 1000; // null = sem foto / privado — re-tenta em 15 min (antes 1h)
const PIC_OK_TTL = 60 * 60 * 1000; // URL ok — cache 1h
const PIC_LS_KEY = "igreen_wa_profile_pics_v1";

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
  const picsHydratedRef = useRef(false);
  const fetchingChatsRef = useRef(false);
  const fetchingPicsRef = useRef(false);
  const globalPicPauseUntilRef = useRef(0);
  const consecutiveNullRoundsRef = useRef(0);
  const { toast } = useToast();

  // Hidrata cache de fotos do localStorage (sobrevive a F5; sem migration no banco).
  if (!picsHydratedRef.current && typeof window !== "undefined") {
    picsHydratedRef.current = true;
    try {
      const raw = localStorage.getItem(PIC_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, PicCacheEntry>;
        const now = Date.now();
        for (const [jid, entry] of Object.entries(parsed || {})) {
          if (!entry || typeof entry.fetchedAt !== "number") continue;
          const ttl = entry.url ? PIC_OK_TTL : PIC_NULL_TTL;
          if (now - entry.fetchedAt < ttl) {
            profilePicCacheRef.current.set(jid, entry);
          }
        }
      }
    } catch { /* ignore */ }
  }

  const persistPicCache = useCallback(() => {
    try {
      const obj: Record<string, PicCacheEntry> = {};
      const now = Date.now();
      // Limita tamanho: só entradas recentes com URL (ou null recente)
      for (const [jid, entry] of profilePicCacheRef.current.entries()) {
        const ttl = entry.url ? PIC_OK_TTL : PIC_NULL_TTL;
        if (now - entry.fetchedAt < ttl) obj[jid] = entry;
      }
      const keys = Object.keys(obj);
      if (keys.length > 400) {
        // Mantém as 400 mais recentes
        const sorted = keys.sort((a, b) => (obj[b].fetchedAt - obj[a].fetchedAt));
        const trimmed: Record<string, PicCacheEntry> = {};
        for (const k of sorted.slice(0, 400)) trimmed[k] = obj[k];
        localStorage.setItem(PIC_LS_KEY, JSON.stringify(trimmed));
      } else {
        localStorage.setItem(PIC_LS_KEY, JSON.stringify(obj));
      }
    } catch { /* quota / private mode */ }
  }, []);

  // Overlay nomes capturados (self_introduced/OCR/user_confirmed) sobre o pushName
  // do WhatsApp para que a sidebar e o header reflitam o nome real do lead.
  const refreshCustomerNames = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("customers")
        .select("name, name_source, phone_whatsapp")
        .in("name_source", Array.from(TRUSTED_NAME_SOURCES))
        .not("name", "is", null)
        .limit(5000);
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

      const now = Date.now();
      // Já veio foto no list_chats / contacts → grava no cache (evita re-fetch)
      for (const c of mapped) {
        if (c.profilePicUrl) {
          const prev = cache.get(c.remoteJid);
          if (!prev?.url || prev.url !== c.profilePicUrl) {
            cache.set(c.remoteJid, { url: c.profilePicUrl, fetchedAt: now });
          }
        }
      }

      const missingPics = mapped
        .filter((c) => {
          const targetJid = c.sendTargetJid || c.remoteJid;
          if (!canFetchProfilePicture(targetJid)) return false;
          if (c.profilePicUrl) return false;
          const cached = cache.get(c.remoteJid);
          if (cached?.url) return false;
          // null recente = sem foto / privado — não martela a API
          if (cached && !cached.url && now - cached.fetchedAt < PIC_NULL_TTL) return false;
          return true;
        })
        .slice(0, PIC_BATCH_SIZE);

      if (missingPics.length > 0 && (isWhapi || instanceName) && now >= globalPicPauseUntilRef.current) {
        fetchingPicsRef.current = true;
        // Concorrência 2: mais rápido que 1, ainda seguro p/ Whapi/Evolution
        processWithConcurrency(missingPics, 2, async (chat) => {
          const targetJid = chat.sendTargetJid || chat.remoteJid;
          try {
            const picUrl = isWhapi
              ? await whapiGetProfilePicture(targetJid)
              : await getProfilePicture(instanceName!, targetJid);
            cache.set(chat.remoteJid, { url: picUrl || null, fetchedAt: Date.now() });
            return { jid: chat.remoteJid, picUrl };
          } catch {
            // Erro de rede/API — TTL curto (não trata como "sem foto")
            cache.set(chat.remoteJid, { url: null, fetchedAt: Date.now() - (PIC_NULL_TTL - 60_000) });
            return { jid: chat.remoteJid, picUrl: null };
          }
        }).then((results) => {
          const picMap = new Map(
            results.filter((r) => r.picUrl).map((r) => [r.jid, r.picUrl!])
          );
          if (picMap.size > 0) {
            consecutiveNullRoundsRef.current = 0;
            setChats((prev) =>
              prev.map((c) => (picMap.has(c.remoteJid) ? { ...c, profilePicUrl: picMap.get(c.remoteJid) } : c))
            );
          } else {
            // Rodada inteira null: pode ser LID/privado OU rate-limit.
            // Só pausa após 2 rodadas seguidas (não trava a lista no 1º ciclo).
            consecutiveNullRoundsRef.current += 1;
            if (consecutiveNullRoundsRef.current >= 2) {
              globalPicPauseUntilRef.current = Date.now() + GLOBAL_PIC_PAUSE_TTL;
              consecutiveNullRoundsRef.current = 0;
            }
          }
          persistPicCache();
        }).catch(() => { /* non-critical */ })
          .finally(() => { fetchingPicsRef.current = false; });
      } else if (mapped.some((c) => c.profilePicUrl)) {
        persistPicCache();
      }
    } catch {
      // Silently ignore auth / transient errors on polling — next interval will retry
    } finally {
      fetchingChatsRef.current = false;
      setIsLoading(false);
    }
  }, [instanceName, isWhapi, persistPicCache]);

  // Supabase Realtime: patch local do chat afetado (evita refetch completo da API).
  // Fallback com debounce se o contato ainda não estiver na lista.
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleFullFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void fetchChats();
      }, 2000);
    };

    const channel = supabase
      .channel("conversations-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations", filter: "message_direction=eq.inbound" },
        (payload) => {
          const msg = payload.new as {
            message_text?: string | null;
            customer_id?: string;
            created_at?: string;
          };
          if (!msg.message_text) return;

          toast({
            title: "💬 Nova mensagem recebida",
            description: msg.message_text.slice(0, 80),
          });
          setNewMessageAlert(true);

          const preview = msg.message_text.slice(0, 120);
          const ts = msg.created_at
            ? Math.floor(new Date(msg.created_at).getTime() / 1000)
            : Math.floor(Date.now() / 1000);

          void (async () => {
            let phoneDigits = "";
            if (msg.customer_id) {
              try {
                const { data } = await supabase
                  .from("customers")
                  .select("phone_whatsapp")
                  .eq("id", msg.customer_id)
                  .maybeSingle();
                phoneDigits = digitsOnly(data?.phone_whatsapp);
              } catch {
                /* fallback abaixo */
              }
            }

            let patched = false;
            if (phoneDigits) {
              setChats((prev) => {
                const idx = prev.findIndex((c) => {
                  const d = digitsOnly((c.sendTargetJid || c.remoteJid).split("@")[0]);
                  if (!d) return false;
                  return d === phoneDigits || d.endsWith(phoneDigits) || phoneDigits.endsWith(d);
                });
                if (idx < 0) return prev;
                patched = true;
                const current = prev[idx];
                const updated: ChatItem = {
                  ...current,
                  lastMessage: preview,
                  lastMessageTimestamp: Math.max(current.lastMessageTimestamp || 0, ts),
                  unreadCount: (current.unreadCount || 0) + 1,
                };
                const rest = prev.filter((_, i) => i !== idx);
                return [updated, ...rest];
              });
            }

            if (!patched) scheduleFullFetch();
          })();
        },
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
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
