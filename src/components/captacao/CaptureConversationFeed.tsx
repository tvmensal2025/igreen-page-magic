import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Mic, ImageIcon, Video, FileText, Loader2, Play, Download } from "lucide-react";
import { whapiDownloadMedia } from "@/services/whapiApi";

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
  media_id: string | null;
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

// Rótulo de data para o separador (Hoje / Ontem / dd/mm)
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

export function CaptureConversationFeed({ customerId, limit = 50, gameOn = false }: Props) {
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
        .select("id, message_direction, message_text, message_type, media_id, created_at, slot_key")
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
          // Suprime sentinels internos (safety-ping / inline-sent / failed)
          if (typeof txt === "string" && (
            txt.startsWith("[__safety_ping__]") ||
            txt.startsWith("[inline-sent]") ||
            txt.startsWith("[failed:")
          )) return;
          setRows((prev) => sortRows([...prev, row], limit));
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
      <div className={`px-2.5 py-1.5 border-b flex items-center justify-between shrink-0 ${gameOn ? "border-warning/25 bg-gradient-to-r from-warning/10 via-card/40 to-transparent" : "border-border/60 bg-muted/30"}`}>
        <span className={`flex items-center gap-1.5 ${gameOn ? "text-[12px] font-black uppercase tracking-widest text-warning" : "text-[10px] font-bold uppercase tracking-wide text-muted-foreground"}`}>
          {gameOn && <span className="inline-block w-1.5 h-1.5 rounded-full bg-destructive/100 exec-live-dot" aria-hidden />}
          <MessageCircle className={`${gameOn ? "w-3.5 h-3.5 text-warning" : "w-3 h-3 text-primary"}`} />
          {gameOn ? "Conversa ao vivo" : "Conversa ao vivo"}
          {gameOn && <span className="ml-1 px-1.5 py-0 rounded text-[9px] font-black bg-destructive/20 text-destructive border border-destructive/40 tracking-wider">AO VIVO</span>}
        </span>
        <span className={`tabular-nums ${gameOn ? "text-[10px] font-bold text-warning/80" : "text-[9px] text-muted-foreground"}`}>{rows.length}</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-[140px] overflow-y-auto p-2.5 space-y-2 bg-[#0b141a]/40">

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
            <p className="text-sm font-medium text-white/80">Nenhuma mensagem ainda</p>
            <p className="text-xs text-white/50 max-w-[220px]">
              Envie um passo do roteiro ou escreva uma mensagem abaixo para começar a conversa.
            </p>
          </div>
        )}
        {rows.map((r, idx) => {
          const out = r.message_direction === "outbound";
          const showDay = idx === 0 || dayLabel(r.created_at) !== dayLabel(rows[idx - 1].created_at);
          return (
            <div key={r.id}>
              {showDay && (
                <div className="flex items-center justify-center my-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-black/30 text-white/70 text-[10px] font-medium">
                    {dayLabel(r.created_at)}
                  </span>
                </div>
              )}
              <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 shadow-sm ${
                    out
                      ? "bg-[#005c4b] text-white rounded-tr-sm"
                      : "bg-[#202c33] text-white rounded-tl-sm"
                  }`}
                >
                  <div className="flex items-center gap-1 text-[10px] opacity-70 mb-1">
                    {iconFor(r.message_type)}
                    <span className="uppercase font-semibold">{out ? "Você" : "Cliente"}</span>
                    <span>·</span>
                    <span className="tabular-nums">{fmtTime(r.created_at)}</span>
                    {r.slot_key && <span className="ml-1 opacity-60">· {r.slot_key}</span>}
                  </div>
                  <MessageBody row={r} />
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} aria-hidden className="h-1" />
      </div>
    </div>
  );
}
