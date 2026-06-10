import { useState, useRef, useCallback } from "react";
import {
  Plus, Image as ImageIcon, Mic, File, Upload, Loader2, CheckCircle2, Square, X,
  Video, Type, Trash2, ArrowUp, ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { TemplateMediaType, TemplateItem } from "@/types/whatsapp";
import { uploadMedia, getAcceptString, formatFileSize } from "@/services/minioUpload";
import { toast } from "sonner";
import { formatRecordingTime } from "./templateUtils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpusRecorderClass = any;
let RecorderPromise: Promise<OpusRecorderClass> | null = null;
async function loadRecorder(): Promise<OpusRecorderClass> {
  if (!RecorderPromise) RecorderPromise = import("opus-recorder").then((m) => (m as { default: OpusRecorderClass }).default || m);
  return RecorderPromise;
}

const ITEM_TYPES: { value: TemplateMediaType; label: string; icon: React.ElementType }[] = [
  { value: "text", label: "Texto", icon: Type },
  { value: "image", label: "Imagem", icon: ImageIcon },
  { value: "audio", label: "Áudio", icon: Mic },
  { value: "video", label: "Vídeo", icon: Video },
  { value: "document", label: "Documento", icon: File },
];

export function emptyTemplateItem(position: number): TemplateItem {
  return { position, message_type: "text", message_text: "", media_url: null, image_url: null, delay_seconds: position > 0 ? 3 : 0 };
}

// ---------------------------------------------------------------------------
// Item individual (1 arquivo do template)
// ---------------------------------------------------------------------------
function ItemCard({
  item, index, total, templateName, disabled,
  onChange, onRemove, onMoveUp, onMoveDown,
}: {
  item: TemplateItem;
  index: number;
  total: number;
  templateName: string;
  disabled?: boolean;
  onChange: (updated: TemplateItem) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recorderRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const TypeIcon = ITEM_TYPES.find((t) => t.value === item.message_type)?.icon || Type;

  const doUpload = useCallback(async (file: File) => {
    if (file.size > 100 * 1024 * 1024) { toast.error("Arquivo muito grande (máximo 100MB)"); return; }
    if (item.message_type === "audio" && (file.type === "audio/webm" || /\.webm$/i.test(file.name))) {
      toast.error("WhatsApp não aceita áudio .webm. Use .ogg, .mp3 ou .m4a."); return;
    }
    setUploading(true); setProgress(0);
    try {
      const kind = item.message_type === "text" ? "document" : item.message_type;
      const result = await uploadMedia(file, (p) => setProgress(p), { scope: "template", kind, slug: templateName || file.name });
      onChange({ ...item, media_url: result.url });
      toast.success(`Arquivo enviado: ${formatFileSize(result.size)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [item, templateName, onChange]);

  const startRecording = useCallback(async () => {
    try {
      const Recorder = await loadRecorder();
      const recorder = new Recorder({ encoderPath: "/opus/encoderWorker.min.js", encoderApplication: 2048, encoderSampleRate: 16000, encoderFrameSize: 20, numberOfChannels: 1, streamPages: false, rawOpus: false });
      recorder.ondataavailable = async (arrayBuffer: ArrayBuffer) => {
        const blob = new Blob([arrayBuffer], { type: "audio/ogg" });
        const file = Object.assign(blob, { name: `gravacao_${Date.now()}.ogg`, lastModified: Date.now() }) as unknown as File;
        await doUpload(file);
      };
      recorderRef.current = recorder;
      await recorder.start();
      setIsRecording(true); setRecTime(0);
      timerRef.current = setInterval(() => setRecTime((p) => p + 1), 1000);
    } catch {
      toast.error("Não foi possível acessar o microfone");
    }
  }, [doUpload]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current) { try { recorderRef.current.stop(); } catch { /* ignore */ } }
    setIsRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border/50">
        <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center">
          <TypeIcon className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-xs font-semibold flex-1">
          Item {index + 1} <span className="text-muted-foreground font-normal">de {total}</span>
        </span>
        {index > 0 && item.delay_seconds > 0 && (
          <Badge variant="outline" className="text-[9px]">⏱ {item.delay_seconds}s</Badge>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={disabled || index === 0} onClick={onMoveUp} title="Subir">
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={disabled || index === total - 1} onClick={onMoveDown} title="Descer">
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" disabled={disabled || total === 1} onClick={onRemove} title="Remover">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="p-3 space-y-3">
        {/* Tipo */}
        <div className="grid grid-cols-5 gap-1.5">
          {ITEM_TYPES.map((t) => {
            const Icon = t.icon;
            const active = item.message_type === t.value;
            return (
              <button
                key={t.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...item, message_type: t.value, media_url: t.value === "text" ? null : item.media_url })}
                className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-all ${
                  active ? "border-primary/50 bg-primary/10" : "border-border/40 bg-secondary/10 hover:bg-secondary/20"
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`text-[10px] font-bold ${active ? "text-primary" : "text-muted-foreground"}`}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Upload de mídia */}
        {item.message_type !== "text" && (
          <div className="space-y-2">
            <input ref={fileRef} type="file" accept={getAcceptString(item.message_type)} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); }} />
            <div className="flex gap-1.5">
              <Button type="button" variant="outline" className="flex-1 h-10 gap-2 border-dashed border-2" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : item.media_url ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <Upload className="w-4 h-4" />}
                <span className="text-xs truncate">{uploading ? "Enviando..." : item.media_url ? "Arquivo enviado" : "Enviar arquivo"}</span>
              </Button>
              {item.message_type === "audio" && (
                isRecording ? (
                  <Button type="button" variant="outline" className="h-10 gap-1.5 border-destructive/40" onClick={stopRecording}>
                    <Square className="w-3.5 h-3.5 fill-current text-destructive" />
                    <span className="text-xs text-destructive tabular-nums">{formatRecordingTime(recTime)}</span>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className="h-10 gap-1.5 border-warning/30" disabled={disabled} onClick={startRecording}>
                    <Mic className="w-4 h-4 text-warning" />
                  </Button>
                )
              )}
            </div>
            {uploading && <Progress value={progress} className="h-1.5" />}

            {item.media_url && !uploading && (
              <div className="rounded-lg border border-border/30 bg-secondary/10 p-2 flex items-center gap-2">
                {item.message_type === "image" && <img src={item.media_url} alt="" className="rounded max-h-24 object-contain" />}
                {item.message_type === "video" && <video src={item.media_url} controls className="rounded max-h-32 w-full object-contain bg-black" />}
                {item.message_type === "audio" && <audio src={item.media_url} controls className="w-full h-8" />}
                {item.message_type === "document" && (
                  <a href={item.media_url} target="_blank" rel="noopener noreferrer" className="text-xs text-info hover:underline flex items-center gap-1">
                    <File className="w-3.5 h-3.5" /> Abrir documento
                  </a>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0 ml-auto" onClick={() => onChange({ ...item, media_url: null })}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
            <Input placeholder="Ou cole uma URL…" value={item.media_url || ""} disabled={disabled} onChange={(e) => onChange({ ...item, media_url: e.target.value || null })}
              className="h-8 text-xs font-mono bg-secondary/40" />
          </div>
        )}

        {/* Texto / legenda */}
        <Textarea
          placeholder={item.message_type === "text" ? "Conteúdo da mensagem…" : "Legenda (opcional)…"}
          value={item.message_text || ""}
          disabled={disabled}
          onChange={(e) => onChange({ ...item, message_text: e.target.value })}
          rows={item.message_type === "text" ? 3 : 2}
          className="text-xs resize-none bg-secondary/30"
        />

        {/* Delay */}
        {index > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">⏱ Enviar após</span>
            <Input type="number" min={0} value={item.delay_seconds} disabled={disabled}
              onChange={(e) => onChange({ ...item, delay_seconds: parseInt(e.target.value) || 0 })}
              className="h-7 w-20 text-xs" />
            <span className="text-[10px] text-muted-foreground">segundos do item anterior</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de lista de itens (reutilizável: criação e edição)
// ---------------------------------------------------------------------------
export function TemplateItemsEditor({
  items, onItemsChange, templateName, disabled,
}: {
  items: TemplateItem[];
  onItemsChange: (items: TemplateItem[]) => void;
  templateName: string;
  disabled?: boolean;
}) {
  const updateItem = (i: number, updated: TemplateItem) =>
    onItemsChange(items.map((it, idx) => (idx === i ? updated : it)));

  const removeItem = (i: number) =>
    onItemsChange(items.filter((_, idx) => idx !== i).map((it, idx) => ({ ...it, position: idx })));

  const addItem = () =>
    onItemsChange([...items, emptyTemplateItem(items.length)]);

  const move = (i: number, dir: -1 | 1) => {
    const next = [...items];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onItemsChange(next.map((it, idx) => ({ ...it, position: idx })));
  };

  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <ItemCard
          key={i}
          item={it}
          index={i}
          total={items.length}
          templateName={templateName}
          disabled={disabled}
          onChange={(u) => updateItem(i, u)}
          onRemove={() => removeItem(i)}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
        />
      ))}
      <Button type="button" variant="outline" className="w-full gap-2 border-dashed" disabled={disabled} onClick={addItem}>
        <Plus className="w-4 h-4" /> Adicionar outro arquivo
      </Button>
    </div>
  );
}

/** Valida que todos os itens têm conteúdo (texto OU mídia). */
export function templateItemsValid(items: TemplateItem[]): boolean {
  return items.length > 0 && items.every((it) =>
    it.message_type === "text" ? !!it.message_text?.trim() : !!it.media_url?.trim()
  );
}
