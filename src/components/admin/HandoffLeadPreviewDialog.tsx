/**
 * Popup: nome + foto (se houver) + histórico de mensagens do lead.
 */
import { useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { HandoffLead } from "@/lib/handoffReturnToPizza";

type Msg = {
  id: string;
  message_direction: string;
  message_text: string | null;
  message_type: string | null;
  created_at: string;
};

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

function previewText(text: string | null, type: string | null): string {
  const t = String(text || "").trim();
  if (t.startsWith("[__safety_ping__]") || t.startsWith("[inline-sent]") || t.startsWith("[failed:")) {
    return "";
  }
  if (t) return t;
  const kind = String(type || "").toLowerCase();
  if (kind.includes("image") || kind.includes("photo")) return "[foto]";
  if (kind.includes("audio")) return "[áudio]";
  if (kind.includes("video")) return "[vídeo]";
  if (kind.includes("document")) return "[documento]";
  return "[sem texto]";
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
        .select("id, message_direction, message_text, message_type, created_at")
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
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="sr-only">Conversa com {lead.displayName}</DialogTitle>
          <DialogDescription className="sr-only">
            Nome, foto e mensagens deste lead
          </DialogDescription>
          <div className="flex items-center gap-3 pt-1">
            <Avatar className="h-14 w-14 border border-border">
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

        <ScrollArea className="flex-1 min-h-[280px] max-h-[50vh] rounded-md border border-border/60 px-3 py-2">
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
                const body = previewText(m.message_text, m.message_type);
                if (!body) return null;
                return (
                  <div
                    key={m.id}
                    className={cn("flex", inbound ? "justify-start" : "justify-end")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                        inbound
                          ? "bg-muted text-foreground rounded-bl-md"
                          : "bg-primary text-primary-foreground rounded-br-md",
                      )}
                    >
                      <div>{body}</div>
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
        </ScrollArea>

        {onOpenChat && lead.phone ? (
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
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
