import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

type KanbanStageRow = Tables<"kanban_stages">;
type KanbanStageInsert = TablesInsert<"kanban_stages">;

// Lead CRM termina em "Finalizando cadastro". A partir daí o cliente passa
// para o CRM de Pós-Venda (aprovado / reprovado / 30-60-90-120 dias) quando
// a extensão sincroniza com o iGreen.
const DEFAULT_STAGES: Omit<KanbanStageInsert, "consultant_id">[] = [
  { stage_key: "novo_lead", label: "Novo Lead", color: "bg-purple-500/20 text-purple-400", position: 0, auto_message_text: null, auto_message_type: "text", auto_message_media_url: null, auto_message_enabled: true },
  { stage_key: "qualificando", label: "Em qualificação", color: "bg-indigo-500/20 text-indigo-400", position: 1, auto_message_text: null, auto_message_type: "text", auto_message_media_url: null, auto_message_enabled: false },
  { stage_key: "valor_conta", label: "Valor da conta", color: "bg-teal-500/20 text-teal-400", position: 2, auto_message_text: null, auto_message_type: "text", auto_message_media_url: null, auto_message_enabled: false },
  { stage_key: "conta_enviada", label: "Conta enviada", color: "bg-cyan-500/20 text-cyan-400", position: 3, auto_message_text: null, auto_message_type: "text", auto_message_media_url: null, auto_message_enabled: false },
  { stage_key: "doc_enviado", label: "Documento enviado", color: "bg-blue-500/20 text-blue-400", position: 4, auto_message_text: null, auto_message_type: "text", auto_message_media_url: null, auto_message_enabled: false },
  { stage_key: "finalizando", label: "Finalizando cadastro", color: "bg-pink-500/20 text-pink-400", position: 5, auto_message_text: null, auto_message_type: "text", auto_message_media_url: null, auto_message_enabled: false },
];

export const COLOR_OPTIONS = [
  { value: "bg-purple-500/20 text-purple-400", label: "Roxo" },
  { value: "bg-green-500/20 text-green-400", label: "Verde" },
  { value: "bg-red-500/20 text-red-400", label: "Vermelho" },
  { value: "bg-blue-500/20 text-blue-400", label: "Azul" },
  { value: "bg-cyan-500/20 text-cyan-400", label: "Ciano" },
  { value: "bg-yellow-500/20 text-yellow-400", label: "Amarelo" },
  { value: "bg-orange-500/20 text-orange-400", label: "Laranja" },
  { value: "bg-pink-500/20 text-pink-400", label: "Rosa" },
  { value: "bg-teal-500/20 text-teal-400", label: "Teal" },
  { value: "bg-indigo-500/20 text-indigo-400", label: "Índigo" },
];

export function useKanbanStages(consultantId: string) {
  const [stages, setStages] = useState<KanbanStageRow[]>([]);
  const { toast } = useToast();

  const fetchStages = useCallback(async () => {
    const { data } = await supabase
      .from("kanban_stages")
      .select("*")
      .eq("consultant_id", consultantId)
      .or("stage_scope.eq.lead,stage_scope.is.null")
      .order("position", { ascending: true });

    if (data && data.length > 0) {
      setStages(data);
    } else {
      const inserts: KanbanStageInsert[] = DEFAULT_STAGES.map((s) => ({
        ...s,
        consultant_id: consultantId,
        stage_scope: "lead",
      }));
      const { data: inserted } = await supabase
        .from("kanban_stages")
        .insert(inserts)
        .select();
      if (inserted) setStages(inserted);
    }
  }, [consultantId]);

  const addStage = async (label: string, color: string) => {
    if (!label.trim()) return;
    const stageKey = label.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const { data, error } = await supabase
      .from("kanban_stages")
      .insert({ consultant_id: consultantId, stage_key: stageKey || `stage_${Date.now()}`, label: label.trim(), color, position: stages.length })
      .select()
      .single();
    if (error) {
      toast({ title: "Erro ao criar coluna", variant: "destructive" });
    } else if (data) {
      setStages((prev) => [...prev, data]);
      toast({ title: "Coluna criada!" });
    }
  };

  const updateStage = async (stage: KanbanStageRow) => {
    const { error } = await supabase.from("kanban_stages").update({ label: stage.label, color: stage.color }).eq("id", stage.id);
    if (error) {
      toast({ title: "Erro ao editar coluna", variant: "destructive" });
    } else {
      setStages((prev) => prev.map((s) => (s.id === stage.id ? stage : s)));
      toast({ title: "Coluna atualizada!" });
    }
  };

  const deleteStage = async (stageId: string, dealsCount: number) => {
    if (dealsCount > 0) {
      toast({ title: "Mova os deals antes de excluir", description: `Existem ${dealsCount} deal(s) nesta coluna.`, variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("kanban_stages").delete().eq("id", stageId);
    if (error) {
      toast({ title: "Erro ao excluir coluna", variant: "destructive" });
    } else {
      setStages((prev) => prev.filter((s) => s.id !== stageId));
      toast({ title: "Coluna excluída!" });
    }
  };

  const saveAutoMessage = async (stageId: string, text: string | null, type: string, mediaUrl: string | null, imageUrl: string | null) => {
    const { error } = await supabase.from("kanban_stages").update({ auto_message_text: text, auto_message_type: type, auto_message_media_url: mediaUrl, auto_message_image_url: imageUrl } as any).eq("id", stageId);
    if (error) {
      toast({ title: "Erro ao salvar msg automática", variant: "destructive" });
    } else {
      setStages((prev) => prev.map((s) => s.id === stageId ? { ...s, auto_message_text: text, auto_message_type: type, auto_message_media_url: mediaUrl, auto_message_image_url: imageUrl } as any : s));
    }
  };

  const toggleAutoMessage = async (stageId: string, enabled: boolean) => {
    const { error } = await supabase.from("kanban_stages").update({ auto_message_enabled: enabled }).eq("id", stageId);
    if (error) {
      toast({ title: "Erro ao atualizar", variant: "destructive" });
    } else {
      setStages((prev) => prev.map((s) => s.id === stageId ? { ...s, auto_message_enabled: enabled } : s));
    }
  };

  const reorderStages = async (fromId: string, toId: string) => {
    const fromIndex = stages.findIndex((s) => s.id === fromId);
    const toIndex = stages.findIndex((s) => s.id === toId);
    if (fromIndex === -1 || toIndex === -1) return;
    const reordered = [...stages];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const updated = reordered.map((s, i) => ({ ...s, position: i }));
    setStages(updated);
    for (const s of updated) {
      await supabase.from("kanban_stages").update({ position: s.position }).eq("id", s.id);
    }
    toast({ title: "Ordem das colunas atualizada!" });
  };

  return { stages, setStages, fetchStages, addStage, updateStage, deleteStage, saveAutoMessage, toggleAutoMessage, reorderStages };
}
