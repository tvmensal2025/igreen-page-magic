import { useState, useMemo } from "react";
import { Sparkles, Plus, Eye, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { MessageTemplate } from "@/types/whatsapp";
import type { BulkContact } from "@/types/whatsapp";

interface QuickTemplateFormProps {
  templates: MessageTemplate[];
  selectedTemplate: MessageTemplate | null;
  onSelectTemplate: (template: MessageTemplate | null) => void;
  message: string;
  onMessageChange: (msg: string) => void;
  onCreateTemplate: (name: string, content: string, mediaType?: string, mediaUrl?: string | null, imageUrl?: string | null) => Promise<void>;
  contacts: BulkContact[];
  disabled?: boolean;
}

export function QuickTemplateForm({
  templates, selectedTemplate, onSelectTemplate,
  message, onMessageChange, onCreateTemplate,
  contacts, disabled,
}: QuickTemplateFormProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [creating, setCreating] = useState(false);

  const previewMessage = useMemo(() => {
    if (!message.trim()) return null;
    const first = contacts[0];
    if (!first) return message;
    let result = message;
    result = result.split("{{nome}}").join(first.name);
    result = result.split("{{valor_conta}}").join(
      first.electricity_bill_value != null ? String(first.electricity_bill_value) : ""
    );
    return result;
  }, [message, contacts]);

  const handleSelectTemplate = (tid: string) => {
    if (tid === "__none") {
      onSelectTemplate(null);
      onMessageChange("");
      return;
    }
    const t = templates.find(t => t.id === tid);
    if (t) {
      onSelectTemplate(t);
      onMessageChange(t.content);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newContent.trim()) return;
    setCreating(true);
    try {
      await onCreateTemplate(newName, newContent);
      setNewName("");
      setNewContent("");
      setShowCreate(false);
    } catch { /* handled by parent */ }
    setCreating(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Sparkles className="w-4 h-4 text-primary" />
        Template da Mensagem
      </div>

      <Select onValueChange={handleSelectTemplate} value={selectedTemplate?.id || "__none"} disabled={disabled}>
        <SelectTrigger className="rounded-lg bg-secondary/50 border-border/50">
          <SelectValue placeholder="Selecionar template..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Sem template (texto livre)</SelectItem>
          {templates.map(t => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Collapsible open={showCreate} onOpenChange={setShowCreate}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 text-primary" disabled={disabled}>
            <Plus className="w-3 h-3" /> Criar template rápido
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 mt-2 rounded-lg border border-border/50 p-3 bg-secondary/10">
          <Input placeholder="Nome do template" value={newName} onChange={e => setNewName(e.target.value)}
            className="h-8 text-xs rounded-lg" disabled={creating} />
          <Textarea placeholder="Conteúdo... Use {{nome}} e {{valor_conta}}" value={newContent}
            onChange={e => setNewContent(e.target.value)} rows={3}
            className="text-xs rounded-lg resize-none" disabled={creating} />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || !newContent.trim() || creating}
            className="h-7 text-xs gap-1 rounded-lg">
            <Plus className="w-3 h-3" /> Salvar template
          </Button>
        </CollapsibleContent>
      </Collapsible>

      <Textarea
        placeholder="Digite sua mensagem... Use {{nome}} e {{valor_conta}} para personalizar"
        value={message}
        onChange={e => onMessageChange(e.target.value)}
        rows={4}
        disabled={disabled}
        className="rounded-lg bg-secondary/30 border-border/40 resize-none"
      />

      {/* WhatsApp-style preview */}
      {previewMessage && contacts.length > 0 && (
        <div className="rounded-lg border border-border/40 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/30 border-b border-border/30">
            <Eye className="w-3.5 h-3.5 text-primary" />
            <span className="text-[11px] font-medium text-muted-foreground">Preview (1º contato: {contacts[0].name})</span>
          </div>
          <div className="p-3 bg-[#0b141a]">
            {selectedTemplate?.image_url && (
              <div className="max-w-[85%] ml-auto mb-1">
                <img src={selectedTemplate.image_url} alt="" className="rounded-lg max-h-32 object-cover" />
              </div>
            )}
            <div className="max-w-[85%] ml-auto rounded-lg bg-[#005c4b] px-3 py-2 shadow-sm">
              <p className="text-sm text-white/90 whitespace-pre-wrap break-words">{previewMessage}</p>
              <p className="text-[10px] text-white/40 text-right mt-1">agora</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {["{{nome}}", "{{valor_conta}}"].map(v => (
          <button key={v} onClick={() => onMessageChange(message + v)} disabled={disabled}
            className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
