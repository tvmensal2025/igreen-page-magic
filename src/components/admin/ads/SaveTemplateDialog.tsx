import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  defaultTitle: string;
  defaultDescription?: string;
  saving?: boolean;
  isSuperAdmin?: boolean;
  onConfirm: (data: { title: string; description: string }) => void;
}

export function SaveTemplateDialog({
  open, onClose, defaultTitle, defaultDescription = "",
  saving, isSuperAdmin, onConfirm,
}: Props) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);

  useEffect(() => {
    if (open) { setTitle(defaultTitle); setDescription(defaultDescription); }
  }, [open, defaultTitle, defaultDescription]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="w-4 h-4 text-primary" /> Salvar como template
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="tpl-title">Nome do template *</Label>
            <Input id="tpl-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: CPFL — Cliente interessado frio cidade pequena" maxLength={120} />
          </div>
          <div>
            <Label htmlFor="tpl-desc">Descrição (opcional)</Label>
            <Textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Quando usar, ângulo, observações…" rows={3} maxLength={500} />
          </div>
          <p className="text-xs text-muted-foreground">
            {isSuperAdmin
              ? "Será publicado para todos os consultores."
              : "Salvo como rascunho pessoal (só você usa)."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={() => onConfirm({ title: title.trim(), description: description.trim() })}
            disabled={saving || !title.trim()} className="gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
