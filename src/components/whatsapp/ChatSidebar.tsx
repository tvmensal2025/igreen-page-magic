import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Search, MessageCirclePlus, X, Users, Handshake } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import type { ChatItem } from "@/hooks/useChats";
import { AutomacoesAtivasBadge } from "@/features/produtos/acompanhamento/AutomacoesAtivasBadge";
import { stripWhatsAppMarkup } from "@/lib/whatsapp/formatWhatsAppText";
import { normalizePhone } from "./customerUtils";
import { VirtualList } from "@/components/ui/VirtualList";

interface CustomerResult {
  name: string | null;
  phone_whatsapp: string;
}

interface ChatSidebarProps {
  chats: ChatItem[];
  isLoading: boolean;
  selectedJid: string | null;
  onSelectChat: (jid: string) => void;
  consultantId?: string;
}

type PartnerJoin = { nome?: string | null } | { nome?: string | null }[] | null;

/** Telefone real do chat (ignora @lid sem sendTarget). */
function chatPhoneDigits(chat: ChatItem): string | null {
  const jid =
    chat.sendTargetJid && chat.sendTargetJid.endsWith("@s.whatsapp.net")
      ? chat.sendTargetJid
      : !chat.remoteJid.endsWith("@lid")
        ? chat.remoteJid
        : null;
  if (!jid) return null;
  const digits = jid.split("@")[0].replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

function phoneLookupKeys(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return [];
  const keys = new Set<string>();
  keys.add(digits);
  keys.add(digits.slice(-9));
  const normalized = normalizePhone(digits);
  if (normalized) {
    keys.add(normalized);
    keys.add(normalized.slice(-9));
  }
  if (digits.startsWith("55") && digits.length >= 12) keys.add(digits.slice(2));
  else if (!digits.startsWith("55") && digits.length >= 10) keys.add(`55${digits}`);
  return Array.from(keys).filter((k) => k.length >= 9);
}

function partnerNomeFromJoin(rel: PartnerJoin): string | null {
  const nome = Array.isArray(rel) ? rel[0]?.nome : rel?.nome;
  return (nome && String(nome).trim()) || null;
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function ChatSidebar({ chats, isLoading, selectedJid, onSelectChat, consultantId }: ChatSidebarProps) {
  const [search, setSearch] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const newPhoneRef = useRef<HTMLInputElement>(null);
  const [customerResults, setCustomerResults] = useState<CustomerResult[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** remoteJid → nome do parceiro (só leads com referral_partner_id). */
  const [partnerByJid, setPartnerByJid] = useState<Record<string, string>>({});

  useEffect(() => {
    if (showNewChat) {
      setTimeout(() => newPhoneRef.current?.focus(), 100);
    }
  }, [showNewChat]);

  // Enrich conversas com flag de parceiro (batch por telefones da lista).
  useEffect(() => {
    if (!consultantId || chats.length === 0) {
      setPartnerByJid({});
      return;
    }

    let cancelled = false;
    const phoneToJids = new Map<string, string[]>();
    const queryPhones = new Set<string>();

    for (const chat of chats) {
      if (chat.isGroup) continue;
      const phone = chatPhoneDigits(chat);
      if (!phone) continue;
      // Só variantes “completas” no .in() — cauda de 9 dígitos serve só no match local.
      const forQuery = phoneLookupKeys(phone).filter((k) => k.length >= 10);
      for (const key of forQuery) {
        queryPhones.add(key);
      }
      for (const key of phoneLookupKeys(phone)) {
        const list = phoneToJids.get(key) || [];
        if (!list.includes(chat.remoteJid)) list.push(chat.remoteJid);
        phoneToJids.set(key, list);
      }
    }

    const candidates = Array.from(queryPhones);
    if (candidates.length === 0) {
      setPartnerByJid({});
      return;
    }

    (async () => {
      const next: Record<string, string> = {};
      // Chunk evita URL longa no .in() do PostgREST.
      const CHUNK = 80;
      for (let i = 0; i < candidates.length; i += CHUNK) {
        const slice = candidates.slice(i, i + CHUNK);
        const { data } = await supabase
          .from("customers")
          .select("phone_whatsapp, referral_partner_id, referral_partners(nome)")
          .eq("consultant_id", consultantId)
          .not("referral_partner_id", "is", null)
          .in("phone_whatsapp", slice);
        if (cancelled) return;
        for (const row of data || []) {
          const nome =
            partnerNomeFromJoin(
              (row as { referral_partners?: PartnerJoin }).referral_partners ?? null,
            ) || "Parceiro";
          for (const key of phoneLookupKeys(String(row.phone_whatsapp || ""))) {
            for (const jid of phoneToJids.get(key) || []) {
              next[jid] = nome;
            }
          }
        }
      }
      if (!cancelled) setPartnerByJid(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [chats, consultantId]);

  // Search customers from DB when search has 3+ chars
  const searchCustomers = useCallback(async (query: string) => {
    if (!consultantId || query.length < 3) { setCustomerResults([]); return; }
    try {
      const { data } = await supabase
        .from("customers")
        .select("name, phone_whatsapp")
        .eq("consultant_id", consultantId)
        .or(`name.ilike.%${query}%,phone_whatsapp.ilike.%${query}%`)
        .limit(5);
      setCustomerResults(data || []);
    } catch {
      setCustomerResults([]);
    }
  }, [consultantId]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => searchCustomers(search), 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search, searchCustomers]);

  const handleStartNewChat = () => {
    const clean = newPhone.replace(/\D/g, "");
    if (clean.length < 10) return;
    const phone = clean.startsWith("55") ? clean : `55${clean}`;
    const jid = `${phone}@s.whatsapp.net`;
    onSelectChat(jid);
    setNewPhone("");
    setShowNewChat(false);
  };

  const handleStartChatFromCustomer = (phone: string) => {
    const clean = phone.replace(/\D/g, "");
    const normalized = clean.startsWith("55") ? clean : `55${clean}`;
    const jid = `${normalized}@s.whatsapp.net`;
    onSelectChat(jid);
    setSearch("");
    setCustomerResults([]);
  };

  const filtered = useMemo(
    () =>
      chats.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.remoteJid.includes(search),
      ),
    [chats, search],
  );

  return (
    <div className="flex flex-col h-full min-h-0 border-r border-border/60 bg-card">
      {/* Header */}
      <div className="px-3 h-10 border-b border-border/60 flex items-center justify-between shrink-0 bg-gradient-to-b from-card to-card/50">
        <h3 className="font-semibold text-foreground text-xs tracking-wide flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-primary" />
          Conversas
        </h3>
        <div className="flex items-center gap-1.5">
          <AutomacoesAtivasBadge consultantId={consultantId} variant="dot" />
          <button
            onClick={() => setShowNewChat((v) => !v)}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all hover:scale-105"
            title="Nova conversa"
          >
            <MessageCirclePlus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* New chat input */}
      {showNewChat && (
        <div className="p-2 border-b border-border/60 bg-primary/5">
          <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">Nova conversa — digite o número:</p>
          <div className="flex gap-1.5">
            <Input
              ref={newPhoneRef}
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="(11) 99999-9999"
              className="h-8 text-xs flex-1 bg-background border-border/60 rounded-lg focus-visible:ring-primary/40"
              onKeyDown={(e) => e.key === "Enter" && handleStartNewChat()}
            />
            <button
              onClick={handleStartNewChat}
              className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-all shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/30"
            >
              Iniciar
            </button>
            <button
              onClick={() => { setShowNewChat(false); setNewPhone(""); }}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-secondary transition-colors"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-2 py-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs bg-muted/40 border border-border/40 rounded-full focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:bg-background transition-all"
          />
        </div>
      </div>

      {/* Customer search results from DB */}
      {customerResults.length > 0 && (
        <div className="border-b border-border/60 shrink-0 bg-primary/[0.03]">
          <p className="text-[10px] text-muted-foreground px-3 pt-1.5 pb-1 flex items-center gap-1 font-semibold uppercase tracking-wider">
            <Users className="h-3 w-3" /> Clientes encontrados
          </p>
          {customerResults.map((cr) => (
            <button
              key={cr.phone_whatsapp}
              onClick={() => handleStartChatFromCustomer(cr.phone_whatsapp)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-primary/10"
            >
              <Avatar className="h-7 w-7 shrink-0 ring-1 ring-primary/20">
                <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                  {(cr.name || "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <span className="text-xs font-medium text-foreground truncate block sensitive-name">{cr.name || cr.phone_whatsapp}</span>
                <span className="text-[10px] text-muted-foreground sensitive-phone">{cr.phone_whatsapp}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Chat list — virtualizada (só DOM dos itens visíveis) */}
      <div className="flex-1 min-h-0">
        {isLoading && chats.length === 0 && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Carregando conversas...
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Nenhuma conversa encontrada
          </div>
        )}
        {filtered.length > 0 && (
          <VirtualList
            items={filtered}
            estimateSize={68}
            overscan={10}
            height="100%"
            getItemKey={(chat) => chat.remoteJid}
            renderItem={(chat) => {
              const isSelected = selectedJid === chat.remoteJid;
              const hasUnread = chat.unreadCount > 0;
              const partnerNome = partnerByJid[chat.remoteJid];
              return (
                <button
                  onClick={() => onSelectChat(chat.remoteJid)}
                  className={`relative w-full flex items-center gap-2.5 px-2.5 py-2.5 text-left transition-all ${
                    isSelected
                      ? "bg-primary/8 hover:bg-primary/10"
                      : "hover:bg-muted/50"
                  }`}
                >
                  {isSelected && (
                    <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary" />
                  )}
                  <Avatar className={`h-10 w-10 shrink-0 transition-all ${hasUnread ? "ring-2 ring-primary/40 ring-offset-1 ring-offset-card" : partnerNome ? "ring-2 ring-amber-500/35 ring-offset-1 ring-offset-card" : "ring-1 ring-border/40"}`}>
                    <AvatarImage
                      src={chat.profilePicUrl}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary text-[10px] font-bold">
                      {chat.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[13px] truncate sensitive-name flex items-center gap-1 min-w-0 ${hasUnread ? "font-bold text-foreground" : "font-medium text-foreground/90"}`}>
                        <span className="truncate">{chat.name}</span>
                        {partnerNome && (
                          <Handshake
                            className="h-3 w-3 shrink-0 text-amber-800"
                            aria-label={`Parceiro: ${partnerNome}`}
                          />
                        )}
                      </span>
                      <span className={`text-[10px] shrink-0 ${hasUnread ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                        {formatTime(chat.lastMessageTimestamp)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className={`text-[11px] truncate ${hasUnread ? "text-foreground/80" : "text-muted-foreground"}`}>
                        {stripWhatsAppMarkup(chat.lastMessage || "") || "..."}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {partnerNome && (
                          <span
                            className="text-[9px] font-bold uppercase tracking-wide text-amber-950 bg-amber-100 border border-amber-600/35 rounded px-1 py-px"
                            title={`Indicação de ${partnerNome} — acompanha as etapas do cadastro`}
                          >
                            Indicação
                          </span>
                        )}
                        {hasUnread && (
                          <span className="bg-primary text-primary-foreground text-[10px] rounded-full h-[18px] min-w-[18px] flex items-center justify-center px-1.5 shrink-0 font-bold shadow-sm shadow-primary/30">
                            {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </button>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
