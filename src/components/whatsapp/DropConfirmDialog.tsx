import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquare, Image, Mic, Video, Send, X, MoveRight, Play, FileText } from "lucide-react";

const REJECTION_REASONS = [
  { value: "baixa_renda", label: "Baixa renda" },
  { value: "icms_baixo", label: "ICMS baixo" },
  { value: "emprestimo_conta", label: "Empréstimo na conta de energia" },
  { value: "outro", label: "Outro" },
];

interface AutoMessagePreview {
  message_type: string;
  message_text: string | null;
  media_url: string | null;
  image_url: string | null;
  delay_seconds: number;
  rejection_reason: string | null;
  deal_origin: string | null;
}

interface DropConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (sendMessages: boolean, rejectionReason?: string) => void;
  stageLabel: string;
  stageKey: string;
  stageId: string;
  consultantId: string;
  dealName: string;
  dealOrigin?: string | null;
}

function MediaPreview({ msg }: { msg: AutoMessagePreview }) {
  const isAudio = msg.message_type === "audio" && msg.media_url;
  const isImage = msg.message_type === "image" && msg.media_url;
  const isVideo = msg.message_type === "video" && msg.media_url;
  const hasAttachedImage = msg.image_url && msg.message_type !== "image";

  return (
    <div className="space-y-2">
      {/* Attached image (sent before the main content) */}
      {hasAttachedImage && (
        <div className="rounded-md overflow-hidden border border-border/50 bg-black/20">
          <img
            src={msg.image_url!}
            alt="Imagem anexada"
            className="w-full max-h-[140px] object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
            }}
          />
          <div className="hidden flex items-center gap-2 p-2 text-[10px] text-muted-foreground">
            <Image className="h-3 w-3" /> Imagem (prévia indisponível)
          </div>
        </div>
      )}

      {/* Audio player */}
      {isAudio && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gradient-to-r from-warning/10 to-warning/5 border border-warning/20">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-warning/20 shrink-0">
            <Mic className="h-4 w-4 text-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <audio
              controls
              preload="metadata"
              className="w-full h-8 [&::-webkit-media-controls-panel]:bg-transparent"
              style={{ maxHeight: "32px" }}
            >
              <source src={msg.media_url!} />
            </audio>
          </div>
        </div>
      )}

      {/* Image preview */}
      {isImage && (
        <div className="rounded-md overflow-hidden border border-border/50 bg-black/20">
          <img
            src={msg.media_url!}
            alt="Prévia da imagem"
            className="w-full max-h-[160px] object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
            }}
          />
          <div className="hidden flex items-center gap-2 p-2 text-[10px] text-muted-foreground">
            <Image className="h-3 w-3" /> Imagem (prévia indisponível)
          </div>
        </div>
      )}

      {/* Video preview */}
      {isVideo && (
        <div className="rounded-md overflow-hidden border border-border/50 bg-black/20">
          <video
            controls
            preload="metadata"
            className="w-full max-h-[160px]"
          >
            <source src={msg.media_url!} />
          </video>
        </div>
      )}

      {/* Text message */}
      {msg.message_text && (
        <div className="p-2.5 rounded-lg bg-secondary/60 border border-border/40">
          <p className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">
            {msg.message_text}
          </p>
        </div>
      )}
    </div>
  );
}

function MessageTypeLabel({ type }: { type: string }) {
  switch (type) {
    case "audio":
      return (
        <Badge variant="secondary" className="text-[9px] gap-1 bg-warning/10 text-warning border-warning/20">
          <Mic className="h-2.5 w-2.5" /> Áudio
        </Badge>
      );
    case "image":
      return (
        <Badge variant="secondary" className="text-[9px] gap-1 bg-info/10 text-info border-info/20">
          <Image className="h-2.5 w-2.5" /> Imagem
        </Badge>
      );
    case "video":
      return (
        <Badge variant="secondary" className="text-[9px] gap-1 bg-primary/10 text-primary border-primary/20">
          <Video className="h-2.5 w-2.5" /> Vídeo
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-[9px] gap-1">
          <FileText className="h-2.5 w-2.5" /> Texto
        </Badge>
      );
  }
}

export function DropConfirmDialog({
  open,
  onClose,
  onConfirm,
  stageLabel,
  stageKey,
  stageId,
  consultantId,
  dealName,
  dealOrigin,
}: DropConfirmDialogProps) {
  const [allMessages, setAllMessages] = useState<AutoMessagePreview[]>([]);
  const [rejectionReason, setRejectionReason] = useState("");
  const isReprovado = stageKey === "reprovado";

  useEffect(() => {
    if (!open) return;
    setRejectionReason("");
    (async () => {
      const { data } = await supabase
        .from("stage_auto_messages")
        .select("message_type, message_text, media_url, image_url, delay_seconds, rejection_reason, deal_origin")
        .eq("stage_id", stageId)
        .eq("consultant_id", consultantId)
        .order("position", { ascending: true });
      setAllMessages((data as AutoMessagePreview[]) || []);
    })();
  }, [open, stageId, consultantId]);

  const filteredMessages = (() => {
    let msgs = allMessages;
    if (isReprovado && rejectionReason) {
      msgs = msgs.filter((m) => !m.rejection_reason || m.rejection_reason === rejectionReason);
    } else if (isReprovado) {
      msgs = msgs.filter((m) => !m.rejection_reason);
    } else {
      msgs = msgs.filter((m) => !m.rejection_reason);
    }
    if (dealOrigin) {
      msgs = msgs.filter((m) => !m.deal_origin || m.deal_origin === dealOrigin);
    } else {
      msgs = msgs.filter((m) => !m.deal_origin);
    }
    return msgs;
  })();

  const canConfirm = !isReprovado || rejectionReason;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <MoveRight className="h-4 w-4" />
            Mover para
            <Badge variant="secondary" className="text-[10px]">{stageLabel}</Badge>
          </DialogTitle>
        </DialogHeader>

        <p className="text-[11px] text-muted-foreground">
          Cliente interessado: <span className="font-medium text-foreground">{dealName}</span>
        </p>

        {/* Rejection reason selector */}
        {isReprovado && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-foreground">
              Motivo da reprovação <span className="text-destructive">*</span>
            </label>
            <Select value={rejectionReason} onValueChange={setRejectionReason}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Selecione o motivo..." />
              </SelectTrigger>
              <SelectContent>
                {REJECTION_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value} className="text-xs">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Message preview */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-foreground">
            Prévia das mensagens ({filteredMessages.length}):
          </p>
          {filteredMessages.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic py-3 text-center">
              {isReprovado && !rejectionReason
                ? "Selecione o motivo para ver as mensagens"
                : "Nenhuma mensagem configurada para esta coluna"}
            </p>
          ) : (
            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
              {filteredMessages.map((msg, i) => (
                <div key={i} className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
                  {/* Message header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/30 border-b border-border/30">
                    <span className="text-[10px] text-muted-foreground font-medium">
                      Msg {i + 1}
                    </span>
                    <MessageTypeLabel type={msg.message_type} />
                    {msg.image_url && msg.message_type !== "image" && (
                      <Badge variant="secondary" className="text-[9px] gap-1 bg-info/10 text-info border-info/20">
                        <Image className="h-2.5 w-2.5" /> + Imagem
                      </Badge>
                    )}
                    {i > 0 && msg.delay_seconds > 0 && (
                      <span className="text-[9px] text-muted-foreground ml-auto">
                        ⏱ {msg.delay_seconds}s
                      </span>
                    )}
                  </div>
                  {/* Message content preview */}
                  <div className="p-3">
                    <MediaPreview msg={msg} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={onClose}>
            <X className="h-3 w-3" />
            Cancelar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => onConfirm(false, isReprovado ? rejectionReason : undefined)}
            disabled={!canConfirm}
          >
            <MoveRight className="h-3 w-3" />
            Sem mensagem
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => onConfirm(true, isReprovado ? rejectionReason : undefined)}
            disabled={!canConfirm || filteredMessages.length === 0}
          >
            <Send className="h-3 w-3" />
            Confirmar e Enviar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { REJECTION_REASONS };
