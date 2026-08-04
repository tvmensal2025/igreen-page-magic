import { useRef, useState, useCallback } from "react";
import { Image as ImageIcon, Video, Mic, FileText, X, Loader2, Upload, Square, Play, FilePlus2, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { uploadMedia, formatFileSize } from "@/services/minioUpload";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import type { PreparedMedia } from "./types";
import type { MessageTemplate } from "@/types/whatsapp";
import { renderFinal } from "./spintax";

function inferKind(mime: string, name: string): PreparedMedia['kind'] | null {
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
  mediaItems?: PreparedMedia[];
  onMediaItemsChange?: (m: PreparedMedia[]) => void;
  // Legado para compatibilidade se necessário
  media?: PreparedMedia | null;
  onMediaChange?: (m: PreparedMedia | null) => void;
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

export function MessageEditor({ 
  consultantId, 
  text, 
  onTextChange, 
  mediaItems = [], 
  onMediaItemsChange, 
  media, 
  onMediaChange,
  previewName, 
  previewBill, 
  templates = [] 
}: Props) {
  const confirm = useConfirm();
  const [tplQuery, setTplQuery] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pct, setPct] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const filteredTemplates = templates.filter(t => {
    const q = tplQuery.trim().toLowerCase();
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || (t.content || "").toLowerCase().includes(q);
  });

  const applyTemplate = async (t: MessageTemplate) => {
    if (text.trim()) {
      const ok = await confirm({ title: "Substituir a mensagem atual pelo template?", confirmText: "Substituir" });
      if (!ok) return;
    }
    onTextChange(t.content || "");
    if (t.media_url && t.media_type && t.media_type !== "text") {
      const newMedia: PreparedMedia = { url: t.media_url, kind: t.media_type as any, fileName: t.name };
      if (onMediaItemsChange) {
        onMediaItemsChange([...mediaItems, newMedia]);
      } else if (onMediaChange) {
        onMediaChange(newMedia);
      }
    }
    setTplOpen(false);
  };

  const handleUploadedBlob = useCallback(async (file: File, forcedKind?: PreparedMedia['kind']) => {
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
      const newMedia: PreparedMedia = { url: res.url, kind, fileName: file.name };
      
      if (onMediaItemsChange) {
        onMediaItemsChange([...mediaItems, newMedia]);
      } else if (onMediaChange) {
        onMediaChange(newMedia);
      }
      
      toast({ title: "Anexo pronto", description: `${kind.toUpperCase()} • ${formatFileSize(res.size)}` });
    } catch (e: any) {
      toast({ title: "Falha no upload", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [consultantId, mediaItems, onMediaItemsChange, onMediaChange, toast]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    handleUploadedBlob(f);
    if (fileRef.current) fileRef.current.value = "";
  }, [handleUploadedBlob]);

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

  const removeMedia = (index: number) => {
    if (onMediaItemsChange) {
      const newList = [...mediaItems];
      newList.splice(index, 1);
      onMediaItemsChange(newList);
    } else if (onMediaChange) {
      onMediaChange(null);
    }
  };

  const previews = [0, 1, 2].map(() => renderFinal(text, { name: previewName, bill: previewBill }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
      <div className="space-y-4 min-w-0">

      {/* Template picker */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--pe-accent-warm)]/30 bg-[color:var(--pe-accent-warm)]/5 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <FilePlus2 className="w-4 h-4 text-[color:var(--pe-accent-warm)] shrink-0" />
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
          <PopoverContent align="end" className="w-[min(360px,calc(100vw-2rem))] p-0" sideOffset={6}>
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
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/15 text-primary">{t.media_type}</span>
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
          className="text-[11px] px-2 py-1 rounded-md bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30"
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
          <span className="text-xs font-bold text-foreground">Anexos ({mediaItems.length})</span>
        </div>

        {!uploading && !recorder.isRecording && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button variant="outline" className="h-16 flex-col gap-1 rounded-lg" onClick={() => { if (fileRef.current) { fileRef.current.accept = "image/*"; fileRef.current.click(); } }}>
              <ImageIcon className="w-4 h-4 text-info" />
              <span className="text-[11px]">Imagem</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col gap-1 rounded-lg" onClick={() => { if (fileRef.current) { fileRef.current.accept = "video/mp4,video/*"; fileRef.current.click(); } }}>
              <Video className="w-4 h-4 text-primary" />
              <span className="text-[11px]">Vídeo</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col gap-1 rounded-lg" onClick={recorder.startRecording}>
              <Mic className="w-4 h-4 text-primary" />
              <span className="text-[11px]">Gravar áudio</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col gap-1 rounded-lg" onClick={() => { if (fileRef.current) { fileRef.current.accept = ".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,audio/*"; fileRef.current.click(); } }}>
              <Upload className="w-4 h-4 text-warning" />
              <span className="text-[11px]">Arquivo</span>
            </Button>
          </div>
        )}

        {recorder.isRecording && (
          <div className="flex items-center justify-between rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2">
            <div className="flex items-center gap-2 text-destructive text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
              Gravando {recorder.formatTime(recorder.recordingTime)}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={recorder.cancelRecording}>Cancelar</Button>
              <Button size="sm" onClick={recorder.stopRecording} className="gap-1"><Square className="w-3 h-3" /> Parar</Button>
            </div>
          </div>
        )}

        {uploading && (
          <div className="rounded-lg bg-info/10 border border-info/30 px-3 py-2 flex items-center gap-2 text-info text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Enviando anexo... {pct}%
          </div>
        )}

        {mediaItems.length > 0 && (
          <div className="space-y-2 max-h-60 overflow-auto">
            {mediaItems.map((item, idx) => {
              const Icon = {
                image: ImageIcon, video: Video, audio: Mic, document: FileText,
              }[item.kind] || FileText;

              return (
                <div key={idx} className="flex items-center gap-3 rounded-lg bg-secondary/40 border border-border/40 px-3 py-2 group">
                  <div className="w-8 h-8 rounded bg-background/60 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-foreground truncate">{item.fileName || item.url.split("/").pop()}</p>
                    <p className="text-[9px] text-muted-foreground uppercase">{item.kind}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.kind === "image" && <img src={item.url} alt="" className="w-8 h-8 rounded object-cover" />}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeMedia(idx)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <input ref={fileRef} type="file" hidden onChange={handleFile} />
      </div>

      </div>

      {/* Live WhatsApp mobile preview - side column */}
      <div className="lg:sticky lg:top-4 rounded-2xl border border-[#064e3b]/15 bg-gradient-to-b from-[#f5f0e0]/60 to-white p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-[#064e3b] uppercase tracking-wider">Pré-visualização</p>
          <span className="text-[9px] text-[#064e3b]/50 font-medium">ao vivo</span>
        </div>

        <div className="flex justify-center">
          <div className="w-full max-w-[260px] rounded-[1.8rem] border-[8px] border-[#0b1f1a] bg-[#e5ddd5] shadow-xl overflow-hidden">

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
              {mediaItems.length > 0 && (
                <div className="space-y-2 mb-3">
                  {mediaItems.map((item, idx) => (
                    <div key={idx} className="ml-auto max-w-[88%] bg-[#dcf8c6] rounded-lg shadow-sm overflow-hidden">
                      {item.kind === "image" && (
                        <img src={item.url} alt="preview" className="w-full max-h-[140px] object-cover" />
                      )}
                      {item.kind === "video" && (
                        <video src={item.url} className="w-full max-h-[140px] object-cover bg-black" muted />
                      )}
                      {item.kind === "audio" && (
                        <div className="px-2 py-1.5 bg-[#d1efb5] flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#075e54] flex items-center justify-center">
                            <Play className="w-2.5 h-2.5 text-white fill-white" />
                          </div>
                          <div className="flex-1 h-1 bg-[#075e54]/30 rounded-full" />
                        </div>
                      )}
                      {item.kind === "document" && (
                        <div className="px-2 py-1.5 bg-[#d1efb5] flex items-center gap-2 border-b border-[#0d7a5f]/10">
                          <FileText className="w-3 h-3 text-[#075e54]" />
                          <p className="text-[9px] font-medium text-[#064e3b] truncate flex-1">{item.fileName || "doc.pdf"}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="ml-auto max-w-[88%] bg-[#dcf8c6] rounded-lg shadow-sm overflow-hidden">
                {/* text */}
                <div className="px-3 py-2">
                  <p className="text-[12px] leading-snug text-gray-800 whitespace-pre-wrap break-words">
                    {previews[0] || (
                      <span className="text-gray-400 italic">Comece a escrever sua mensagem...</span>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
