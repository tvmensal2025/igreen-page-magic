import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Play } from "lucide-react";
import { WhatsAppFormattedText } from "@/lib/whatsapp/formatWhatsAppText";
import { CaptureAttachActions } from "@/components/captacao/CaptureAttachActions";
import type { CaptureDocKey } from "@/hooks/useCaptureAttach";
import { toast } from "sonner";
import {
  resolveConversationMediaDataUrl,
  CONVERSATION_MESSAGE_SELECT,
  type ConversationMessageRow,
  type LastInboundMedia,
} from "@/lib/conversationMediaResolver";

export type { ConversationMessageRow, LastInboundMedia };
export { CONVERSATION_MESSAGE_SELECT };

const MEDIA_LABEL: Record<string, string> = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
};

function isMediaType(t: string | null | undefined) {
  return t === "image" || t === "audio" || t === "video" || t === "document" || t === "sticker";
}

function stripPlaceholder(text: string | null, type: string | null) {
  if (!text) return "";
  return text
    .replace(/^\[(?:áudio|audio|image|imagem|video|vídeo|arquivo|document|documento|sticker)(?::[^\]]*)?\]\s*/i, "")
    .replace(/\s*\((?:manual|continue)\)\s*$/i, "")
    .trim();
}

type AttachFn = (opts: {
  customerId: string;
  key: CaptureDocKey;
  sourceUrl: string;
  fileName?: string | null;
  mediaId?: string | null;
}) => Promise<string | undefined>;

interface Props {
  row: ConversationMessageRow;
  customerId: string;
  lastInbound?: LastInboundMedia;
  attachMediaToCapture?: AttachFn;
  showBoleto?: boolean;
  tone?: "dark" | "light";
}

export function ConversationMessageBody({
  row,
  customerId,
  lastInbound = { url: null, messageId: null, kind: null },
  attachMediaToCapture,
  showBoleto = false,
  tone = "light",
}: Props) {
  const type = row.message_type || "text";
  const caption = stripPlaceholder(row.message_text, type);
  const hasMedia = isMediaType(type);
  const inbound = row.message_direction !== "outbound";

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
      const url = await resolveConversationMediaDataUrl({ row, customerId, lastInbound });
      if (url) {
        setDataUrl(url);
        return url;
      }
      setError("Não foi possível carregar — tente de novo ou abra no chat completo.");
      return null;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao abrir mídia");
      return null;
    } finally {
      setLoading(false);
      triedRef.current = true;
    }
  }, [row, customerId, lastInbound, dataUrl, loading]);

  useEffect(() => {
    triedRef.current = false;
    setDataUrl(null);
    setError(null);
  }, [row.id]);

  useEffect(() => {
    if (hasMedia && !dataUrl && !loading && !triedRef.current) {
      triedRef.current = true;
      void load();
    }
  }, [hasMedia, type, row.id, row.media_id, row.external_message_id, dataUrl, loading, load]);

  const downloadName = (() => {
    const ext = type === "audio" ? "ogg" : type === "video" ? "mp4" : type === "image" || type === "sticker" ? "jpg" : type === "document" ? "pdf" : "bin";
    const stamp = new Date(row.created_at || Date.now()).toISOString().replace(/[:.]/g, "-");
    return `${type}-${stamp}.${ext}`;
  })();

  const handleDownload = useCallback(async () => {
    const src = dataUrl || (await load());
    if (!src) return;
    try {
      const res = await fetch(src);
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
      window.open(src, "_blank");
    }
  }, [dataUrl, load, downloadName]);

  const handleAttach = useCallback(async (key: CaptureDocKey) => {
    if (!attachMediaToCapture) return;
    const src = dataUrl || (await load());
    if (!src) {
      toast.error("Carregue a mídia antes de anexar");
      return;
    }
    await attachMediaToCapture({
      customerId,
      key,
      sourceUrl: src,
      mediaId: row.media_id || null,
      fileName: type === "document" ? (caption || "documento.pdf") : null,
    });
  }, [dataUrl, load, attachMediaToCapture, customerId, row.media_id, type, caption]);

  const btnCls = tone === "dark"
    ? "inline-flex items-center gap-2 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-50 px-2.5 py-1.5 text-xs font-medium transition"
    : "inline-flex items-center gap-2 rounded-md bg-muted hover:bg-muted/80 disabled:opacity-50 px-2.5 py-1.5 text-xs font-medium transition";

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

  const canAttach = inbound && (type === "image" || type === "document") && !!attachMediaToCapture;

  return (
    <div className="space-y-1.5">
      {dataUrl && (type === "image" || type === "sticker") && (
        <a href={dataUrl} target="_blank" rel="noreferrer">
          <img
            src={dataUrl}
            alt={MEDIA_LABEL[type]}
            className="rounded-md max-h-64 w-auto max-w-full object-contain border border-border/40"
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
          className="w-full min-w-[220px] h-10"
          controlsList="nofullscreen noremoteplayback"
        />
      )}
      {dataUrl && type === "video" && (
        <video controls preload="metadata" src={dataUrl} className="rounded-md max-h-64 w-auto max-w-full border border-border/40" />
      )}
      {dataUrl && type === "document" && isPdf && (
        <iframe
          src={dataUrl}
          className="w-full h-40 rounded border border-border/40 bg-muted/30"
          title={caption || "PDF"}
        />
      )}
      {dataUrl && type === "document" && !isPdf && (
        <button type="button" onClick={handleDownload} className={btnCls}>
          <Download className="w-3.5 h-3.5" /> Baixar documento
        </button>
      )}
      {dataUrl && (type === "audio" || type === "video" || type === "image" || type === "sticker" || (type === "document" && isPdf)) && (
        <button type="button" onClick={handleDownload} className={btnCls} title={`Baixar ${MEDIA_LABEL[type]}`}>
          <Download className="w-3 h-3" /> Baixar {MEDIA_LABEL[type]?.toLowerCase()}
        </button>
      )}

      {!dataUrl && (
        <button
          type="button"
          onClick={() => { triedRef.current = false; void load(); }}
          disabled={loading}
          className={btnCls}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          <span>
            {loading
              ? "Carregando mídia…"
              : error
                ? "Tentar carregar de novo"
                : `Carregar ${MEDIA_LABEL[type] || "mídia"}`}
          </span>
        </button>
      )}

      {error && !dataUrl && !loading && (
        <p className="text-[11px] text-muted-foreground">{error}</p>
      )}

      {canAttach && (
        <CaptureAttachActions onAttach={handleAttach} tone={tone} compact showBoleto={showBoleto} />
      )}

      {caption && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          <WhatsAppFormattedText text={caption} />
        </p>
      )}
    </div>
  );
}
