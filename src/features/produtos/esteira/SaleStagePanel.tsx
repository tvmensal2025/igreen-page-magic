// =============================================================================
// Esteira — Painel da Venda (etapas, observação e anexos)
// =============================================================================

import { useState } from "react";
import { CheckCircle2, Circle, FileDown, Paperclip, Trash2, Upload } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  useRemoveAttachment,
  useSaleStages,
  useSetStageNote,
  useSetStageStatus,
  useStageAttachments,
  useUploadAttachment,
} from "./hooks";
import { computeProgress, validateUpload } from "./logic";
import { getAttachmentSignedUrl } from "./api";
import type { SaleStage, StageAttachment } from "./types";

interface SaleStagePanelProps {
  saleId: string;
}

export function SaleStagePanel({ saleId }: SaleStagePanelProps) {
  const { data: stages = [], isLoading } = useSaleStages(saleId);
  const progress = computeProgress(stages);

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-center justify-between text-xs text-pv-ink/70">
          <span>Etapas concluídas</span>
          <span className="font-semibold">
            {progress.done} / {progress.total}
          </span>
        </div>
        <Progress value={Math.round(progress.ratio * 100)} />
      </header>

      {isLoading && <p className="text-xs text-pv-ink/40">Carregando...</p>}
      {!isLoading && stages.length === 0 && (
        <p className="text-xs text-pv-ink/50 italic">
          Nenhuma etapa configurada. Peça ao administrador para inicializar o
          modelo padrão.
        </p>
      )}

      <ol className="space-y-3">
        {stages.map((s) => (
          <StageItem key={s.id} stage={s} saleId={saleId} />
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StageItem({ stage, saleId }: { stage: SaleStage; saleId: string }) {
  const [noteDraft, setNoteDraft] = useState(stage.note ?? "");
  const [showNote, setShowNote] = useState(Boolean(stage.note));
  const setStatus = useSetStageStatus(saleId);
  const setNote = useSetStageNote(saleId);
  const { toast } = useToast();

  const done = stage.status === "concluido";

  const toggle = async () => {
    try {
      await setStatus.mutateAsync({
        stageId: stage.id,
        status: done ? "pendente" : "concluido",
      });
    } catch (err) {
      toast({
        title: "Não foi possível atualizar a etapa",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const saveNote = async () => {
    try {
      await setNote.mutateAsync({ stageId: stage.id, note: noteDraft });
      toast({ title: "Observação salva" });
    } catch (err) {
      toast({
        title: "Não foi possível salvar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <li className="border border-pv-mid/40 bg-white p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={setStatus.isPending}
          className="mt-0.5 text-pv-accent"
          aria-label={done ? "Marcar como pendente" : "Marcar como concluído"}
        >
          {done ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : (
            <Circle className="h-5 w-5 text-pv-ink/40" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className={`text-sm font-semibold ${done ? "text-pv-ink/60 line-through" : "text-pv-ink"}`}>
              {stage.position + 1}. {stage.name}
            </h4>
            <button
              type="button"
              onClick={() => setShowNote((v) => !v)}
              className="text-[10px] uppercase tracking-wider text-pv-accent hover:underline"
            >
              {showNote ? "Ocultar nota" : "Adicionar nota"}
            </button>
          </div>
          {stage.completedAt && (
            <p className="text-[10px] text-pv-ink/40 mt-0.5">
              Concluído em {new Date(stage.completedAt).toLocaleString("pt-BR")}
            </p>
          )}
          {showNote && (
            <div className="mt-2 space-y-2">
              <Textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={2}
                placeholder="Observação interna (opcional)"
                className="text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void saveNote()}
                disabled={setNote.isPending || noteDraft === (stage.note ?? "")}
              >
                Salvar nota
              </Button>
            </div>
          )}
          <AttachmentsBlock saleId={saleId} stageId={stage.id} />
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

function AttachmentsBlock({ saleId, stageId }: { saleId: string; stageId: string }) {
  const { data: items = [] } = useStageAttachments(stageId);
  const upload = useUploadAttachment(stageId);
  const remove = useRemoveAttachment(stageId);
  const { toast } = useToast();

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const check = validateUpload({ sizeBytes: file.size, mime: file.type });
    if (!check.ok) {
      toast({ title: "Arquivo inválido", description: check.message, variant: "destructive" });
      return;
    }
    try {
      await upload.mutateAsync({ saleId, file });
      toast({ title: "Anexo enviado" });
    } catch (err) {
      toast({
        title: "Falha no upload",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const onDownload = async (att: StageAttachment) => {
    try {
      const url = await getAttachmentSignedUrl(att);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({
        title: "Não foi possível abrir o anexo",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const onRemove = async (att: StageAttachment) => {
    if (!window.confirm(`Remover "${att.fileName}"?`)) return;
    try {
      await remove.mutateAsync(att);
    } catch (err) {
      toast({
        title: "Falha ao remover",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-pv-ink/50 flex items-center gap-1">
          <Paperclip className="h-3 w-3" /> Anexos ({items.length})
        </span>
        <label className="inline-flex items-center gap-1 text-[10px] text-pv-accent cursor-pointer hover:underline">
          <Upload className="h-3 w-3" />
          {upload.isPending ? "Enviando..." : "Adicionar"}
          <input
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={onPick}
            disabled={upload.isPending}
          />
        </label>
      </div>
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((att) => (
            <li
              key={att.id}
              className="flex items-center justify-between text-xs bg-pv-bg/60 border border-pv-mid/20 px-2 py-1.5"
            >
              <button
                type="button"
                onClick={() => void onDownload(att)}
                className="flex items-center gap-1.5 truncate text-pv-ink hover:text-pv-accent"
              >
                <FileDown className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{att.fileName}</span>
              </button>
              <button
                type="button"
                onClick={() => void onRemove(att)}
                className="text-red-500 hover:text-red-700 ml-2"
                aria-label="Remover"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
