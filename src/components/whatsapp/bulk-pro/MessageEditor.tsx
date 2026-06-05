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
      {/* Template picker */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#c9a84c]/30 bg-[#c9a84c]/5 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <FilePlus2 className="w-4 h-4 text-[#c9a84c] shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#064e3b]">Templates salvos</p>
            <p className="text-[10px] text-[#064e3b]/60 truncate">
              {templates.length === 0 ? "Você ainda não tem templates" : `${templates.length} template${templates.length === 1 ? "" : "s"} disponíveis`}
            </p>
          </div>
        </div>
        <Popover open={tplOpen} onOpenChange={setTplOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              disabled={templates.length === 0}
              className="bg-[#0d7a5f] hover:bg-[#064e3b] text-white gap-1.5 rounded-lg shrink-0"
            >
              <FilePlus2 className="w-3.5 h-3.5" /> Usar template
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[360px] p-0" sideOffset={6}>
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  autoFocus
                  value={tplQuery}
                  onChange={(e) => setTplQuery(e.target.value)}
                  placeholder="Buscar template..."
                  className="h-8 pl-7 text-sm"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-auto py-1">
              {filteredTemplates.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">Nenhum template encontrado</p>
              ) : (
                filteredTemplates.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="w-full text-left px-3 py-2 hover:bg-muted/60 border-b border-border/30 last:border-0 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-foreground truncate">{t.name}</p>
                      {t.media_type && t.media_type !== "text" && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600">{t.media_type}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{t.content || "(sem texto)"}</p>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

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

      {/* Live WhatsApp mobile preview */}
      <div className="rounded-2xl border border-[#064e3b]/15 bg-gradient-to-b from-[#f5f0e0]/60 to-white p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold text-[#064e3b] uppercase tracking-wider">Pré-visualização ao vivo</p>
          <span className="text-[10px] text-[#064e3b]/50 font-medium">como aparece no WhatsApp</span>
        </div>

        <div className="flex justify-center">
          <div className="w-[280px] rounded-[2.2rem] border-[10px] border-[#0b1f1a] bg-[#e5ddd5] shadow-xl overflow-hidden">
            {/* phone header */}
            <div className="bg-[#075e54] text-white px-3 py-2 flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
                {(previewName || "C").slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold truncate">{previewName || "Contato"}</p>
                <p className="text-[9px] opacity-70">online</p>
              </div>
            </div>

            {/* chat body with WhatsApp pattern */}
            <div
              className="px-3 py-4 min-h-[320px] max-h-[480px] overflow-auto"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 25% 25%, rgba(0,0,0,0.04) 1px, transparent 1px), radial-gradient(circle at 75% 75%, rgba(0,0,0,0.04) 1px, transparent 1px)",
                backgroundSize: "16px 16px",
              }}
            >
              <div className="ml-auto max-w-[88%] bg-[#dcf8c6] rounded-lg shadow-sm overflow-hidden">
                {/* media block */}
                {media?.kind === "image" && (
                  <img src={media.url} alt="preview" className="w-full max-h-[180px] object-cover" />
                )}
                {media?.kind === "video" && (
                  <video src={media.url} className="w-full max-h-[180px] object-cover bg-black" muted />
                )}
                {media?.kind === "audio" && (
                  <div className="px-3 py-2 bg-[#d1efb5] flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-[#075e54] flex items-center justify-center">
                      <Play className="w-3 h-3 text-white fill-white" />
                    </div>
                    <div className="flex-1 h-1 bg-[#075e54]/30 rounded-full">
                      <div className="h-full w-1/3 bg-[#075e54] rounded-full" />
                    </div>
                    <span className="text-[9px] text-[#075e54]/70">0:12</span>
                  </div>
                )}
                {media?.kind === "document" && (
                  <div className="px-3 py-2 bg-[#d1efb5] flex items-center gap-2 border-b border-[#0d7a5f]/10">
                    <FileText className="w-4 h-4 text-[#075e54]" />
                    <p className="text-[10px] font-medium text-[#064e3b] truncate flex-1">{media.fileName || "documento.pdf"}</p>
                  </div>
                )}

                {/* text */}
                <div className="px-3 py-2">
                  <p className="text-[12px] leading-snug text-gray-800 whitespace-pre-wrap break-words">
                    {previews[0] || (
                      <span className="text-gray-400 italic">{media ? "(sem legenda)" : "Comece a escrever sua mensagem..."}</span>
                    )}
                  </p>
                  <p className="text-[9px] text-gray-500 text-right mt-1">
                    {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} ✓✓
                  </p>
                </div>
              </div>

              {/* additional variations (spintax preview) */}
              {previews[1] && previews[1] !== previews[0] && (
                <div className="ml-auto max-w-[88%] bg-[#dcf8c6]/60 rounded-lg shadow-sm px-3 py-2 mt-3 border border-dashed border-[#075e54]/20">
                  <p className="text-[9px] uppercase font-bold text-[#075e54]/70 mb-1">Variação 2</p>
                  <p className="text-[11px] leading-snug text-gray-700 whitespace-pre-wrap break-words">{previews[1]}</p>
                </div>
              )}
              {previews[2] && previews[2] !== previews[0] && previews[2] !== previews[1] && (
                <div className="ml-auto max-w-[88%] bg-[#dcf8c6]/60 rounded-lg shadow-sm px-3 py-2 mt-3 border border-dashed border-[#075e54]/20">
                  <p className="text-[9px] uppercase font-bold text-[#075e54]/70 mb-1">Variação 3</p>
                  <p className="text-[11px] leading-snug text-gray-700 whitespace-pre-wrap break-words">{previews[2]}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="text-[10px] text-center text-[#064e3b]/50 mt-3">
          Atualiza em tempo real conforme você escreve ou anexa mídia
        </p>
      </div>
    </div>
  );
}
