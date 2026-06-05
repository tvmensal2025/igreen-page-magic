import { useRef, useState, useCallback } from "react";
import { Image as ImageIcon, Video, Mic, FileText, X, Loader2, Upload, Square, Play, FilePlus2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { uploadMedia, formatFileSize } from "@/services/minioUpload";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import type { PreparedMedia, MediaKind } from "./types";
import type { MessageTemplate } from "@/types/whatsapp";
import { renderFinal } from "./spintax";

function inferKind(mime: string, name: string): MediaKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  // Docs
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip)$/i.test(name)) return "document";
  if (mime === "application/pdf") return "document";
  return "document";
}

interface Props {
  consultantId: string;
  text: string;
  onTextChange: (v: string) => void;
  media: PreparedMedia | null;
  onMediaChange: (m: PreparedMedia | null) => void;
  previewName?: string;
  previewBill?: number;
  templates?: MessageTemplate[];
}

const VARS = [
  { tag: "{primeiro_nome}", label: "Primeiro nome" },
  { tag: "{nome}", label: "Nome completo" },
  { tag: "{valor_conta}", label: "Valor da conta" },
  { tag: "{cidade}", label: "Cidade" },
  { tag: "{saudacao}", label: "Bom dia / tarde / noite" },
];

export function MessageEditor({ consultantId, text, onTextChange, media, onMediaChange, previewName, previewBill, templates = [] }: Props) {
  const [tplQuery, setTplQuery] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const filteredTemplates = templates.filter(t => {
    const q = tplQuery.trim().toLowerCase();
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || (t.content || "").toLowerCase().includes(q);
  });
  const applyTemplate = (t: MessageTemplate) => {
    if (text.trim() && !confirm("Substituir a mensagem atual pelo template?")) return;
    onTextChange(t.content || "");
    if (t.media_url && t.media_type && t.media_type !== "text") {
      onMediaChange({ url: t.media_url, kind: t.media_type as any, fileName: t.name });
    }
    setTplOpen(false);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const { toast } = useToast();
  const taRef = useRef<HTMLTextAreaElement>(null);

  const handleUploadedBlob = useCallback(async (file: File, forcedKind?: MediaKind) => {
    if (file.size > 100 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Limite 100MB", variant: "destructive" });
      return;
    }
    if (/\.webm$/i.test(file.name) || file.type === "audio/webm") {
      toast({ title: "Formato não aceito", description: "Use .ogg, .mp3 ou .m4a para áudio", variant: "destructive" });
      return;
    }
    setUploading(true); setPct(0);
    try {
      const kind = forcedKind || inferKind(file.type, file.name) || "document";
      const res = await uploadMedia(file, (p) => setPct(p), {
        scope: "template",
        consultant_id: consultantId,
        kind,
      });
      onMediaChange({ url: res.url, kind, fileName: file.name, mime: file.type });
      toast({ title: "Anexo pronto", description: `${kind.toUpperCase()} • ${formatFileSize(res.size)}` });
    } catch (e: any) {
      toast({ title: "Falha no upload", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [consultantId, onMediaChange, toast]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    handleUploadedBlob(f);
    if (fileRef.current) fileRef.current.value = "";
  }, [handleUploadedBlob]);

  // Audio recorder → uploads OGG and sets media
  const recorder = useAudioRecorder(async (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: "audio/ogg" });
    const file = new File([blob], `audio-${Date.now()}.ogg`, { type: "audio/ogg" });
    await handleUploadedBlob(file, "audio");
  });

  const insertVar = (tag: string) => {
    const ta = taRef.current;
    if (!ta) { onTextChange(text + tag); return; }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const next = text.slice(0, start) + tag + text.slice(end);
    onTextChange(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + tag.length, start + tag.length); });
  };

  const insertSpintax = () => insertVar("{oi|olá|e aí}");

  const previews = [0, 1, 2].map(() => renderFinal(text, { name: previewName, bill: previewBill }));

  const MediaIcon = media ? ({
    image: ImageIcon, video: Video, audio: Mic, document: FileText,
  }[media.kind]) : null;

  return (
    <div className="space-y-4">
      {/* Variables toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground mr-1">Inserir:</span>
        {VARS.map(v => (
          <button
            key={v.tag} type="button" onClick={() => insertVar(v.tag)}
            className="text-[11px] px-2 py-1 rounded-md bg-secondary/40 hover:bg-secondary text-foreground border border-border/40"
            title={v.label}
          >
            {v.tag}
          </button>
        ))}
        <button
          type="button" onClick={insertSpintax}
          className="text-[11px] px-2 py-1 rounded-md bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30"
          title="Variações aleatórias para evitar bloqueio"
        >
          ✨ spintax
        </button>
      </div>

      <Textarea
        ref={taRef}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Olá {primeiro_nome}! {oi|tudo bem|e aí} 👋 Posso te mostrar uma forma de economizar na conta de luz?"
        className="min-h-[120px] font-mono text-sm"
      />

      {/* Media row */}
      <div className="rounded-xl border border-border/40 bg-secondary/10 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-foreground">Anexo (opcional)</span>
          {media && (
            <button onClick={() => onMediaChange(null)} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
              <X className="w-3 h-3" /> Remover
            </button>
          )}
        </div>

        {!media && !uploading && !recorder.isRecording && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button variant="outline" className="h-16 flex-col gap-1 rounded-lg" onClick={() => { if (fileRef.current) { fileRef.current.accept = "image/*"; fileRef.current.click(); } }}>
              <ImageIcon className="w-4 h-4 text-blue-400" />
              <span className="text-[11px]">Imagem</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col gap-1 rounded-lg" onClick={() => { if (fileRef.current) { fileRef.current.accept = "video/mp4,video/*"; fileRef.current.click(); } }}>
              <Video className="w-4 h-4 text-purple-400" />
              <span className="text-[11px]">Vídeo</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col gap-1 rounded-lg" onClick={recorder.startRecording}>
              <Mic className="w-4 h-4 text-emerald-400" />
              <span className="text-[11px]">Gravar áudio</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col gap-1 rounded-lg" onClick={() => { if (fileRef.current) { fileRef.current.accept = ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,audio/*"; fileRef.current.click(); } }}>
              <Upload className="w-4 h-4 text-amber-400" />
              <span className="text-[11px]">Arquivo</span>
            </Button>
          </div>
        )}

        {recorder.isRecording && (
          <div className="flex items-center justify-between rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2">
            <div className="flex items-center gap-2 text-red-300 text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              Gravando {recorder.formatTime(recorder.recordingTime)}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={recorder.cancelRecording}>Cancelar</Button>
              <Button size="sm" onClick={recorder.stopRecording} className="gap-1"><Square className="w-3 h-3" /> Parar</Button>
            </div>
          </div>
        )}

        {uploading && (
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2 flex items-center gap-2 text-blue-300 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Enviando anexo... {pct}%
          </div>
        )}

        {media && MediaIcon && (
          <div className="flex items-center gap-3 rounded-lg bg-secondary/40 border border-border/40 px-3 py-2">
            <div className="w-9 h-9 rounded-md bg-background/60 flex items-center justify-center">
              <MediaIcon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{media.fileName || media.url.split("/").pop()}</p>
              <p className="text-[10px] text-muted-foreground uppercase">{media.kind}{media.kind === "audio" ? " (enviado como voz)" : ""}</p>
            </div>
            {media.kind === "image" && <img src={media.url} alt="" className="w-9 h-9 rounded object-cover" />}
            {media.kind === "audio" && <audio controls src={media.url} className="h-8 max-w-[160px]" />}
          </div>
        )}

        <input ref={fileRef} type="file" hidden onChange={handleFile} />
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-border/40 bg-emerald-950/10 p-3 space-y-2">
        <p className="text-[11px] font-bold text-emerald-300/80 uppercase tracking-wide">Pré-visualização (3 variações)</p>
        <div className="space-y-2">
          {previews.map((p, i) => (
            <div key={i} className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-foreground whitespace-pre-wrap">
              {p || <span className="text-muted-foreground italic">(escreva uma mensagem acima)</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
