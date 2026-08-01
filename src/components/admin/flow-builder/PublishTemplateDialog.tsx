// Diálogo "Publicar na galeria de templates".
//
// Qualquer consultor pode submeter o fluxo dele para a galeria pública. A
// submissão NÃO é publicada na hora: ela entra como "pendente" e só aparece
// na galeria depois que o super-admin aprovar (RPC `submit_flow_template`).
//
// Privacidade: o nome do autor é mostrado sempre; o telefone só é guardado e
// exibido se o autor marcar "deixar meu telefone".
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string | null;
  /** Nome atual do fluxo, usado como sugestão de nome do template. */
  defaultName?: string;
}

export default function PublishTemplateDialog({ open, onOpenChange, flowId, defaultName }: Props) {
  const [name, setName] = useState(defaultName ?? "");
  const [description, setDescription] = useState("");
  const [showPhone, setShowPhone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!flowId) {
      toast.error("Selecione um fluxo para publicar.");
      return;
    }
    const nome = name.trim();
    if (!nome) {
      toast.error("Dê um nome para o template.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("submit_flow_template", {
        _flow_id: flowId,
        _name: nome,
        _description: description.trim() || null,
        _show_phone: showPhone,
      });
      if (error) throw error;
      toast.success("Enviado! Seu template entra na galeria assim que o super-admin aprovar.");
      onOpenChange(false);
      setDescription("");
      setShowPhone(false);
    } catch (e: any) {
      toast.error("Não foi possível publicar: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Publicar na galeria de templates
          </DialogTitle>
          <DialogDescription>
            Compartilhe seu fluxo com os outros consultores. Ele entra como
            pendente e só aparece na galeria depois que o super-admin aprovar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Nome do template</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Atendimento Solar — alta conversão"
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">Observação / descrição (opcional)</Label>
            <Textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Conte para que serve, para qual público funciona melhor, etc."
              rows={3}
              maxLength={400}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="pr-3">
              <p className="text-sm font-medium">Deixar meu telefone</p>
              <p className="text-xs text-muted-foreground">
                Seu nome sempre aparece. O telefone só é mostrado se você ligar aqui.
              </p>
            </div>
            <Switch checked={showPhone} onCheckedChange={setShowPhone} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={busy || !flowId}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Enviar para aprovação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
