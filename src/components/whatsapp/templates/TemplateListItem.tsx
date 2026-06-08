import { useRef, useState } from "react";
import { File, Image, Trash2, Eye, Pencil, Save, X, Loader2, Upload, Copy, Star, Globe2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { MessageTemplate, TemplateMediaType } from "@/types/whatsapp";
import { uploadMedia, getAcceptString, formatFileSize } from "@/services/minioUpload";
import { toast } from "sonner";
import { mediaIcon, mediaBadge, MEDIA_TYPES } from "./templateUtils";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { VoiceClipRecorder } from "@/components/whatsapp/voice/VoiceClipRecorder";

interface Props {
  template: MessageTemplate;
  consultantId: string;
  onUpdateTemplate: (id: string, updates: { name?: string; image_url?: string | null; content?: string; media_url?: string | null; media_type?: string; is_quick_reply?: boolean }) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
  onPreview: (t: MessageTemplate) => void;
  onForked?: () => Promise<void> | void;
}

export function TemplateListItem({ template: t, consultantId, onUpdateTemplate, onDeleteTemplate, onPreview, onForked }: Props) {
  const { isSuperAdmin } = useUserRole(consultantId);
  const isOwner = t.consultant_id === consultantId;
  // Original = sem dono OU sem origin_template_id e dono é o super_admin (template global)
  const isOriginal = !(t as any).origin_template_id;
  // Pode editar diretamente quando: é dono do template OU é super_admin sobre original
  const canEditDirect = isOwner || (isSuperAdmin && isOriginal);
  // Pode personalizar (fork) quando: não é dono, é original publicado e usuário não é super_admin
  const canFork = !isOwner && isOriginal && !isSuperAdmin;
  const canDelete = isOwner || (isSuperAdmin && isOriginal);
  const [forking, setForking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(t.name);
  const [editContent, setEditContent] = useState(t.content || "");
  const [editMediaUrl, setEditMediaUrl] = useState(t.media_url || "");
  const [editImageUrl, setEditImageUrl] = useState(t.image_url || "");
  const [editMediaType, setEditMediaType] = useState<TemplateMediaType>((t.media_type as TemplateMediaType) || "text");
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [isEditUploading, setIsEditUploading] = useState(false);
  const [editUploadProgress, setEditUploadProgress] = useState(0);
  const editFileRef = useRef<HTMLInputElement>(null);
  const editImageRef = useRef<HTMLInputElement>(null);

  function startEditing() {
    setEditing(true);
    setEditName(t.name);
    setEditContent(t.content || "");
    setEditMediaUrl(t.media_url || "");
    setEditImageUrl(t.image_url || "");
    setEditMediaType((t.media_type as TemplateMediaType) || "text");
  }

  async function handlePersonalize() {
    setForking(true);
    try {
      const { data, error } = await supabase.rpc("fork_message_template", { _origin_id: t.id });
      if (error) throw error;
      toast.success("Cópia pessoal criada! Edite à vontade — o original fica intacto.");
      await onForked?.();
    } catch (e: any) {
      toast.error(e?.message || "Não consegui personalizar");
    } finally {
      setForking(false);
    }
  }

  function cancelEditing() {
    setEditing(false);
  }

  async function handleEditFileUpload(e: React.ChangeEvent<HTMLInputElement>, target: "media" | "image") {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsEditUploading(true);
    setEditUploadProgress(0);
    try {
      const result = await uploadMedia(file, (pct) => setEditUploadProgress(pct), { scope: "template", kind: file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : "document" });
      if (target === "media") setEditMediaUrl(result.url);
      else setEditImageUrl(result.url);
      toast.success(`Arquivo enviado: ${formatFileSize(result.size)}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setIsEditUploading(false);
      if (editFileRef.current) editFileRef.current.value = "";
      if (editImageRef.current) editImageRef.current.value = "";
    }
  }

  async function handleSaveEdit() {
    if (!editName.trim()) return;
    setIsEditSaving(true);
    try {
      await onUpdateTemplate(t.id, {
        name: editName.trim(),
        content: editContent.trim(),
        media_type: editMediaType,
        media_url: editMediaType !== "text" ? editMediaUrl.trim() || null : null,
        image_url: editImageUrl.trim() || null,
      });
      cancelEditing();
      toast.success("Template atualizado!");
    } catch {
      toast.error("Erro ao atualizar template");
    } finally {
      setIsEditSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-xl border-2 border-purple-500/40 bg-purple-500/5 px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-purple-400 flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Editando template</p>
          <Button variant="ghost" size="icon" onClick={cancelEditing} className="h-7 w-7 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></Button>
        </div>
        <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nome" className="rounded-xl bg-secondary/50 border-border/50" />
        <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} placeholder="Conteúdo / legenda..." rows={3} className="rounded-xl bg-secondary/30 border-border/40 resize-none" />

        <div className="grid grid-cols-4 gap-1.5">
          {MEDIA_TYPES.map((mt) => {
            const Icon = mt.icon;
            const isActive = editMediaType === mt.value;
            return (
              <button key={mt.value} onClick={() => setEditMediaType(mt.value)}
                className={`flex items-center justify-center gap-1 rounded-lg border p-2 transition-all text-center ${isActive ? "border-purple-500/50 bg-purple-500/10" : "border-border/40 bg-secondary/10 hover:border-border/60"}`}>
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-purple-400" : "text-muted-foreground"}`} />
                <span className={`text-[10px] font-bold ${isActive ? "text-purple-400" : "text-muted-foreground"}`}>{mt.label}</span>
              </button>
            );
          })}
        </div>

        {editMediaType !== "text" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input ref={editFileRef} type="file" accept={getAcceptString(editMediaType)} onChange={(e) => handleEditFileUpload(e, "media")} className="hidden" />
              <Button type="button" variant="outline" size="sm" onClick={() => editFileRef.current?.click()} disabled={isEditUploading}
                className="gap-1.5 rounded-lg border-dashed text-xs h-9 flex-1 min-w-[140px]">
                {isEditUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {editMediaUrl ? "Trocar arquivo" : "Selecionar arquivo"}
              </Button>
              {editMediaType === "audio" && (
                <VoiceClipRecorder
                  consultantId={consultantId}
                  slug={`tpl-${t.id.slice(0,8)}-voz`}
                  idleLabel={editMediaUrl ? "Regravar com minha voz" : "Gravar minha voz"}
                  onUploaded={(url) => setEditMediaUrl(url)}
                />
              )}
            </div>
            {editMediaUrl && (
              <div className="rounded-lg border border-border/30 bg-secondary/10 p-2">
                {editMediaType === "audio" && <audio controls src={editMediaUrl} className="w-full h-8" />}
                {editMediaType === "image" && <img src={editMediaUrl} alt="" className="rounded max-h-20 object-contain" />}
                {editMediaType === "document" && <p className="text-xs text-muted-foreground truncate font-mono">📎 {editMediaUrl}</p>}
              </div>
            )}
            <Input value={editMediaUrl} onChange={(e) => setEditMediaUrl(e.target.value)} placeholder="URL da mídia..." className="rounded-xl bg-secondary/50 border-border/50 font-mono text-xs" />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input ref={editImageRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => handleEditFileUpload(e, "image")} className="hidden" />
            <Button type="button" variant="outline" size="sm" onClick={() => editImageRef.current?.click()} disabled={isEditUploading}
              className="gap-1.5 rounded-lg border-dashed border-blue-500/30 text-blue-400 text-xs h-9 flex-1">
              {isEditUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Image className="w-3.5 h-3.5" />}
              {editImageUrl ? "Trocar imagem" : "Anexar imagem"}
            </Button>
            {editImageUrl && (
              <Button type="button" variant="ghost" size="icon" onClick={() => setEditImageUrl("")} className="h-7 w-7 text-muted-foreground hover:text-red-400">
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
          {editImageUrl && <img src={editImageUrl} alt="" className="rounded max-h-16 object-contain border border-border/20" />}
        </div>

        {isEditUploading && <Progress value={editUploadProgress} className="h-1.5" />}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={handleSaveEdit} disabled={isEditSaving || !editName.trim()} size="sm" className="gap-1.5 rounded-lg font-bold">
            {isEditSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </Button>
          <Button variant="ghost" size="sm" onClick={cancelEditing} className="text-muted-foreground">Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border/40 bg-secondary/20 px-4 py-3 group hover:border-purple-500/20 transition-all">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {mediaIcon((t.media_type as TemplateMediaType) || "text")}
          <p className="text-sm font-bold text-foreground truncate">{t.name}</p>
          {mediaBadge((t.media_type as TemplateMediaType) || "text")}
        </div>
        {t.content && (
          <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">{t.content}</p>
        )}
        {t.media_url && (
          <div className="mt-2">
            {t.media_type === "image" && (
              <img src={t.media_url} alt={t.name} className="rounded-md max-h-20 object-contain border border-border/20" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            )}
            {t.media_type === "audio" && (
              <audio controls src={t.media_url} className="w-full h-8 max-w-[240px]" />
            )}
            {t.media_type === "document" && (
              <a href={t.media_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-400 hover:underline flex items-center gap-1">
                <File className="w-3 h-3" /> Abrir documento
              </a>
            )}
          </div>
        )}
        {t.image_url && (
          <div className="mt-2 flex items-center gap-2">
            <Image className="w-3 h-3 text-blue-400 shrink-0" />
            <img src={t.image_url} alt="Imagem anexa" className="rounded-md max-h-16 object-contain border border-border/20" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {canEditDirect && (
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              try {
                await onUpdateTemplate(t.id, { is_quick_reply: t.is_quick_reply === false });
                toast.success(t.is_quick_reply === false ? "Aparece nas respostas rápidas" : "Removido das respostas rápidas");
              } catch {
                toast.error("Não consegui atualizar");
              }
            }}
            className={`h-8 w-8 transition-all ${t.is_quick_reply === false ? "text-muted-foreground/40 opacity-0 group-hover:opacity-100" : "text-amber-400"}`}
            title={t.is_quick_reply === false ? "Mostrar nas respostas rápidas" : "Aparece nas respostas rápidas (clique para esconder)"}
          >
            <Star className={`w-3.5 h-3.5 ${t.is_quick_reply === false ? "" : "fill-amber-400"}`} />
          </Button>
        )}
        {canEditDirect && (
          <Button variant="ghost" size="icon" onClick={startEditing}
            className="text-muted-foreground hover:text-purple-400 h-8 w-8 opacity-0 group-hover:opacity-100 transition-all"
            title={isSuperAdmin && !isOwner ? "Editar original (Super Admin)" : "Editar"}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        )}
        {canFork && (
          <Button variant="ghost" size="icon" onClick={handlePersonalize} disabled={forking}
            className="text-muted-foreground hover:text-emerald-400 h-8 w-8 opacity-0 group-hover:opacity-100 transition-all"
            title="Personalizar (cria sua cópia, original fica intacto)">
            {forking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => onPreview(t)}
          className="text-muted-foreground hover:text-foreground h-8 w-8 opacity-0 group-hover:opacity-100 transition-all">
          <Eye className="w-3.5 h-3.5" />
        </Button>
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 h-8 w-8 opacity-0 group-hover:opacity-100 transition-all">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir template</AlertDialogTitle>
                <AlertDialogDescription>Excluir "{t.name}"? Essa ação não pode ser desfeita.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDeleteTemplate(t.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}