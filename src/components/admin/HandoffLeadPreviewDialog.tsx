/**
 * Popup: nome + histórico com áudio / imagem / vídeo (mesmo resolver do chat).
 */
import { useEffect, useState } from "react";
import { FileText, Loader2, MessageCircle, Mic, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { HandoffLead } from "@/lib/handoffReturnToPizza";
import {
  CONVERSATION_MESSAGE_SELECT,
  resolveConversationMediaDataUrl,
  type ConversationMessageRow,
} from "@/lib/conversationMediaResolver";
import { parseConversationEmbeddedMediaUrl } from "@/lib/captacao/conversationMediaUrl";

type Msg = ConversationMessageRow;

type Props = {
  lead: HandoffLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat?: (phone: string) => void;
};

function initials(name: string, phone: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  const d = String(phone || "").replace(/\D/g, "");
  return d.slice(-2) || "?";
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function mediaKind(type: string | null, text: string | null): "image" | "audio" | "video" | "document" | "text" {
  const embedded = parseConversationEmbeddedMediaUrl(text);
  if (embedded?.kind === "image" || embedded?.kind === "sticker") return "image";
  if (embedded?.kind === "audio") return "audio";
  if (embedded?.kind === "video") return "video";
  if (embedded?.kind === "document") return "document";
  const kind = String(type || "").toLowerCase();
  if (kind.includes("image") || kind.includes("photo") || kind.includes("sticker")) return "image";
  if (kind.includes("audio") || kind.includes("ptt") || kind.includes("voice")) return "audio";
  if (kind.includes("video")) return "video";
  if (kind.includes("document") || kind.includes("file")) return "document";
  return "text";
}

function captionText(text: string | null): string {
  const t = String(text || "").trim();
  if (!t) return "";
  if (t.startsWith("[__safety_ping__]") || t.startsWith("[inline-sent]") || t.startsWith("[failed:")) {
    return "";
  }
  if (t.startsWith("data:")) return "";
  const embedded = parseConversationEmbeddedMediaUrl(t);
  if (embedded) return "";
  if (/^\[(image|document|video|audio|sticker)\]/i.test(t)) return "";
  return t;
}

function PreviewMedia({
  msg,
  customerId,
}: {
  msg: Msg;
  customerId: string;
}) {
  const kind = mediaKind(msg.message_type, msg.message_text);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (kind === "text") return;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    setLoading(true);
    void (async () => {
      try {
        const url = await resolveConversationMediaDataUrl({ row: msg, customerId });
        if (cancelled) return;
        if (url) setSrc(url);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [msg.id, customerId, kind]);

  if (kind === "text") return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs opacity-80 py-1">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando {kind === "audio" ? "áudio" : kind === "video" ? "vídeo" : kind === "image" ? "imagem" : "arquivo"}…
      </div>
    );
  }

  if (failed || !src) {
    return (
      <div className="flex items-center gap-1.5 text-xs opacity-80 py-1">
        {kind === "audio" ? <Mic className="h-3.5 w-3.5" /> : kind === "video" ? <Play className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
        Não foi possível carregar a mídia
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <audio controls preload="metadata" className="w-full max-w-[260px] h-10 my-1">
        <source src={src} />
      </audio>
    );
  }

  if (kind === "image") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block my-1">
        <img
          src={src}
          alt="Imagem da conversa"
          className="max-h-52 max-w-full rounded-lg object-contain bg-black/5"
        />
      </a>
    );
  }

  if (kind === "video") {
    return (
      <video controls preload="metadata" className="max-h-52 max-w-full rounded-lg my-1 bg-black/90">
        <source src={src} />
      </video>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-xs underline underline-offset-2 my-1"
    >
      <FileText className="h-3.5 w-3.5" />
      Abrir documento
    </a>
  );
}

export function HandoffLeadPreviewDialog({ lead, open, onOpenChange, onOpenChat }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !lead) {
      setMsgs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("conversations")
        .select(CONVERSATION_MESSAGE_SELECT)
        .eq("customer_id", lead.customerId)
        .order("created_at", { ascending: false })
        .limit(80);
      if (cancelled) return;
      const cleaned = ((data as Msg[]) || [])
        .filter((m) => {
          const t = String(m.message_text || "");
          return !(
            t.startsWith("[__safety_ping__]") ||
            t.startsWith("[inline-sent]") ||
            t.startsWith("[failed:")
          );
        })
        .reverse();
      setMsgs(cleaned);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, lead?.customerId]);

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "w-[calc(100%-1rem)] max-w-lg p-0 gap-0 overflow-hidden flex flex-col",
          "max-h-[min(92dvh,760px)] h-[min(92dvh,760px)] sm:h-auto sm:max-h-[min(90dvh,720px)]",
        )}
      >
        <DialogHeader className="shrink-0 px-4 sm:px-6 pt-5 pb-3 pr-12 border-b text-left">
          <DialogTitle className="sr-only">Conversa com {lead.displayName}</DialogTitle>
          <DialogDescription className="sr-only">
            Nome, foto e mensagens deste lead
          </DialogDescription>
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 sm:h-14 sm:w-14 border border-border shrink-0">
              {lead.photoUrl ? <AvatarImage src={lead.photoUrl} alt={lead.displayName} /> : null}
              <AvatarFallback className="text-sm font-semibold">
                {initials(lead.displayName, lead.phone)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="font-semibold text-base truncate">{lead.displayName}</div>
              <div className="text-sm text-muted-foreground">{lead.phoneFormatted}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {lead.grupoLabel} · {lead.stageLabel}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3">
          <div className="rounded-md border border-border/60 px-3 py-2 min-h-[240px]">
            {loading ? (
              <div className="flex justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : msgs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                Nenhuma mensagem registrada ainda.
              </p>
            ) : (
              <div className="space-y-2 py-1">
                {msgs.map((m) => {
                  const inbound = m.message_direction === "inbound";
                  const kind = mediaKind(m.message_type, m.message_text);
                  const caption = captionText(m.message_text);
                  if (kind === "text" && !caption) return null;
                  return (
                    <div
                      key={m.id}
                      className={cn("flex", inbound ? "justify-start" : "justify-end")}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words",
                          inbound
                            ? "bg-muted text-foreground rounded-bl-md"
                            : "bg-primary text-primary-foreground rounded-br-md",
                        )}
                      >
                        {kind !== "text" ? (
                          <PreviewMedia msg={m} customerId={lead.customerId} />
                        ) : null}
                        {caption ? (
                          <div className="whitespace-pre-wrap">{caption}</div>
                        ) : null}
                        <div
                          className={cn(
                            "text-[10px] mt-1 opacity-70",
                            inbound ? "text-left" : "text-right",
                          )}
                        >
                          {inbound ? "Cliente" : "Você / bot"} · {formatWhen(m.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {onOpenChat && lead.phone ? (
          <div className="shrink-0 border-t px-4 sm:px-6 py-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                onOpenChat(lead.phone);
                onOpenChange(false);
              }}
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Abrir no WhatsApp
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
