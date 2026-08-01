import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, XCircle, Loader2, Headphones, AlertTriangle, MessageCircle } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { CATEGORY_EMOJI, parseIntentName } from "@/lib/objectionShortcuts";
import {
  FAQ_AUDIO_PADROES,
  QA_AUDIO_APPROVED_TAG,
  faqPadraoKeyForIntent,
} from "@/lib/qaFaqAudioPriority";
import { AudioWhatsAppPopover } from "@/components/admin/AudioWhatsAppPopover";

type Trigger = { id?: string; phrase: string };
type Media = {
  id?: string;
  media_kind: "audio" | "video" | "image";
  media_id: string | null;
  slot_key: string | null;
};
type QA = {
  id: string;
  flow_id: string;
  intent_name: string;
  text_response: string | null;
  triggers: Trigger[];
  medias: Media[];
};
type LibAudio = {
  id: string;
  label: string;
  url: string | null;
  slot_key?: string | null;
  text_content?: string | null;
  intent_tags?: string[] | null;
  is_draft?: boolean;
};

type ReviewStatus = "pending" | "approved" | "no_audio";

function statusOf(lib: LibAudio | null): ReviewStatus {
  if (!lib?.url) return "no_audio";
  const tags = lib.intent_tags || [];
  if (tags.includes(QA_AUDIO_APPROVED_TAG)) return "approved";
  return "pending";
}

function cleanSpoken(raw: string): string {
  return String(raw || "")
    .replace(/\{\{\s*nome\s*\}\}/gi, "")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function FaqAudioReviewDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string;
  qas: QA[];
  availableAudios: LibAudio[];
  onChanged: () => Promise<void> | void;
}) {
  const { open, onOpenChange, flowId, qas, availableAudios, onChanged } = props;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState("todos");

  const audioById = useMemo(() => {
    const m = new Map<string, LibAudio>();
    availableAudios.forEach((a) => m.set(a.id, a));
    return m;
  }, [availableAudios]);

  const owned = useMemo(
    () => qas.filter((q) => q.flow_id === flowId),
    [qas, flowId],
  );

  /** Um card por atalho: áudio + todas as palavras-chave. */
  const allRows = useMemo(() => {
    return owned
      .map((qa) => {
        const audioMedia = qa.medias.find((m) => m.media_kind === "audio" && m.media_id);
        const lib = audioMedia?.media_id ? audioById.get(audioMedia.media_id) || null : null;
        const padrao = faqPadraoKeyForIntent(qa.intent_name);
        const padraoMeta = padrao
          ? FAQ_AUDIO_PADROES.find((p) => p.key === padrao)
          : null;
        return {
          qa,
          lib,
          audioMedia,
          status: statusOf(lib),
          padrao,
          padraoLabel: padraoMeta?.label || null,
          spoken: cleanSpoken(lib?.text_content || qa.text_response || ""),
        };
      })
      .sort((a, b) => a.qa.intent_name.localeCompare(b.qa.intent_name, "pt-BR"));
  }, [owned, audioById]);

  const counts = useMemo(() => {
    const pending = allRows.filter((r) => r.status === "pending").length;
    const approved = allRows.filter((r) => r.status === "approved").length;
    const noAudio = allRows.filter((r) => r.status === "no_audio").length;
    return { pending, approved, noAudio, total: allRows.length };
  }, [allRows]);

  const approve = async (id: string, lib: LibAudio, label: string) => {
    setBusyId(id);
    try {
      const tags = Array.from(new Set([...(lib.intent_tags || []), QA_AUDIO_APPROVED_TAG]));
      const { error } = await supabase
        .from("ai_media_library")
        .update({ is_draft: false, intent_tags: tags, updated_at: new Date().toISOString() })
        .eq("id", lib.id);
      if (error) throw error;
      toast.success(`Aprovado: ${label}`);
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao aprovar");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string, lib: LibAudio, label: string, qa: QA) => {
    setBusyId(id);
    try {
      for (const m of qa.medias.filter((x) => x.media_kind === "audio" && x.media_id === lib.id)) {
        if (m.id) {
          const { error } = await supabase
            .from("bot_flow_qa_media")
            .update({ media_id: null })
            .eq("id", m.id);
          if (error) throw error;
        }
      }
      if (lib.slot_key?.startsWith("qa_body:")) {
        const tags = (lib.intent_tags || []).filter((t) => t !== QA_AUDIO_APPROVED_TAG);
        const { error } = await supabase
          .from("ai_media_library")
          .update({
            active: false,
            is_draft: true,
            intent_tags: tags,
            updated_at: new Date().toISOString(),
          })
          .eq("id", lib.id);
        if (error) throw error;
      }
      toast.message("Reprovado — áudio desvinculado", { description: label });
      await onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao reprovar");
    } finally {
      setBusyId(null);
    }
  };

  const renderRows = (rows: typeof allRows) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground text-center py-8">Nenhum atalho nesta lista.</p>
    ) : (
      rows.map((r) => (
        <QaAudioCard
          key={r.qa.id}
          row={r}
          busy={busyId === r.qa.id}
          onApprove={() => r.lib && approve(r.qa.id, r.lib, r.qa.intent_name)}
          onReject={() => r.lib && reject(r.qa.id, r.lib, r.qa.intent_name, r.qa)}
        />
      ))
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90dvh] flex flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Headphones className="w-5 h-5 text-primary" />
            Revisar áudios FAQ
          </DialogTitle>
          <DialogDescription>
            Todos os atalhos deste fluxo: áudio + palavras-chave. Se o lead receber áudio, o bot
            <strong> não</strong> manda o mesmo texto escrito.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="default">Pendentes {counts.pending}</Badge>
          <Badge variant="secondary">Aprovados {counts.approved}</Badge>
          <Badge variant="outline">Sem áudio {counts.noAudio}</Badge>
          <Badge variant="outline">{counts.total} atalhos</Badge>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="todos">Todos ({counts.total})</TabsTrigger>
            <TabsTrigger value="pending">Pendentes ({counts.pending})</TabsTrigger>
            <TabsTrigger value="no_audio">Sem áudio ({counts.noAudio})</TabsTrigger>
          </TabsList>

          <TabsContent value="todos" className="flex-1 min-h-0 overflow-y-auto mt-3 space-y-3 pr-1">
            {renderRows(allRows)}
          </TabsContent>

          <TabsContent value="pending" className="flex-1 min-h-0 overflow-y-auto mt-3 space-y-3 pr-1">
            {renderRows(allRows.filter((r) => r.status === "pending"))}
          </TabsContent>

          <TabsContent value="no_audio" className="flex-1 min-h-0 overflow-y-auto mt-3 space-y-3 pr-1">
            {renderRows(allRows.filter((r) => r.status === "no_audio"))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function QaAudioCard(props: {
  row: {
    qa: QA;
    lib: LibAudio | null;
    status: ReviewStatus;
    padrao: string | null;
    padraoLabel: string | null;
    spoken: string;
  };
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { row, busy, onApprove, onReject } = props;
  const { category } = parseIntentName(row.qa.intent_name);

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        row.status === "approved"
          ? "border-primary/30 bg-primary/5"
          : row.status === "pending"
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-dashed border-muted-foreground/30 bg-muted/10"
      }`}
    >
      <div className="flex items-start gap-2 flex-wrap">
        {category && (
          <Badge variant="secondary" className="shrink-0">
            {CATEGORY_EMOJI[category]} {category}
          </Badge>
        )}
        <p className="font-semibold text-sm flex-1 min-w-0">{row.qa.intent_name}</p>
        {row.padraoLabel && (
          <Badge variant="outline" className="text-[10px]">
            áudio compartilhado
          </Badge>
        )}
        {row.status === "approved" && (
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="w-3 h-3" /> Aprovado
          </Badge>
        )}
        {row.status === "pending" && (
          <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3 h-3" /> Pendente
          </Badge>
        )}
        {row.status === "no_audio" && (
          <Badge variant="outline" className="text-muted-foreground">
            Sem áudio
          </Badge>
        )}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Palavras-chave ({row.qa.triggers.length})
        </p>
        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
          {row.qa.triggers.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">Sem palavras-chave</span>
          ) : (
            row.qa.triggers.map((t) => (
              <Badge key={t.id || t.phrase} variant="outline" className="text-[11px] font-normal">
                {t.phrase}
              </Badge>
            ))
          )}
        </div>
      </div>

      {row.spoken && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 border-l-2 border-primary/30 pl-2">
          {row.spoken}
        </p>
      )}

      {row.lib?.url ? (
        <audio controls src={row.lib.url} className="w-full h-9" preload="none" />
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Áudio ainda não vinculado. Gere TTS ou grave e associe no card do atalho.
        </p>
      )}

      {row.lib?.url && (
        <AudioWhatsAppPopover
          audioUrl={row.lib.url}
          label={`FAQ · ${row.qa.intent_name}`}
          trigger={
            <Button type="button" size="sm" variant="secondary" className="w-full gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" />
              Enviar no WhatsApp
            </Button>
          }
        />
      )}

      {row.status !== "no_audio" && row.lib && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1"
            disabled={busy || row.status === "approved"}
            onClick={onApprove}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
            {row.status === "approved" ? "Já aprovado" : "Aceitar"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={busy}
            onClick={onReject}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <XCircle className="w-3.5 h-3.5 mr-1" />}
            Reprovar
          </Button>
        </div>
      )}
    </div>
  );
}
