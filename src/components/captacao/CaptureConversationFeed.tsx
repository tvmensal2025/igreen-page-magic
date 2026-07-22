import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import {
  MessageCircle, Mic, ImageIcon, Video, FileText, Loader2,
  Check, CheckCheck, Clock, XCircle, MoreVertical, Copy, Bookmark,
} from "lucide-react";
import { useCaptureAttach } from "@/hooks/useCaptureAttach";
import {
  ConversationMessageBody,
  CONVERSATION_MESSAGE_SELECT,
  type ConversationMessageRow,
} from "@/components/whatsapp/ConversationMessageBody";
import { getTemplate } from "@/lib/multichannelCadenceTexts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SaveMessageAsTemplateDialog } from "@/components/whatsapp/SaveMessageAsTemplateDialog";
import type { ChatMessage } from "@/hooks/useMessages";
import { toast } from "sonner";

interface Props {
  customerId: string;
  consultantId?: string;
  /** Quantas mensagens exibir. Default 50. */
  limit?: number;
  /** Modo Performance: borda dourada + selo AO VIVO + título destacado */
  gameOn?: boolean;
}

interface ConvRow extends ConversationMessageRow {
  delivery_status: string | null;
  delivery_error: string | null;
  slot_key: string | null;
}

function iconFor(type: string | null) {
  switch ((type || "").toLowerCase()) {
    case "audio": return <Mic className="w-3 h-3" />;
    case "image": return <ImageIcon className="w-3 h-3" />;
    case "video": return <Video className="w-3 h-3" />;
    case "document": return <FileText className="w-3 h-3" />;
    default: return <MessageCircle className="w-3 h-3" />;
  }
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Hoje";
  if (same(d, yesterday)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function sortRows(rows: ConvRow[], limit: number) {
  return [...rows]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-limit);
}

function buttonsForSlot(slotKey: string | null | undefined): { id: string; title: string }[] {
  if (!slotKey) return [];
  const key = String(slotKey).trim();
  const direct = getTemplate(key);
  if (direct?.buttons?.length) {
    return direct.buttons.map((b) => ({ id: b.id, title: b.title }));
  }
  // Fallbacks comuns Sofia A3/A5
  for (const alt of [
    key.replace(/__body.*$/, ""),
    key.replace(/_audio_.*$/, ""),
  ]) {
    if (alt === key) continue;
    const t = getTemplate(alt);
    if (t?.buttons?.length) return t.buttons.map((b) => ({ id: b.id, title: b.title }));
  }
  return [];
}

const SELECT_COLS = `${CONVERSATION_MESSAGE_SELECT}, delivery_status, delivery_error, slot_key`;

function DeliveryIcon({ status, error }: { status: string | null; error: string | null }) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "failed" || s === "error") {
    return (
      <span title={error || "Falha na entrega"} className="inline-flex">
        <XCircle className="h-3 w-3 text-red-400" />
      </span>
    );
  }
  if (s === "read" || s === "played") return <CheckCheck className="h-3 w-3 text-primary" />;
  if (s === "delivered" || s === "delivery_ack") return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
  if (s === "sent" || s === "server_ack") return <Check className="h-3 w-3 text-muted-foreground" />;
  if (s === "pending") return <Clock className="h-3 w-3 text-muted-foreground/70" />;
  return null;
}

type FeedItem =
  | { kind: "day"; id: string; label: string }
  | { kind: "new"; id: string }
  | { kind: "msg"; id: string; row: ConvRow; out: boolean };

export function CaptureConversationFeed({ customerId, consultantId, limit = 50, gameOn = false }: Props) {
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastInbound, setLastInbound] = useState<{
    url: string | null;
    messageId: string | null;
    kind: string | null;
  }>({ url: null, messageId: null, kind: null });
  const [saveMsg, setSaveMsg] = useState<ChatMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastPinnedIdRef = useRef<string | null>(null);
  /** ISO do momento em que a conversa foi aberta — separa "novas mensagens" das já vistas */
  const openedAtRef = useRef<string>(new Date().toISOString());
  const { attachMediaToCapture } = useCaptureAttach();

  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    rows.forEach((r, idx) => {
      const out = r.message_direction === "outbound";
      const showDay = idx === 0 || dayLabel(r.created_at) !== dayLabel(rows[idx - 1].created_at);
      if (showDay) {
        items.push({ kind: "day", id: `day-${r.created_at.slice(0, 10)}-${idx}`, label: dayLabel(r.created_at) });
      }
      const prev = rows[idx - 1];
      const isNewSince =
        !out &&
        r.created_at > openedAtRef.current &&
        (!prev || !(prev.message_direction !== "outbound" && prev.created_at > openedAtRef.current));
      if (isNewSince) {
        items.push({ kind: "new", id: `new-${r.id}` });
      }
      items.push({ kind: "msg", id: r.id, row: r, out });
    });
    return items;
  }, [rows]);

  const rowVirtualizer = useVirtualizer({
    count: feedItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    overscan: 10,
    getItemKey: (index) => feedItems[index]?.id ?? index,
  });

  const pinToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const scheduleScrollToBottom = useCallback((force = false) => {
    if (!force && !stickRef.current) return;
    pinToBottom();
    requestAnimationFrame(() => {
      pinToBottom();
      requestAnimationFrame(pinToBottom);
    });
    window.setTimeout(pinToBottom, 80);
    window.setTimeout(pinToBottom, 240);
  }, [pinToBottom]);

  useEffect(() => {
    stickRef.current = true;
    openedAtRef.current = new Date().toISOString();
    setHasMore(true);
    lastPinnedIdRef.current = null;
    scheduleScrollToBottom(true);
  }, [customerId, scheduleScrollToBottom]);

  useEffect(() => {
    let mounted = true;
    const loadCustomerMeta = async () => {
      const { data } = await supabase
        .from("customers")
        .select("last_inbound_media_url, last_inbound_media_message_id, last_inbound_media_kind")
        .eq("id", customerId)
        .maybeSingle();
      if (!mounted || !data) return;
      setLastInbound({
        url: (data as any).last_inbound_media_url || null,
        messageId: (data as any).last_inbound_media_message_id || null,
        kind: (data as any).last_inbound_media_kind || null,
      });
    };
    void loadCustomerMeta();
    const onDocs = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { customerId?: string } | undefined;
      if (detail?.customerId && detail.customerId !== customerId) return;
      void loadCustomerMeta();
    };
    window.addEventListener("captacao:docs-updated", onDocs);
    const channel = supabase
      .channel(`captacao-feed-last-inbound-${customerId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "customers", filter: `id=eq.${customerId}` },
        () => { void loadCustomerMeta(); },
      )
      .subscribe();
    return () => {
      mounted = false;
      window.removeEventListener("captacao:docs-updated", onDocs);
      void supabase.removeChannel(channel);
    };
  }, [customerId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || rows.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = rows[0]?.created_at;
      if (!oldest) return;
      const { data } = await supabase
        .from("conversations")
        .select(SELECT_COLS)
        .eq("customer_id", customerId)
        .lt("created_at", oldest)
        .not("message_text", "like", "[__safety_ping__]%")
        .not("message_text", "like", "[inline-sent]%")
        .not("message_text", "like", "[failed:%")
        .order("created_at", { ascending: false })
        .limit(50);
      const older = ((data as ConvRow[]) || []).reverse();
      if (older.length === 0) {
        setHasMore(false);
        return;
      }
      const el = scrollRef.current;
      const prevHeight = el?.scrollHeight || 0;
      const prevTop = el?.scrollTop || 0;
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const merged = [...older.filter((r) => !seen.has(r.id)), ...prev];
        return merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });
      requestAnimationFrame(() => {
        const el2 = scrollRef.current;
        if (!el2) return;
        const delta = el2.scrollHeight - prevHeight;
        el2.scrollTop = prevTop + delta;
      });
    } finally {
      setLoadingMore(false);
    }
  }, [customerId, rows, hasMore, loadingMore]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("conversations")
        .select(SELECT_COLS)
        .eq("customer_id", customerId)
        .not("message_text", "like", "[__safety_ping__]%")
        .not("message_text", "like", "[inline-sent]%")
        .not("message_text", "like", "[failed:%")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!mounted) return;

      setRows(sortRows((data as ConvRow[]) || [], limit));
      setLoading(false);
    };
    void load();

    const ch = supabase
      .channel(`conv-feed-${customerId}-${Math.random().toString(36).slice(2, 6)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations", filter: `customer_id=eq.${customerId}` },
        (payload) => {
          const row = payload.new as ConvRow;
          const txt = (row as any)?.message_text ?? "";
          if (typeof txt === "string" && (
            txt.startsWith("[__safety_ping__]") ||
            txt.startsWith("[inline-sent]") ||
            txt.startsWith("[failed:")
          )) return;
          setRows((prev) => sortRows([...prev, row], limit));
        },
      )
      .subscribe();

    const poll = window.setInterval(load, 8000);

    return () => {
      mounted = false;
      window.clearInterval(poll);
      void supabase.removeChannel(ch);
    };
  }, [customerId, limit]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const d = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickRef.current = d < 80;
      if (el.scrollTop < 60 && hasMore && !loadingMore) {
        void loadMore();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMore, loadingMore, loadMore]);

  const lastMsgId = rows.length > 0 ? rows[rows.length - 1]?.id ?? null : null;
  useLayoutEffect(() => {
    if (!lastMsgId || lastPinnedIdRef.current === lastMsgId) return;
    lastPinnedIdRef.current = lastMsgId;
    if (!stickRef.current) return;
    pinToBottom();
    requestAnimationFrame(pinToBottom);
  }, [lastMsgId, pinToBottom]);

  const openSaveTemplate = (row: ConvRow) => {
    if (!consultantId) return;
    const msg: ChatMessage = {
      id: row.id,
      remoteJid: "",
      fromMe: true,
      text: row.message_text || "",
      timestamp: Math.floor(new Date(row.created_at).getTime() / 1000),
      mediaType: (["image", "audio", "video", "document", "sticker"].includes(String(row.message_type || ""))
        ? (row.message_type as ChatMessage["mediaType"])
        : undefined),
      whapiMediaId: row.media_id || undefined,
    };
    setSaveMsg(msg);
  };

  return (
    <div className={`rounded-lg overflow-hidden flex flex-col min-h-0 flex-1 ${gameOn ? "border exec-border-gold bg-card/40" : "border border-border bg-card/30"}`}>
      <div className={`px-2.5 py-1.5 border-b flex items-center justify-between shrink-0 ${gameOn ? "border-warning/25 bg-gradient-to-r from-warning/10 via-card/40 to-transparent" : "border-border/60 bg-muted/30"}`}>
        <span className={`flex items-center gap-1.5 ${gameOn ? "text-[12px] font-black uppercase tracking-widest text-warning" : "text-[10px] font-bold uppercase tracking-wide text-muted-foreground"}`}>
          {gameOn && <span className="inline-block w-1.5 h-1.5 rounded-full bg-destructive/100 exec-live-dot" aria-hidden />}
          <MessageCircle className={`${gameOn ? "w-3.5 h-3.5 text-warning" : "w-3 h-3 text-primary"}`} />
          Conversa ao vivo
          {gameOn && <span className="ml-1 px-1.5 py-0 rounded text-[9px] font-black bg-destructive/20 text-destructive border border-destructive/40 tracking-wider">AO VIVO</span>}
        </span>
        <span className={`tabular-nums ${gameOn ? "text-[10px] font-bold text-warning/80" : "text-[9px] text-muted-foreground"}`}>{rows.length}</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-[140px] overflow-y-auto p-2.5 bg-muted/40">
        {!loading && rows.length > 0 && (
          <div className="flex items-center justify-center py-1 mb-1">
            {hasMore ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground bg-secondary/60 hover:bg-secondary rounded-full px-2.5 py-1 transition disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {loadingMore ? "Carregando…" : "Carregar mensagens anteriores"}
              </button>
            ) : (
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">início da conversa</span>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-4 text-muted-foreground text-[10px] gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> carregando…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center gap-2 px-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-primary/60" />
            </div>
            <p className="text-sm font-medium text-foreground">Nenhuma mensagem ainda</p>
            <p className="text-xs text-muted-foreground max-w-[220px]">
              Envie um passo do roteiro ou escreva uma mensagem abaixo para começar a conversa.
            </p>
          </div>
        )}

        {!loading && feedItems.length > 0 && (
          <div
            style={{ height: rowVirtualizer.getTotalSize(), width: "100%", position: "relative" }}
          >
            {rowVirtualizer.getVirtualItems().map((vItem) => {
              const item = feedItems[vItem.index];
              if (!item) return null;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vItem.start}px)`,
                  }}
                  className="pb-2"
                >
                  {item.kind === "day" && (
                    <div className="flex items-center justify-center my-1">
                      <span className="px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground text-[10px] font-medium border border-border/50">
                        {item.label}
                      </span>
                    </div>
                  )}
                  {item.kind === "new" && (
                    <div className="flex items-center gap-2 my-1" aria-label="Novas mensagens">
                      <span className="flex-1 h-px bg-primary/30" />
                      <span className="text-[9px] uppercase tracking-widest font-bold text-primary">
                        Novas mensagens
                      </span>
                      <span className="flex-1 h-px bg-primary/30" />
                    </div>
                  )}
                  {item.kind === "msg" && (() => {
                    const r = item.row;
                    const out = item.out;
                    const btns = out ? buttonsForSlot(r.slot_key) : [];
                    const canSave = out && !!consultantId && !!(r.message_text || "").trim();
                    return (
                      <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`relative group max-w-[85%] rounded-2xl px-3 py-2 shadow-sm break-words ${
                            out
                              ? "bg-gradient-to-br from-primary/15 to-primary/10 text-foreground rounded-br-md border border-primary/15"
                              : "bg-card text-foreground rounded-bl-md border border-border/60"
                          }`}
                        >
                          {canSave && (
                            <div className="absolute -top-1 -left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className="h-6 w-6 rounded-full bg-background/90 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground"
                                    title="Ações"
                                  >
                                    <MoreVertical className="w-3 h-3" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-44">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      void navigator.clipboard.writeText(r.message_text || "");
                                      toast.success("Texto copiado");
                                    }}
                                  >
                                    <Copy className="w-3.5 h-3.5 mr-2" /> Copiar texto
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openSaveTemplate(r)}>
                                    <Bookmark className="w-3.5 h-3.5 mr-2" /> Salvar template
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                            {iconFor(r.message_type)}
                            <span className="uppercase font-semibold">{out ? "Você" : "Cliente"}</span>
                            <span>·</span>
                            <span className="tabular-nums">{fmtTime(r.created_at)}</span>
                            {r.slot_key && <span className="ml-1 opacity-60 truncate max-w-[100px]">· {r.slot_key}</span>}
                            {out && (
                              <span className="ml-auto inline-flex">
                                <DeliveryIcon status={r.delivery_status} error={r.delivery_error} />
                              </span>
                            )}
                          </div>
                          <ConversationMessageBody
                            row={r}
                            customerId={customerId}
                            lastInbound={lastInbound}
                            showBoleto
                            attachMediaToCapture={attachMediaToCapture}
                            tone="light"
                          />
                          {btns.length > 0 && (
                            <div className="mt-2 flex flex-col gap-1.5">
                              {btns.map((btn) => (
                                <div
                                  key={`${btn.id}-${btn.title}`}
                                  className="rounded-lg border border-primary/25 bg-background/80 px-2.5 py-1.5 text-center text-[12px] font-medium text-primary shadow-sm"
                                  title={btn.id || undefined}
                                  style={{
                                    fontFamily:
                                      'Figtree, system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
                                  }}
                                >
                                  {btn.title}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {saveMsg && consultantId && (
        <SaveMessageAsTemplateDialog
          open={!!saveMsg}
          onOpenChange={(o) => { if (!o) setSaveMsg(null); }}
          message={saveMsg}
          consultantId={consultantId}
          loadedMediaUrl={null}
        />
      )}
    </div>
  );
}
