import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Ban, FileText, ImageIcon, Loader2, MessageSquare, Mic, Pause, Phone, Receipt, Trophy, UserX, Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  billAttentionFromCustomer,
  billAttentionFromInboundMessages,
  mergeBillAttention,
  type BillAttention,
} from "@/lib/customerBillAttention";
import {
  CADENCE_GROUP_BADGE,
  cadenceStageGroup,
  labelCadenceStage,
  labelPausedReason,
} from "@/lib/cadenceStageLabels";
import { clearConversationMediaCache } from "@/lib/conversationMediaResolver";
import {
  ConversationMessageBody,
  CONVERSATION_MESSAGE_SELECT,
  type ConversationMessageRow,
  type LastInboundMedia,
} from "@/components/whatsapp/ConversationMessageBody";

type ClassifyAction = "pause" | "won" | "lost" | "not_lead";

export type CadenceContactPreview = {
  cadenceStateId: string;
  customerId: string | null;
  name: string | null;
  phone: string;
  ddd: string;
  stage: string;
  paused: boolean;
  pausedReason: string | null;
  isLead: boolean;
  billAttention?: BillAttention | null;
};

type Msg = ConversationMessageRow;

const PAGE = 60;

function fmtWhen(iso: string) {
  try {
    return format(new Date(iso), "dd/MM/yy HH:mm", { locale: ptBR });
  } catch {
    return iso;
  }
}

function mediaIcon(type: string | null) {
  switch ((type || "").toLowerCase()) {
    case "audio": return <Mic className="w-3 h-3" />;
    case "image": return <ImageIcon className="w-3 h-3" />;
    case "video": return <Video className="w-3 h-3" />;
    case "document": return <FileText className="w-3 h-3" />;
    default: return null;
  }
}

function senderLabel(direction: string) {
  if (direction === "inbound") return "Cliente";
  if (direction === "outbound") return "Consultor/Bot";
  return "Sistema";
}

interface Props {
  contact: CadenceContactPreview | null;
  busy: boolean;
  onClose: () => void;
  onClassify: (cadenceStateId: string, action: ClassifyAction) => void;
  onOpenChat?: (phone: string) => void;
}

export function CadenceContactHistoryDialog({ contact, busy, onClose, onClassify, onOpenChat }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInbound, setLastInbound] = useState<LastInboundMedia>({ url: null, messageId: null, kind: null });
  const [billAttention, setBillAttention] = useState<BillAttention>({ active: false, label: "", priority: "medium" });
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async (customerId: string, before?: string) => {
    let q = supabase
      .from("conversations")
      .select(CONVERSATION_MESSAGE_SELECT)
      .eq("customer_id", customerId)
      .not("message_text", "like", "[__safety_ping__]%")
      .not("message_text", "like", "[inline-sent]%")
      .not("message_text", "like", "[failed:%")
      .order("created_at", { ascending: false })
      .limit(PAGE);

    if (before) q = q.lt("created_at", before);

    const { data, error: err } = await q;
    if (err) throw new Error(err.message);
    const batch = ((data as Msg[]) || []).reverse();
    return { batch, hasMore: (data?.length ?? 0) >= PAGE };
  }, []);

  useEffect(() => {
    clearConversationMediaCache();
    if (!contact?.customerId) {
      setMessages([]);
      setHasMore(false);
      setError(null);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { batch, hasMore: more } = await loadMessages(contact.customerId!);
        if (!alive) return;
        setMessages(batch);
        setHasMore(more);
      } catch (e: unknown) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setMessages([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [contact?.customerId, loadMessages]);

  useEffect(() => {
    if (!contact?.customerId) {
      setLastInbound({ url: null, messageId: null, kind: null });
      setBillAttention(contact?.billAttention ?? { active: false, label: "", priority: "medium" });
      return;
    }
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("customers")
        .select(
          "last_inbound_media_url, last_inbound_media_message_id, last_inbound_media_kind, last_inbound_media_at, electricity_bill_photo_url, electricity_bill_value, bill_data_confirmed_at, conversation_step",
        )
        .eq("id", contact.customerId!)
        .maybeSingle();
      if (!alive || !data) return;
      setLastInbound({
        url: (data as { last_inbound_media_url?: string | null }).last_inbound_media_url || null,
        messageId: (data as { last_inbound_media_message_id?: string | null }).last_inbound_media_message_id || null,
        kind: (data as { last_inbound_media_kind?: string | null }).last_inbound_media_kind || null,
      });
      const fromCust = billAttentionFromCustomer(data as Parameters<typeof billAttentionFromCustomer>[0]);
      setBillAttention(mergeBillAttention(contact.billAttention ?? fromCust, fromCust));
    })();
    return () => { alive = false; };
  }, [contact?.customerId, contact?.billAttention, contact?.cadenceStateId]);

  useEffect(() => {
    if (!messages.length) return;
    const fromMsgs = billAttentionFromInboundMessages(messages);
    setBillAttention((prev) => mergeBillAttention(prev, fromMsgs));
  }, [messages]);

  useEffect(() => {
    if (!loading && messages.length > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [loading, contact?.cadenceStateId]);

  async function loadOlder() {
    if (!contact?.customerId || !messages.length || loadingMore) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingMore(true);
    try {
      const { batch, hasMore: more } = await loadMessages(contact.customerId, messages[0].created_at);
      setMessages((prev) => [...batch, ...prev]);
      setHasMore(more);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const open = !!contact;
  const stageShort = contact ? labelCadenceStage(contact.stage, "short") : "";
  const group = contact ? cadenceStageGroup(contact.stage) : null;
  const groupLabel = group ? CADENCE_GROUP_BADGE[group] : null;
  const pausedMeta = contact ? labelPausedReason(contact.pausedReason) : null;
  const showBill = billAttention.active;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          "max-w-lg sm:max-w-xl p-0 gap-0 overflow-hidden flex flex-col h-[min(92dvh,720px)]",
          showBill && "ring-2 ring-amber-500/50",
        )}
      >
        {contact && (
          <>
            <DialogHeader className="shrink-0 px-5 pt-5 pb-3 border-b border-border/50 space-y-2">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold tabular-nums",
                    contact.isLead ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {contact.ddd}
                </div>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-base leading-tight truncate pr-6">
                    {contact.name || "Sem nome"}
                  </DialogTitle>
                  <DialogDescription className="flex items-center gap-1.5 mt-0.5">
                    <Phone className="w-3 h-3 shrink-0" />
                    <span className="truncate">{contact.phone || "—"}</span>
                  </DialogDescription>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <Badge variant="outline" className="text-[10px]">{stageShort}</Badge>
                    {groupLabel && group !== "fim" && (
                      <Badge variant="secondary" className="text-[10px]">{groupLabel}</Badge>
                    )}
                    {contact.paused && pausedMeta && (
                      <Badge variant="secondary" className="text-[10px]" title={pausedMeta.hint}>
                        {pausedMeta.label}
                      </Badge>
                    )}
                    <Badge variant={contact.isLead ? "default" : "secondary"} className="text-[10px]">
                      {contact.isLead ? "Lead DDD " + contact.ddd : "Fora do DDD lead"}
                    </Badge>
                  </div>
                  {onOpenChat && contact.phone && (
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2 h-8 text-xs gap-1.5 w-full sm:w-auto"
                      onClick={() => {
                        onOpenChat(contact.phone);
                        onClose();
                      }}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Abrir no chat interno
                    </Button>
                  )}
                </div>
              </div>
              {showBill && (
                <div
                  className={cn(
                    "rounded-xl border px-3 py-2.5 flex gap-2 items-start",
                    billAttention.priority === "high"
                      ? "border-amber-500/60 bg-gradient-to-r from-amber-500/20 via-amber-400/10 to-transparent animate-pulse"
                      : "border-amber-500/40 bg-amber-500/10",
                  )}
                >
                  <Receipt className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-amber-900 dark:text-amber-100">
                      ⚡ {billAttention.label}
                    </p>
                    {billAttention.detail && (
                      <p className="text-[11px] text-amber-950/80 dark:text-amber-50/80 mt-0.5 leading-snug">
                        {billAttention.detail}
                      </p>
                    )}
                    {onOpenChat && contact.phone && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="mt-2 h-7 text-[10px] gap-1 border-amber-500/30"
                        onClick={() => {
                          onOpenChat(contact.phone);
                          onClose();
                        }}
                      >
                        <MessageSquare className="w-3 h-3" />
                        Ver fatura no chat
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </DialogHeader>

            <div className="flex-1 min-h-0 flex flex-col px-5 py-3 overflow-hidden">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Histórico da conversa
                </p>
                {messages.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {messages.length} msg(s) · ↑↓ role
                  </span>
                )}
              </div>

              <div
                ref={scrollRef}
                className="flex-1 min-h-0 h-0 overflow-y-auto overscroll-contain rounded-xl border border-border/50 bg-muted/15"
              >
                <div className="p-3 space-y-2">
                  {!contact.customerId ? (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      Cliente não vinculado — sem histórico no banco.
                    </p>
                  ) : loading ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-xs">Carregando mensagens…</span>
                    </div>
                  ) : error ? (
                    <p className="text-xs text-destructive text-center py-8">{error}</p>
                  ) : messages.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      Nenhuma mensagem registrada. Pode ser número novo ou só cadência automática ainda não enviada.
                    </p>
                  ) : (
                    <>
                      {hasMore && (
                        <div className="flex justify-center pb-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[10px]"
                            disabled={loadingMore}
                            onClick={() => void loadOlder()}
                          >
                            {loadingMore ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                            Ver mensagens mais antigas
                          </Button>
                        </div>
                      )}
                      {messages.map((m) => {
                        const inbound = m.message_direction === "inbound";
                        return (
                          <div
                            key={m.id}
                            className={cn(
                              "rounded-xl px-3 py-2 text-[12px] leading-snug",
                              inbound
                                ? "mr-6 bg-info/10 border border-info/15"
                                : "ml-6 bg-primary/10 border border-primary/15",
                            )}
                          >
                            <div
                              className={cn(
                                "mb-1.5 flex items-center gap-1.5 text-[9px] text-muted-foreground",
                                inbound ? "justify-start" : "justify-end",
                              )}
                            >
                              {mediaIcon(m.message_type)}
                              <span className="font-semibold">{senderLabel(m.message_direction)}</span>
                              <span>{fmtWhen(m.created_at)}</span>
                            </div>
                            <div className="text-left">
                              <ConversationMessageBody
                                row={m}
                                customerId={contact.customerId!}
                                lastInbound={lastInbound}
                                tone="light"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground mt-2 shrink-0 leading-snug">
                Role para ler tudo. Se o cliente respondeu com interesse real, é lead — se for teste ou fora da região, classifique abaixo.
              </p>
            </div>

            <DialogFooter className="shrink-0 px-5 py-4 border-t border-border/50 flex-col gap-2">
              {contact.phone && onOpenChat && (
                <Button
                  type="button"
                  size="sm"
                  className="w-full h-9 text-xs gap-2 shrink-0"
                  onClick={() => {
                    onOpenChat(contact.phone);
                    onClose();
                  }}
                >
                  <MessageSquare className="w-4 h-4" />
                  Abrir no chat interno
                </Button>
              )}
              <div className="flex flex-col sm:flex-row gap-2 w-full">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5 flex-1"
                disabled={busy}
                onClick={() => onClassify(contact.cadenceStateId, "not_lead")}
              >
                <UserX className="w-3.5 h-3.5" /> Não é lead (bloqueia)
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5 flex-1"
                disabled={busy}
                onClick={() => onClassify(contact.cadenceStateId, "pause")}
              >
                <Pause className="w-3.5 h-3.5" /> Pausar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5 flex-1"
                disabled={busy}
                onClick={() => onClassify(contact.cadenceStateId, "won")}
              >
                <Trophy className="w-3.5 h-3.5" /> Ganhou
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5 flex-1"
                disabled={busy}
                onClick={() => onClassify(contact.cadenceStateId, "lost")}
              >
                <Ban className="w-3.5 h-3.5" /> Perdido (bloqueia)
              </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
