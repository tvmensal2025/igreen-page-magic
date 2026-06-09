import { useState } from "react";
import { Plus, Globe2, Lock, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TemplateItem } from "@/types/whatsapp";
import { toast } from "sonner";
import { TemplateItemsEditor, emptyTemplateItem, templateItemsValid } from "./TemplateItemsEditor";

interface Props {
  onCreateTemplate: (
    name: string,
    content: string,
    mediaType?: string,
    mediaUrl?: string | null,
    imageUrl?: string | null,
    isPublic?: boolean,
    items?: TemplateItem[],
  ) => Promise<void>;
}

export function TemplateCreateForm({ onCreateTemplate }: Props) {
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [items, setItems] = useState<TemplateItem[]>([emptyTemplateItem(0)]);

  const canSave = !!name.trim() && templateItemsValid(items);

  // Conteúdo "legado" do template = texto do primeiro item de texto (compat).
  const legacyContent = items.find((it) => it.message_type === "text")?.message_text || "";

  async function handleCreate() {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const normalized = items.map((it, i) => ({ ...it, position: i }));
      await onCreateTemplate(
        name.trim(),
        legacyContent.trim(),
        undefined, // mediaType derivado dos itens no hook
        null,
        null,
        isPublic,
        normalized,
      );
      setName(""); setItems([emptyTemplateItem(0)]); setIsPublic(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar template");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Input placeholder="Nome do template" value={name} onChange={(e) => setName(e.target.value)} disabled={isSaving}
        className="rounded-xl bg-secondary/50 border-border/50" />

      <TemplateItemsEditor items={items} onItemsChange={setItems} templateName={name} disabled={isSaving} />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Placeholders:</span>
        <code className="rounded-md bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 text-xs text-purple-400 font-mono">{"{{nome}}"}</code>
        <code className="rounded-md bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 text-xs text-purple-400 font-mono">{"{{valor_conta}}"}</code>
      </div>

      {/* Visibilidade */}
      <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-secondary/10 p-2">
        <button type="button" onClick={() => setIsPublic(false)} disabled={isSaving}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all ${!isPublic ? "bg-secondary/60 text-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary/30"}`}>
          <Lock className="w-3.5 h-3.5" /> Privado (só eu)
        </button>
        <button type="button" onClick={() => setIsPublic(true)} disabled={isSaving}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all ${isPublic ? "bg-green-500/15 text-green-400 shadow-sm" : "text-muted-foreground hover:bg-secondary/30"}`}>
          <Globe2 className="w-3.5 h-3.5" /> Público (todos)
        </button>
      </div>

      <Button onClick={handleCreate} disabled={!canSave || isSaving}
        className="gap-2 rounded-xl h-11 font-bold w-full" style={{ background: "var(--gradient-green)" }}>
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Salvar Template
      </Button>
    </div>
  );
}
