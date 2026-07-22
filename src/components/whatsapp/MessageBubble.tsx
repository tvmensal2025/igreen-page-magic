import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, CheckCheck, Clock, FileText, Image, Mic, Video, Play, Download, Loader2, MoreVertical, Bookmark, Copy, Paperclip, Sparkles, IdCard, Zap, XCircle, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SaveMessageAsTemplateDialog } from "./SaveMessageAsTemplateDialog";
import { toast } from "sonner";
import type { ChatMessage } from "@/hooks/useMessages";
import type { CaptureDocKey } from "@/hooks/useCaptureAttach";
import { WhatsAppFormattedText } from "@/lib/whatsapp/formatWhatsAppText";
import { CaptureAttachActions } from "@/components/captacao/CaptureAttachActions";

interface MessageBubbleProps {
  message: ChatMessage;
  onLoadMedia?: (messageId: string) => Promise<string | null>;
  consultantId?: string;
  customerId?: string | null;
  onAttachToCapture?: (message: ChatMessage, key: CaptureDocKey, loadedUrl: string) => Promise<void> | void;
  onTemplateSaved?: () => void;
}


function formatTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusIcon({ status, error }: { status?: number | string; error?: string | null }) {
  if (status === undefined || status === null) return null;
  if (status === "failed" || status === "ERROR" || status === "FAILED") {
    return (
      <span title={error || "Falha na entrega — WhatsApp recusou a mensagem"} className="inline-flex">
        <XCircle className="h-3 w-3 text-destructive" />
      </span>
    );
  }
  if (typeof status !== "number") return null;
  if (status <= 1) return <Clock className="h-3 w-3 text-muted-foreground" />;
  if (status === 2) return <Check className="h-3 w-3 text-muted-foreground" />;
  if (status === 3) return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
  if (status >= 4) return <CheckCheck className="h-3 w-3 text-primary" />;
  return null;
}

/** Só data: e Storage nosso são seguros no <img>/<audio> do browser.
 * Wasabi / pps / mmg / media-gru dão 403 ou CORS — forçar loadMedia (proxy). */
function isAccessibleUrl(url?: string): boolean {
  if (!url) return false;
  if (url.startsWith("data:")) return true;
  if (url.includes("supabase.co/storage/")) return true;
  return false;
}

function AudioPlayer({ message, onLoadMedia, onLoaded }: { message: ChatMessage; onLoadMedia?: (id: string) => Promise<string | null>; onLoaded?: (url: string) => void }) {
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const triedRef = useRef(false);

  useEffect(() => {
    triedRef.current = false;
    setFailed(false);
    const accessible = isAccessibleUrl(message.mediaUrl) ? message.mediaUrl! : null;
    setAudioSrc(accessible);
  }, [message.id]);

  useEffect(() => {
    if (isAccessibleUrl(message.mediaUrl) && message.mediaUrl !== audioSrc) {
      setAudioSrc(message.mediaUrl!);
      setFailed(false);
    }
  }, [message.mediaUrl, audioSrc]);

  useEffect(() => { if (audioSrc) onLoaded?.(audioSrc); }, [audioSrc, onLoaded]);

  const handleLoad = useCallback(async () => {
    if (!onLoadMedia || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const src = await onLoadMedia(message.id);
      if (src && isAccessibleUrl(src)) setAudioSrc(src);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      triedRef.current = true;
    }
  }, [onLoadMedia, message.id, loading]);

  useEffect(() => {
    if (!audioSrc && onLoadMedia && !triedRef.current && !failed) {
      triedRef.current = true;
      void handleLoad();
    }
  }, [message.id, audioSrc, onLoadMedia, failed, handleLoad]);

  if (audioSrc) {
    return (
      <audio
        controls
        className="max-w-full h-10"
        preload="auto"
        onError={() => {
          setAudioSrc(null);
          setFailed(true);
        }}
      >
        <source src={audioSrc} type={message.mediaMimetype || "audio/ogg"} />
      </audio>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-2 text-xs h-8"
      onClick={() => { triedRef.current = false; void handleLoad(); }}
      disabled={loading}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Play className="h-4 w-4" />
      )}
      <Mic className="h-3.5 w-3.5" />
      {failed ? "Tentar áudio de novo" : "Áudio"}
    </Button>
  );
}


function ImageViewer({ message, onLoadMedia, onLoaded }: { message: ChatMessage; onLoadMedia?: (id: string) => Promise<string | null>; onLoaded?: (url: string) => void }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const triedRef = useRef(false);
  const msgIdRef = useRef(message.id);

  useEffect(() => {
    msgIdRef.current = message.id;
    triedRef.current = false;
    setFailed(false);
    setExpanded(false);
    setImgSrc(isAccessibleUrl(message.mediaUrl) ? message.mediaUrl! : null);
  }, [message.id]);

  // Se o poll/loadMedia promoveu mediaUrl para data:, usa sem resetar tentativa.
  useEffect(() => {
    if (isAccessibleUrl(message.mediaUrl)) {
      setImgSrc(message.mediaUrl!);
      setFailed(false);
    }
  }, [message.mediaUrl]);

  useEffect(() => { if (imgSrc) onLoaded?.(imgSrc); }, [imgSrc, onLoaded]);

  const handleLoad = useCallback(async () => {
    if (!onLoadMedia || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const src = await onLoadMedia(message.id);
      if (msgIdRef.current !== message.id) return;
      if (src && isAccessibleUrl(src)) {
        setImgSrc(src);
      } else {
        setFailed(true);
      }
    } catch {
      if (msgIdRef.current === message.id) setFailed(true);
    } finally {
      if (msgIdRef.current === message.id) {
        setLoading(false);
        triedRef.current = true;
      }
    }
  }, [onLoadMedia, message.id, loading]);

  useEffect(() => {
    if (!imgSrc && onLoadMedia && !triedRef.current && !failed && !loading) {
      triedRef.current = true;
      void handleLoad();
    }
  }, [message.id, imgSrc, onLoadMedia, failed, loading, handleLoad]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando imagem...
      </div>
    );
  }

  if (imgSrc) {
    return (
      <>
        <img
          src={imgSrc}
          alt={message.mediaCaption || "imagem"}
          className="rounded max-w-full max-h-60 mb-1 cursor-pointer hover:opacity-90 transition-opacity"
          loading="lazy"
          decoding="async"
          onClick={() => setExpanded(true)}
          onError={() => {
            setImgSrc(null);
            setFailed(true);
          }}
        />
        {expanded && createPortal(
          <div
            className="fixed inset-0 z-[140] bg-black/80 flex items-center justify-center cursor-pointer"
            onClick={() => setExpanded(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Imagem ampliada"
          >
            <img
              src={imgSrc}
              alt=""
              className="max-w-[90vw] max-h-[90vh] rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-2 text-xs h-8"
      onClick={() => { triedRef.current = false; void handleLoad(); }}
      disabled={loading}
    >
      <Image className="h-4 w-4" />
      {failed ? "Tentar de novo" : "📷 Carregar imagem"}
    </Button>
  );
}

function VideoPlayer({ message, onLoadMedia, onLoaded }: { message: ChatMessage; onLoadMedia?: (id: string) => Promise<string | null>; onLoaded?: (url: string) => void }) {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const triedRef = useRef(false);

  useEffect(() => {
    triedRef.current = false;
    setFailed(false);
    setVideoSrc(isAccessibleUrl(message.mediaUrl) ? message.mediaUrl! : null);
  }, [message.id]);

  useEffect(() => {
    if (isAccessibleUrl(message.mediaUrl)) {
      setVideoSrc(message.mediaUrl!);
      setFailed(false);
    }
  }, [message.mediaUrl]);

  useEffect(() => { if (videoSrc) onLoaded?.(videoSrc); }, [videoSrc, onLoaded]);

  const handleLoad = useCallback(async () => {
    if (!onLoadMedia || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const src = await onLoadMedia(message.id);
      if (src && isAccessibleUrl(src)) setVideoSrc(src);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      triedRef.current = true;
    }
  }, [onLoadMedia, message.id, loading]);

  useEffect(() => {
    if (!videoSrc && onLoadMedia && !triedRef.current && !failed) {
      triedRef.current = true;
      void handleLoad();
    }
  }, [message.id, videoSrc, onLoadMedia, failed, handleLoad]);

  if (videoSrc) {
    return (
      <video
        controls
        className="rounded max-w-full max-h-60 mb-1"
        preload="metadata"
        onError={() => { setVideoSrc(null); setFailed(true); }}
      >
        <source src={videoSrc} type={message.mediaMimetype || "video/mp4"} />
      </video>
    );
  }

  return (
    <Button variant="ghost" size="sm" className="gap-2 text-xs h-8" onClick={() => { triedRef.current = false; void handleLoad(); }} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
      {failed ? "Tentar vídeo de novo" : "🎥 Carregar vídeo"}
    </Button>
  );
}

function DocumentViewer({ message, onLoadMedia, onLoaded }: { message: ChatMessage; onLoadMedia?: (id: string) => Promise<string | null>; onLoaded?: (url: string) => void }) {
  const [docSrc, setDocSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const triedRef = useRef(false);
  const isPdf = message.mediaMimetype?.includes("pdf") || message.fileName?.endsWith(".pdf");

  useEffect(() => {
    triedRef.current = false;
    setFailed(false);
    setDocSrc(isAccessibleUrl(message.mediaUrl) ? message.mediaUrl! : null);
  }, [message.id]);

  useEffect(() => {
    if (isAccessibleUrl(message.mediaUrl)) {
      setDocSrc(message.mediaUrl!);
      setFailed(false);
    }
  }, [message.mediaUrl]);

  useEffect(() => { if (docSrc) onLoaded?.(docSrc); }, [docSrc, onLoaded]);

  const handleLoad = useCallback(async () => {
    if (!onLoadMedia || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const src = await onLoadMedia(message.id);
      if (src && isAccessibleUrl(src)) setDocSrc(src);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      triedRef.current = true;
    }
  }, [onLoadMedia, message.id, loading]);

  useEffect(() => {
    if (!docSrc && onLoadMedia && !triedRef.current && !failed) {
      triedRef.current = true;
      void handleLoad();
    }
  }, [message.id, docSrc, onLoadMedia, failed, handleLoad]);

  if (docSrc && isPdf) {
    return (
      <div className="space-y-1">
        <iframe
          src={docSrc}
          className="w-full h-48 rounded border border-border bg-background"
          title={message.fileName || "PDF"}
        />
        <a href={docSrc} download={message.fileName || "documento.pdf"} className="text-[10px] text-primary hover:underline flex items-center gap-1">
          <Download className="h-3 w-3" />
          Baixar {message.fileName || "documento.pdf"}
        </a>
      </div>
    );
  }

  if (docSrc) {
    return (
      <a href={docSrc} download={message.fileName || "documento"} className="flex items-center gap-2 text-xs text-primary hover:underline">
        <Download className="h-4 w-4" />
        Baixar {message.fileName || "documento"}
      </a>
    );
  }

  return (
    <Button variant="ghost" size="sm" className="gap-2 text-xs h-8" onClick={() => { triedRef.current = false; void handleLoad(); }} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      {failed ? "Tentar de novo" : `📄 ${message.fileName || "Documento"}`}
    </Button>
  );
}

function StickerViewer({ message, onLoadMedia }: { message: ChatMessage; onLoadMedia?: (id: string) => Promise<string | null> }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const triedRef = useRef(false);

  useEffect(() => {
    triedRef.current = false;
    setFailed(false);
    setSrc(isAccessibleUrl(message.mediaUrl) ? message.mediaUrl! : null);
  }, [message.id]);

  useEffect(() => {
    if (isAccessibleUrl(message.mediaUrl)) {
      setSrc(message.mediaUrl!);
      setFailed(false);
    }
  }, [message.mediaUrl]);

  const handleLoad = useCallback(async () => {
    if (!onLoadMedia || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const result = await onLoadMedia(message.id);
      if (result && isAccessibleUrl(result)) setSrc(result);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      triedRef.current = true;
    }
  }, [onLoadMedia, message.id, loading]);

  useEffect(() => {
    if (!src && onLoadMedia && !triedRef.current && !failed) {
      triedRef.current = true;
      void handleLoad();
    }
  }, [message.id, src, onLoadMedia, failed, handleLoad]);

  if (src) {
    return (
      <img
        src={src}
        alt="sticker"
        className="max-w-[150px] max-h-[150px]"
        loading="lazy"
        decoding="async"
        onError={() => { setSrc(null); setFailed(true); }}
      />
    );
  }

  return (
    <Button variant="ghost" size="sm" className="gap-1 text-xs h-8" onClick={() => { triedRef.current = false; void handleLoad(); }} disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "🏷️"} {failed ? "Tentar de novo" : "Sticker"}
    </Button>
  );
}

/** Formatação WhatsApp (*negrito*, _itálico_, ~riscado~, `mono`) + links. */
function LinkifiedText({ text }: { text: string }) {
  return <WhatsAppFormattedText text={text} />;
}

export function MessageBubble({ message, onLoadMedia, consultantId, customerId, onAttachToCapture, onTemplateSaved }: MessageBubbleProps) {
  const { fromMe, text, timestamp, status, mediaType, interactiveHeader, interactiveFooter, interactiveButtons } = message;
  const showText = !!(text && mediaType !== "audio" && mediaType !== "sticker");
  const hasMedia = !!mediaType;
  const hasInteractive = !!(interactiveButtons && interactiveButtons.length > 0);
  const isEmptyShell =
    !showText && !hasMedia && !hasInteractive && !interactiveHeader && !interactiveFooter;

  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogFocus, setDialogFocus] = useState<"name" | "shortcut">("name");
  const [attaching, setAttaching] = useState<CaptureDocKey | null>(null);

  const canSaveAsTemplate = !!consultantId && (mediaType === "audio" || mediaType === "video" || mediaType === "image");
  const canCopy = !!text;
  const canAttachToCapture = !!customerId && !!onAttachToCapture && !fromMe && (mediaType === "document" || mediaType === "image");

  const handleAttach = useCallback(async (key: CaptureDocKey) => {
    if (!onAttachToCapture) return;
    let src = loadedUrl;
    if (!src && onLoadMedia) {
      src = await onLoadMedia(message.id);
      if (src) setLoadedUrl(src);
    }
    if (!src) {
      toast.error("Não consegui carregar a mídia");
      return;
    }
    setAttaching(key);
    try {
      await onAttachToCapture(message, key, src);
    } finally {
      setAttaching(null);
    }
  }, [loadedUrl, onLoadMedia, message, onAttachToCapture]);

  // Protocolo / unknown sem corpo: não renderiza bolha fantasma.
  if (isEmptyShell) return null;

  return (
    <div className={`group flex ${fromMe ? "justify-end" : "justify-start"} mb-1.5`}>
      <div
        className={`relative max-w-[min(85%,28rem)] sm:max-w-[min(75%,36rem)] rounded-2xl px-3 py-2 shadow-sm transition-shadow hover:shadow-md break-words ${
          fromMe
            ? "bg-gradient-to-br from-primary/15 to-primary/10 text-foreground rounded-br-md border border-primary/15"
            : "bg-card text-foreground rounded-bl-md border border-border/60"
        }`}
      >
        {(canSaveAsTemplate || canCopy || canAttachToCapture) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-background/90 border border-border/60 shadow opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100 flex items-center justify-center transition-opacity"
                aria-label="Mais opções"
              >
                {attaching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-3.5 h-3.5" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {canAttachToCapture && (
                <>
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Anexar à captação
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => handleAttach("electricity_bill_photo_url")}>
                    <Zap className="w-4 h-4 mr-2 text-primary" /> Usar como Conta de Energia
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttach("document_front_url")}>
                    <IdCard className="w-4 h-4 mr-2" /> Usar como RG/CNH (Frente)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttach("document_back_url")}>
                    <IdCard className="w-4 h-4 mr-2" /> Usar como RG/CNH (Verso)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttach("electricity_boleto_photo_url")}>
                    <Receipt className="w-4 h-4 mr-2" /> Usar como Boleto Bancário
                  </DropdownMenuItem>
                  {(canSaveAsTemplate || canCopy) && <DropdownMenuSeparator />}
                </>
              )}
              {canSaveAsTemplate && (
                <>
                  <DropdownMenuItem onClick={() => { setDialogFocus("name"); setDialogOpen(true); }}>
                    <Bookmark className="w-4 h-4 mr-2" /> Salvar como template
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setDialogFocus("shortcut"); setDialogOpen(true); }}>
                    <Bookmark className="w-4 h-4 mr-2" /> Salvar com atalho rápido
                  </DropdownMenuItem>
                </>
              )}
              {canCopy && (
                <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(text || ""); toast.success("Texto copiado"); }}>
                  <Copy className="w-4 h-4 mr-2" /> Copiar texto
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {mediaType === "image" && <ImageViewer message={message} onLoadMedia={onLoadMedia} onLoaded={setLoadedUrl} />}
        {mediaType === "video" && <VideoPlayer message={message} onLoadMedia={onLoadMedia} onLoaded={setLoadedUrl} />}
        {mediaType === "audio" && <AudioPlayer message={message} onLoadMedia={onLoadMedia} onLoaded={setLoadedUrl} />}
        {mediaType === "document" && <DocumentViewer message={message} onLoadMedia={onLoadMedia} onLoaded={setLoadedUrl} />}
        {mediaType === "sticker" && <StickerViewer message={message} onLoadMedia={onLoadMedia} />}

        {canAttachToCapture && (
          <CaptureAttachActions
            onAttach={handleAttach}
            tone="light"
            compact
            showBoleto
          />
        )}

        {interactiveHeader && (
          <div className="text-[11px] font-semibold text-foreground/90 mb-0.5">
            <LinkifiedText text={interactiveHeader} />
          </div>
        )}
        {showText && <LinkifiedText text={text} />}
        {hasInteractive && (
          <div className="mt-2 flex flex-col gap-1.5">
            {interactiveButtons!.map((btn) => (
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
        {interactiveFooter && (
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            <LinkifiedText text={interactiveFooter} />
          </div>
        )}

        <div className="flex items-center justify-end gap-1 mt-0.5">
          <span className="text-[10px] text-muted-foreground">{formatTime(timestamp)}</span>
          {fromMe && <StatusIcon status={status} error={(message as any).deliveryError} />}
        </div>
      </div>

      {canSaveAsTemplate && consultantId && (
        <SaveMessageAsTemplateDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          message={message}
          consultantId={consultantId}
          loadedMediaUrl={loadedUrl}
          onLoadMedia={onLoadMedia}
          focus={dialogFocus}
          onSaved={onTemplateSaved}
        />
      )}
    </div>
  );
}

