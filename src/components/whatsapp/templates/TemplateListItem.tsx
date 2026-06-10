import { useState } from "react";
import { File, Image, Trash2, Eye, Pencil, Save, X, Loader2, Copy, Star, Globe2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { MessageTemplate, TemplateMediaType, TemplateItem } from "@/types/whatsapp";
import { toast } from "sonner";
import { mediaIcon, mediaBadge } from "./templateUtils";
import { TemplateItemsEditor, emptyTemplateItem, templateItemsValid } from "./TemplateItemsEditor";
import { resolveTemplateItems } from "@/services/templateSender";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  template: MessageTemplate;
  consultantId: string;
  onUpdateTemplate: (id: string, updates: { name?: string; image_url?: string | null; content?: string; media_url?: string | null; media_type?: string; is_quick_reply?: boolean }, items?: TemplateItem[]) => Promise<void>;
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
  const [editItems, setEditItems] = useState<TemplateItem[]>([]);
  const [isEditSaving, setIsEditSaving] = useState(false);

  function startEditing() {
    setEditName(t.name);
    // Carrega os itens existentes; se não houver, reconstrói do legado.
    const base = t.items && t.items.length > 0
      ? [...t.items].sort((a, b) => a.position - b.position)
      : resolveTemplateItems(t);
    setEditItems(base.length > 0 ? base.map((it, i) => ({ ...it, position: i })) : [emptyTemplateItem(0)]);
    setEditing(true);
  }

  async function handlePersonalize() {
    setForking(true);
    try {
      const { error } = await supabase.rpc("fork_message_template", { _origin_id: t.id });
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

  async function handleSaveEdit() {
    if (!editName.trim() || !templateItemsValid(editItems)) return;
    setIsEditSaving(true);
    try {
      const normalized = editItems.map((it, i) => ({ ...it, position: i }));
      // Conteúdo legado = texto do 1º item de texto.
      const legacyContent = normalized.find((it) => it.message_type === "text")?.message_text || "";
      await onUpdateTemplate(
        t.id,
        { name: editName.trim(), content: legacyContent.trim() },
        normalized,
      );
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
      <div className="rounded-xl border-2 border-primary/40 bg-primary/5 px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-primary flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> Editando template</p>
          <Button variant="ghost" size="icon" onClick={cancelEditing} className="h-7 w-7 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></Button>
        </div>
        <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nome" className="rounded-xl bg-secondary/50 border-border/50" />

        <TemplateItemsEditor items={editItems} onItemsChange={setEditItems} templateName={editName} disabled={isEditSaving} />

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={handleSaveEdit} disabled={isEditSaving || !editName.trim() || !templateItemsValid(editItems)} size="sm" className="gap-1.5 rounded-lg font-bold">
            {isEditSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </Button>
          <Button variant="ghost" size="sm" onClick={cancelEditing} className="text-muted-foreground">Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border/40 bg-secondary/20 px-4 py-3 group hover:border-primary/20 transition-all">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {mediaIcon((t.media_type as TemplateMediaType) || "text")}
          <p className="text-sm font-bold text-foreground truncate">{t.name}</p>
          {mediaBadge((t.media_type as TemplateMediaType) || "text")}
          {t.items && t.items.length > 1 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border bg-primary/15 text-primary border-primary/20">
              {t.items.length} arquivos
            </span>
          )}
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
              <a href={t.media_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-info hover:underline flex items-center gap-1">
                <File className="w-3 h-3" /> Abrir documento
              </a>
            )}
          </div>
        )}
        {t.image_url && (
          <div className="mt-2 flex items-center gap-2">
            <Image className="w-3 h-3 text-info shrink-0" />
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
            className={`h-8 w-8 transition-all ${t.is_quick_reply === false ? "text-muted-foreground/40 opacity-0 group-hover:opacity-100" : "text-warning"}`}
            title={t.is_quick_reply === false ? "Mostrar nas respostas rápidas" : "Aparece nas respostas rápidas (clique para esconder)"}
          >
            <Star className={`w-3.5 h-3.5 ${t.is_quick_reply === false ? "" : "fill-warning"}`} />
          </Button>
        )}
        {canEditDirect && (
          <Button variant="ghost" size="icon" onClick={startEditing}
            className="text-muted-foreground hover:text-primary h-8 w-8 opacity-0 group-hover:opacity-100 transition-all"
            title={isSuperAdmin && !isOwner ? "Editar original (Super Admin)" : "Editar"}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        )}
        {canFork && (
          <Button variant="ghost" size="icon" onClick={handlePersonalize} disabled={forking}
            className="text-muted-foreground hover:text-primary h-8 w-8 opacity-0 group-hover:opacity-100 transition-all"
            title="Personalizar (cria sua cópia, original fica intacto)">
            {forking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => onPreview(t)}
          className="text-muted-foreground hover:text-foreground h-8 w-8 opacity-0 group-hover:opacity-100 transition-all">
          <Eye className="w-3.5 h-3.5" />
        </Button>
        {isSuperAdmin && (
          <Button
            variant="ghost"
            size="icon"
            title={(t as any).is_public ? "Tornar privado" : "Tornar público para todos"}
            onClick={async () => {
              const next = !(t as any).is_public;
              const { error } = await supabase.from("message_templates").update({ is_public: next }).eq("id", t.id);
              if (error) { toast.error("Falha ao alternar visibilidade"); return; }
              toast.success(next ? "🌎 Template público" : "🔒 Template privado");
              await onForked?.();
            }}
            className={`h-8 w-8 transition-all ${(t as any).is_public ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100"}`}
          >
            {(t as any).is_public ? <Globe2 className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          </Button>
        )}
        {canDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10 h-8 w-8 opacity-0 group-hover:opacity-100 transition-all">
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