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

type ChatEnrichment = {
  /** Mesma regra da Captação: welcome enviado e atendimento ainda não finalizado. */
  inAttendance: boolean;
  partnerNome: string | null;
};

/** Atendimento ativo = welcome enviado e ainda não finalizado (igual Captação). */
function isInAttendance(row: {
  welcome_sent_at?: string | null;
  attendance_ended_at?: string | null;
}): boolean {
  return !!row.welcome_sent_at && !row.attendance_ended_at;
}

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
  /** remoteJid → atendimento ativo + nome do parceiro. */
  const [enrichByJid, setEnrichByJid] = useState<Record<string, ChatEnrichment>>({});
  const [listTab, setListTab] = useState<"atendimento" | "espera">(() => {
    try {
      const v = localStorage.getItem("wa_chat_list_tab");
      return v === "espera" ? "espera" : "atendimento";
    } catch {
      return "atendimento";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("wa_chat_list_tab", listTab);
    } catch { /* ignore */ }
  }, [listTab]);

  useEffect(() => {
    if (showNewChat) {
      setTimeout(() => newPhoneRef.current?.focus(), 100);
    }
  }, [showNewChat]);

  // Enrich: atendimento (welcome/ended) + parceiro — mesma regra da Captação.
  useEffect(() => {
    if (!consultantId || chats.length === 0) {
      setEnrichByJid({});
      return;
    }

    let cancelled = false;
    const phoneToJids = new Map<string, string[]>();
    const queryPhones = new Set<string>();

    for (const chat of chats) {
      if (chat.isGroup) continue;
      const phone = chatPhoneDigits(chat);
      if (!phone) continue;
      const forQuery = phoneLookupKeys(phone).filter((k) => k.length >= 10);
      for (const key of forQuery) queryPhones.add(key);
      for (const key of phoneLookupKeys(phone)) {
        const list = phoneToJids.get(key) || [];
        if (!list.includes(chat.remoteJid)) list.push(chat.remoteJid);
        phoneToJids.set(key, list);
      }
    }

    const candidates = Array.from(queryPhones);
    if (candidates.length === 0) {
      setEnrichByJid({});
      return;
    }

    (async () => {
      const next: Record<string, ChatEnrichment> = {};
      const CHUNK = 80;
      for (let i = 0; i < candidates.length; i += CHUNK) {
        const slice = candidates.slice(i, i + CHUNK);
        const { data } = await supabase
          .from("customers")
          .select(
            "phone_whatsapp, welcome_sent_at, attendance_ended_at, referral_partner_id, referral_partners(nome)",
          )
          .eq("consultant_id", consultantId)
          .in("phone_whatsapp", slice);
        if (cancelled) return;
        for (const row of data || []) {
          const nome = row.referral_partner_id
            ? partnerNomeFromJoin(
                (row as { referral_partners?: PartnerJoin }).referral_partners ?? null,
              ) || "Parceiro"
            : null;
          const attending = isInAttendance(
            row as { welcome_sent_at?: string | null; attendance_ended_at?: string | null },
          );
          for (const key of phoneLookupKeys(String(row.phone_whatsapp || ""))) {
            for (const jid of phoneToJids.get(key) || []) {
              const prev = next[jid];
              next[jid] = {
                inAttendance: prev?.inAttendance || attending,
                partnerNome: prev?.partnerNome || nome,
              };
            }
          }
        }
      }
      if (!cancelled) setEnrichByJid(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [chats, consultantId]);

  const searchCustomers = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!consultantId || trimmed.length < 2) { setCustomerResults([]); return; }
    try {
      const digits = trimmed.replace(/\D/g, "");
      const orParts = [`name.ilike.%${trimmed}%`];
      if (digits.length >= 4) {
        orParts.push(`phone_whatsapp.ilike.%${digits}%`);
        // 9º dígito BR: tenta com e sem
        if (digits.startsWith("55") && digits.length >= 12) {
          const ddd = digits.slice(2, 4);
          const rest = digits.slice(4);
          if (rest.length === 9 && rest.startsWith("9")) {
            orParts.push(`phone_whatsapp.ilike.%55${ddd}${rest.slice(1)}%`);
          } else if (rest.length === 8) {
            orParts.push(`phone_whatsapp.ilike.%55${ddd}9${rest}%`);
          }
        }
      }
      const { data } = await supabase
        .from("customers")
        .select("name, phone_whatsapp")
        .eq("consultant_id", consultantId)
        .or(orParts.join(","))
        .limit(8);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = search.replace(/\D/g, "");
    if (!q && qDigits.length < 4) return chats;
    return chats.filter((c) => {
      if (q && c.name.toLowerCase().includes(q)) return true;
      if (q && c.remoteJid.toLowerCase().includes(q)) return true;
      if (qDigits.length >= 4) {
        const chatDigits = (c.sendTargetJid || c.remoteJid).split("@")[0].replace(/\D/g, "");
        if (
          chatDigits.includes(qDigits) ||
          qDigits.includes(chatDigits) ||
          chatDigits.slice(-9) === qDigits.slice(-9)
        ) {
          return true;
        }
      }
      return false;
    });
  }, [chats, search]);

  const emAtendimento = useMemo(
    () => filtered.filter((c) => !!enrichByJid[c.remoteJid]?.inAttendance),
    [filtered, enrichByJid],
  );
  const emEspera = useMemo(
    () => filtered.filter((c) => !enrichByJid[c.remoteJid]?.inAttendance),
    [filtered, enrichByJid],
  );

  const unreadByTab = useMemo(() => {
    let atend = 0;
    let esp = 0;
    for (const c of filtered) {
      const n = c.unreadCount || 0;
      if (n <= 0) continue;
      if (enrichByJid[c.remoteJid]?.inAttendance) atend += n;
      else esp += n;
    }
    return { atend, esp };
  }, [filtered, enrichByJid]);

  /** Com busca ativa, ignora aba — lead fechado costuma estar em "Em espera". */
  const isSearching = search.trim().length >= 2;
  const visibleChats = isSearching
    ? filtered
    : listTab === "atendimento"
      ? emAtendimento
      : emEspera;

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

      {/* Search + abas Em atendimento / Em espera (padrão WA Business / Captação) */}
      <div className="px-2 py-2 shrink-0 space-y-2 border-b border-border/40">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs bg-muted/40 border border-border/40 rounded-full focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:bg-background transition-all"
          />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-0.5">
          {([
            {
              key: "atendimento" as const,
              label: "Em atendimento",
              count: emAtendimento.length,
              unread: unreadByTab.atend,
              live: emAtendimento.length > 0,
            },
            {
              key: "espera" as const,
              label: "Em espera",
              count: emEspera.length,
              unread: unreadByTab.esp,
              live: false,
            },
          ]).map((t) => {
            const active = listTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setListTab(t.key)}
                className={`relative flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-semibold transition ${
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.live && active && (
                  <span className="relative inline-flex w-1.5 h-1.5">
                    <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                    <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </span>
                )}
                <span className="truncate">{t.label}</span>
                <span
                  className={`text-[10px] tabular-nums font-bold px-1.5 py-px rounded-full ${
                    active
                      ? "bg-primary/15 text-primary"
                      : "bg-background/80 text-muted-foreground border border-border/60"
                  }`}
                >
                  {t.count}
                </span>
                {t.unread > 0 && (
                  <span className="text-[9px] tabular-nums font-bold text-primary-foreground bg-primary min-w-[14px] h-[14px] px-1 rounded-full flex items-center justify-center">
                    {t.unread > 9 ? "9+" : t.unread}
                  </span>
                )}
              </button>
            );
          })}
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

      {/* Chat list — virtualizada */}
      <div className="flex-1 min-h-0">
        {isLoading && chats.length === 0 && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Carregando conversas...
          </div>
        )}
        {!isLoading && visibleChats.length === 0 && (
          <div className="p-6 text-center space-y-1">
            <p className="text-xs font-medium text-foreground">
              {isSearching
                ? "Nenhuma conversa com esse termo"
                : listTab === "atendimento"
                  ? "Ninguém em atendimento"
                  : "Nenhuma conversa em espera"}
            </p>
            <p className="text-[11px] text-muted-foreground max-w-[220px] mx-auto">
              {isSearching
                ? "Lead fechado pode estar em Em espera — a busca já olha todas as abas. Confira também Clientes encontrados acima ou use o + para abrir pelo telefone."
                : listTab === "atendimento"
                  ? "Quem tiver atendimento aberto (welcome enviado) aparece aqui — igual Captação."
                  : "Novas conversas e leads sem atendimento ativo ficam nesta fila."}
            </p>
          </div>
        )}
        {visibleChats.length > 0 && (
          <VirtualList
            items={visibleChats}
            estimateSize={68}
            overscan={10}
            height="100%"
            getItemKey={(chat) => chat.remoteJid}
            renderItem={(chat) => {
              const isSelected = selectedJid === chat.remoteJid;
              const hasUnread = chat.unreadCount > 0;
              const partnerNome = enrichByJid[chat.remoteJid]?.partnerNome || null;
              const attending = !!enrichByJid[chat.remoteJid]?.inAttendance;
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
                  <Avatar
                    className={`h-10 w-10 shrink-0 transition-all ${
                      hasUnread
                        ? "ring-2 ring-primary/40 ring-offset-1 ring-offset-card"
                        : partnerNome
                          ? "ring-2 ring-amber-500/35 ring-offset-1 ring-offset-card"
                          : attending
                            ? "ring-2 ring-emerald-500/30 ring-offset-1 ring-offset-card"
                            : "ring-1 ring-border/40"
                    }`}
                  >
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
