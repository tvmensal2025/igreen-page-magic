import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Mic, ImageIcon, Video, FileText, Loader2, Play, Download, Check, CheckCheck, Clock, XCircle } from "lucide-react";
import { whapiDownloadMedia } from "@/services/whapiApi";
import { WhatsAppFormattedText } from "@/lib/whatsapp/formatWhatsAppText";
import { useCaptureAttach, type CaptureDocKey } from "@/hooks/useCaptureAttach";
import { CaptureAttachActions } from "@/components/captacao/CaptureAttachActions";
import { parseConversationEmbeddedMediaUrl } from "@/lib/captacao/conversationMediaUrl";
import { toast } from "sonner";

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
  external_message_id: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
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

const SELECT_COLS =
  "id, message_direction, message_text, message_type, media_id, external_message_id, delivery_status, delivery_error, created_at, slot_key";

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
  if (s === "read" || s === "played") return <CheckCheck className="h-3 w-3 text-sky-400" />;
  if (s === "delivered" || s === "delivery_ack") return <CheckCheck className="h-3 w-3 text-white/50" />;
  if (s === "sent" || s === "server_ack") return <Check className="h-3 w-3 text-white/50" />;
  if (s === "pending") return <Clock className="h-3 w-3 text-white/40" />;
  return null;
}

function looksLikeUuid(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function CaptureConversationFeed({ customerId, limit = 50, gameOn = false }: Props) {
  const [rows, setRows] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastInbound, setLastInbound] = useState<{
    url: string | null;
    messageId: string | null;
    kind: string | null;
  }>({ url: null, messageId: null, kind: null });
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  /** ISO do momento em que a conversa foi aberta — separa "novas mensagens" das já vistas */
  const openedAtRef = useRef<string>(new Date().toISOString());
  const { attachMediaToCapture } = useCaptureAttach();


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
    openedAtRef.current = new Date().toISOString();
    setHasMore(true);
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
      // preserva posição de scroll ao prepender
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

        {!loading && rows.length > 0 && hasMore && (
          <div className="flex items-center justify-center py-1">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded-full px-2.5 py-1 transition disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {loadingMore ? "Carregando…" : "Carregar mensagens anteriores"}
            </button>
          </div>
        )}
        {!loading && rows.length > 0 && !hasMore && (
          <div className="flex items-center justify-center py-1">
            <span className="text-[9px] uppercase tracking-wider text-white/40">início da conversa</span>
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
            <p className="text-sm font-medium text-white/80">Nenhuma mensagem ainda</p>
            <p className="text-xs text-white/50 max-w-[220px]">
              Envie um passo do roteiro ou escreva uma mensagem abaixo para começar a conversa.
            </p>
          </div>
        )}

        {rows.map((r, idx) => {
          const out = r.message_direction === "outbound";
          const showDay = idx === 0 || dayLabel(r.created_at) !== dayLabel(rows[idx - 1].created_at);
          // marcador "Novas mensagens" na 1ª msg inbound recebida após abrir o lead
          const prev = rows[idx - 1];
          const isNewSince =
            !out &&
            r.created_at > openedAtRef.current &&
            (!prev || !(prev.message_direction !== "outbound" && prev.created_at > openedAtRef.current));
          return (
            <div key={r.id}>
              {showDay && (
                <div className="flex items-center justify-center my-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-black/30 text-white/70 text-[10px] font-medium">
                    {dayLabel(r.created_at)}
                  </span>
                </div>
              )}
              {isNewSince && (
                <div className="flex items-center gap-2 my-2" aria-label="Novas mensagens">
                  <span className="flex-1 h-px bg-emerald-500/40" />
                  <span className="text-[9px] uppercase tracking-widest font-bold text-emerald-400">
                    Novas mensagens
                  </span>
                  <span className="flex-1 h-px bg-emerald-500/40" />
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
                    {out && (
                      <span className="ml-auto inline-flex">
                        <DeliveryIcon status={r.delivery_status} error={r.delivery_error} />
                      </span>
                    )}
                  </div>
                  <MessageBody
                    row={r}
                    customerId={customerId}
                    lastInbound={lastInbound}
                    showBoleto
                    attachMediaToCapture={attachMediaToCapture}
                  />
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

/* ----- Corpo da mensagem: renderiza texto ou mídia inline ----- */

function isMediaType(t: string | null | undefined) {
  return t === "image" || t === "audio" || t === "video" || t === "document" || t === "sticker";
}

function stripPlaceholder(text: string | null, type: string | null) {
  if (!text) return "";
  // remove marcadores "[áudio] " / "[image:slot]" / "[arquivo]"
  const cleaned = text
    .replace(/^\[(?:áudio|audio|image|imagem|video|vídeo|arquivo|document|documento|sticker)(?::[^\]]*)?\]\s*/i, "")
    .replace(/\s*\((?:manual|continue)\)\s*$/i, "")
    .trim();
  return cleaned;
}

const MEDIA_LABEL: Record<string, string> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
};

function MessageBody({
  row,
  customerId,
  lastInbound,
  showBoleto,
  attachMediaToCapture,
}: {
  row: ConvRow;
  customerId: string;
  lastInbound: { url: string | null; messageId: string | null; kind: string | null };
  showBoleto: boolean;
  attachMediaToCapture: (opts: {
    customerId: string;
    key: CaptureDocKey;
    sourceUrl: string;
    fileName?: string | null;
    mediaId?: string | null;
  }) => Promise<string | undefined>;
}) {
  const type = row.message_type || "text";
  const caption = stripPlaceholder(row.message_text, type);
  const hasMedia = isMediaType(type);
  const inbound = row.message_direction !== "outbound";
  const canAttach = inbound && (type === "image" || type === "document");

  const [loading, setLoading] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triedRef = useRef(false);

  const load = useCallback(async (): Promise<string | null> => {
    if (dataUrl) return dataUrl;
    if (loading) return null;
    setLoading(true);
    setError(null);
    try {
      const resolveHttpOrData = async (raw: string): Promise<string | null> => {
        if (raw.startsWith("data:")) {
          setDataUrl(raw);
          return raw;
        }
        if (raw.startsWith("http")) {
          const dl = await whapiDownloadMedia({ url: raw });
          if (dl?.base64) {
            const url = `data:${dl.mimetype || "application/octet-stream"};base64,${dl.base64}`;
            setDataUrl(url);
            return url;
          }
          // MinIO / CDN público às vezes abre direto no browser
          setDataUrl(raw);
          return raw;
        }
        return null;
      };

      // 0) Evolution: message_text = "[image] https://..."
      {
        const embedded = parseConversationEmbeddedMediaUrl(row.message_text);
        if (embedded?.url) {
          const got = await resolveHttpOrData(embedded.url);
          if (got) return got;
        }
      }

      // 1) media_id Whapi (não-UUID) → proxy
      if (row.media_id && !looksLikeUuid(row.media_id)) {
        const r = await whapiDownloadMedia({ mediaId: row.media_id });
        if (r?.base64) {
          const url = `data:${r.mimetype || "application/octet-stream"};base64,${r.base64}`;
          setDataUrl(url);
          return url;
        }
      }

      // 2) media_id UUID → biblioteca interna (passos do roteiro)
      if (row.media_id && looksLikeUuid(row.media_id)) {
        const { data: lib } = await supabase
          .from("ai_media_library")
          .select("url, kind")
          .eq("id", row.media_id)
          .maybeSingle();
        if (lib?.url) {
          const got = await resolveHttpOrData(String(lib.url));
          if (got) return got;
        }
      }

      // 3) Fallback: última mídia inbound do customer (mesma mensagem)
      if (
        inbound &&
        lastInbound.url &&
        lastInbound.messageId &&
        row.external_message_id &&
        lastInbound.messageId === row.external_message_id
      ) {
        const got = await resolveHttpOrData(lastInbound.url);
        if (got) return got;
      }

      // 4) Último recurso inbound sem id: last_inbound http/data
      if (inbound && !row.media_id && lastInbound.url && (type === "image" || type === "document" || type === lastInbound.kind)) {
        const got = await resolveHttpOrData(lastInbound.url);
        if (got) return got;
      }

      setError("Mídia indisponível");
      return null;
    } catch (e: any) {
      setError(e?.message || "Falha ao abrir mídia");
      return null;
    } finally {
      setLoading(false);
      triedRef.current = true;
    }
  }, [row.media_id, row.external_message_id, row.message_text, dataUrl, loading, inbound, lastInbound, type]);

  // Auto-carrega imagens / stickers / documentos (PDF preview)
  useEffect(() => {
    triedRef.current = false;
    setDataUrl(null);
    setError(null);
  }, [row.id]);

  useEffect(() => {
    if (
      (type === "image" || type === "sticker" || type === "document") &&
      !dataUrl &&
      !loading &&
      !triedRef.current
    ) {
      triedRef.current = true;
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, row.id, row.media_id]);

  const downloadName = (() => {
    const ext = type === "audio" ? "ogg" : type === "video" ? "mp4" : type === "image" || type === "sticker" ? "jpg" : type === "document" ? "pdf" : "bin";
    const stamp = new Date(row.created_at || Date.now()).toISOString().replace(/[:.]/g, "-");
    return `${type}-${stamp}.${ext}`;
  })();

  // Hooks precisam vir antes de qualquer return condicional (rules-of-hooks).
  const handleDownload = useCallback(async () => {
    if (!dataUrl) return;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.open(dataUrl, "_blank");
    }
  }, [dataUrl, downloadName]);

  const handleAttach = useCallback(async (key: CaptureDocKey) => {
    const src = dataUrl || (await load());
    if (!src) {
      toast.error("Carregue a mídia antes de anexar");
      return;
    }
    await attachMediaToCapture({
      customerId,
      key,
      sourceUrl: src,
      mediaId: row.media_id && !looksLikeUuid(row.media_id) ? row.media_id : null,
      fileName: type === "document" ? (caption || "documento.pdf") : null,
    });
  }, [dataUrl, load, attachMediaToCapture, customerId, row.media_id, type, caption]);

  if (!hasMedia) {
    return (
      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
        <WhatsAppFormattedText text={row.message_text || ""} />
      </p>
    );
  }

  const isPdf = type === "document" && (
    dataUrl?.includes("application/pdf") ||
    dataUrl?.toLowerCase().includes(".pdf") ||
    (caption || "").toLowerCase().endsWith(".pdf")
  );

  return (
    <div className="space-y-1.5">
      {/* Mídia carregada */}
      {dataUrl && (type === "image" || type === "sticker") && (
        <a href={dataUrl} target="_blank" rel="noreferrer">
          <img
            src={dataUrl}
            alt={MEDIA_LABEL[type]}
            className="rounded-md max-h-64 w-auto object-cover border border-white/10"
            loading="lazy"
            decoding="async"
          />
        </a>
      )}
      {dataUrl && type === "audio" && (
        <audio
          controls
          preload="metadata"
          src={dataUrl}
          className="w-full h-9"
          controlsList="nofullscreen noremoteplayback"
        />
      )}
      {dataUrl && type === "video" && (
        <video controls preload="metadata" src={dataUrl} className="rounded-md max-h-64 w-auto border border-white/10" />
      )}
      {dataUrl && type === "document" && isPdf && (
        <iframe
          src={dataUrl}
          className="w-full h-40 rounded border border-white/10 bg-black/20"
          title={caption || "PDF"}
        />
      )}
      {dataUrl && type === "document" && !isPdf && (
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-md px-2 py-1"
        >
          <Download className="w-3.5 h-3.5" /> Baixar documento
        </button>
      )}
      {dataUrl && (type === "audio" || type === "video" || type === "image" || type === "sticker" || (type === "document" && isPdf)) && (
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 text-[11px] bg-white/10 hover:bg-white/20 rounded-md px-2 py-1 transition"
          title={`Baixar ${MEDIA_LABEL[type]}`}
        >
          <Download className="w-3 h-3" /> Baixar {MEDIA_LABEL[type]?.toLowerCase()}
        </button>
      )}

      {/* Fallback / botão de abrir para tipos não pré-carregados */}
      {!dataUrl && (
        <button
          type="button"
          onClick={() => { triedRef.current = false; void load(); }}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-50 px-2.5 py-1.5 text-xs font-medium transition"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          <span>
            {loading
              ? "Carregando…"
              : error
              ? `Tentar ${MEDIA_LABEL[type]?.toLowerCase() || "mídia"} de novo`
              : `Abrir ${MEDIA_LABEL[type] || "mídia"}`}
          </span>
        </button>
      )}

      {error && !dataUrl && <p className="text-[11px] text-red-300">{error}</p>}
      {!row.media_id && !dataUrl && !lastInbound.url && (
        <p className="text-[11px] opacity-60 italic">Mídia sem identificador — abra no chat completo.</p>
      )}

      {canAttach && (
        <CaptureAttachActions
          onAttach={handleAttach}
          tone="dark"
          compact
          showBoleto={showBoleto}
        />
      )}

      {caption && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          <WhatsAppFormattedText text={caption} />
        </p>
      )}
    </div>
  );
}
