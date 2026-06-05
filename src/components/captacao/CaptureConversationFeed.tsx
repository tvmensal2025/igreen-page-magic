import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Mic, ImageIcon, Video, FileText, Loader2 } from "lucide-react";

interface Props {
  customerId: string;
  /** Quantas mensagens exibir. Default 12. */
  limit?: number;
  /** Modo Performance: borda dourada + selo AO VIVO + título destacado */
  gameOn?: boolean;
}


interface ConvRow {
  id: string;
  message_direction: string;
  message_text: string | null;
  message_type: string | null;
  created_at: string;
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

function sortRows(rows: ConvRow[], limit: number) {
  return [...rows]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-limit);
}

export function CaptureConversationFeed({ customerId, limit = 12, gameOn = false }: Props) {
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const scheduleScrollToBottom = useCallback((force = false) => {
    if (!force && !stickRef.current) return;
    const run = () => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    };
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
    window.setTimeout(run, 80);
    window.setTimeout(run, 240);
  }, []);

  useEffect(() => {
    stickRef.current = true;
    scheduleScrollToBottom(true);
  }, [customerId, scheduleScrollToBottom]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("id, message_direction, message_text, message_type, created_at, slot_key")
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
          setRows((prev) => sortRows([...prev, payload.new as ConvRow], limit));
        }
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
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    const sentinel = bottomRef.current;
    if (!scroller || !sentinel) return;
    const go = () => scheduleScrollToBottom();
    go();
    const ro = new ResizeObserver(go);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [rows.length, scheduleScrollToBottom]);

  return (
    <div className={`rounded-lg overflow-hidden flex flex-col min-h-0 flex-1 ${gameOn ? "border exec-border-gold bg-card/40" : "border border-border bg-card/30"}`}>
      <div className={`px-2.5 py-1.5 border-b flex items-center justify-between shrink-0 ${gameOn ? "border-amber-400/25 bg-gradient-to-r from-amber-400/10 via-card/40 to-transparent" : "border-border/60 bg-muted/30"}`}>
        <span className={`flex items-center gap-1.5 ${gameOn ? "text-[12px] font-black uppercase tracking-widest text-amber-300" : "text-[10px] font-bold uppercase tracking-wide text-muted-foreground"}`}>
          {gameOn && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 exec-live-dot" aria-hidden />}
          <MessageCircle className={`${gameOn ? "w-3.5 h-3.5 text-amber-400" : "w-3 h-3 text-primary"}`} />
          {gameOn ? "Conversa ao vivo" : "Conversa ao vivo"}
          {gameOn && <span className="ml-1 px-1.5 py-0 rounded text-[9px] font-black bg-red-500/20 text-red-300 border border-red-500/40 tracking-wider">AO VIVO</span>}
        </span>
        <span className={`tabular-nums ${gameOn ? "text-[10px] font-bold text-amber-300/80" : "text-[9px] text-muted-foreground"}`}>{rows.length}</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-[140px] overflow-y-auto p-2.5 space-y-2 bg-[#0b141a]/40">

        {loading && (
          <div className="flex items-center justify-center py-4 text-muted-foreground text-[10px] gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> carregando…
          </div>
        )}
        {!loading && rows.length === 0 && (
          <p className="text-[10px] italic text-muted-foreground text-center py-4">
            Nenhuma mensagem ainda. Envie um passo para começar.
          </p>
        )}
        {rows.map((r) => {
          const out = r.message_direction === "outbound";
          const text = r.message_text || `[${r.message_type || "mídia"}]`;
          return (
            <div key={r.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 shadow-sm ${
                  out
                    ? "bg-[#005c4b] text-white rounded-tr-sm"
                    : "bg-[#202c33] text-white rounded-tl-sm"
                }`}
              >
                <div className="flex items-center gap-1 text-[10px] opacity-70 mb-1">
                  {iconFor(r.message_type)}
                  <span className="uppercase font-semibold">{out ? "Você" : "Lead"}</span>
                  <span>·</span>
                  <span className="tabular-nums">{fmtTime(r.created_at)}</span>
                  {r.slot_key && <span className="ml-1 opacity-60">· {r.slot_key}</span>}
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{text}</p>

              </div>
            </div>
          );
        })}
        <div ref={bottomRef} aria-hidden className="h-1" />
      </div>
    </div>
  );
}
