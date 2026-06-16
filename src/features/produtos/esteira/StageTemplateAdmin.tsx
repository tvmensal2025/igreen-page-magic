// =============================================================================
// Esteira — Admin do Modelo de Etapas
// =============================================================================

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  useAddStage,
  useRemoveStage,
  useRenameStage,
  useReorderStages,
  useSeedDefaultTemplate,
  useStageTemplate,
} from "./hooks";
import { isValidStageName } from "./logic";
import type { StageTemplate } from "./types";

export function StageTemplateAdmin() {
  const { data: stages = [], isLoading } = useStageTemplate();
  const seed = useSeedDefaultTemplate();
  const add = useAddStage();
  const reorder = useReorderStages();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");

  const handleAdd = async () => {
    if (!isValidStageName(newName)) {
      toast({ title: "Nome inválido", description: "Use 1 a 80 caracteres.", variant: "destructive" });
      return;
    }
    try {
      await add.mutateAsync({ name: newName, position: stages.length });
      setNewName("");
    } catch (err) {
      toast({
        title: "Não foi possível adicionar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const move = async (id: string, dir: -1 | 1) => {
    const ordered = [...stages].sort((a, b) => a.position - b.position);
    const idx = ordered.findIndex((s) => s.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= ordered.length) return;
    const next = [...ordered];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    const payload = next.map((s, i) => ({ id: s.id, position: i }));
    try {
      await reorder.mutateAsync(payload);
    } catch (err) {
      toast({
        title: "Falha ao reordenar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  if (isLoading) return <p className="text-xs text-pv-ink/40">Carregando...</p>;

  return (
    <div className="space-y-4">
      {stages.length === 0 && (
        <div className="border border-dashed border-pv-mid/50 p-4 text-center">
          <p className="text-sm text-pv-ink/70 mb-2">
            Nenhuma etapa cadastrada. Inicialize com o modelo padrão (4 etapas).
          </p>
          <Button
            size="sm"
            onClick={() => void seed.mutateAsync()}
            disabled={seed.isPending}
          >
            Inicializar etapas padrão
          </Button>
        </div>
      )}

      <ul className="space-y-2">
        {stages.map((s) => (
          <TemplateRowItem key={s.id} stage={s} onMove={move} />
        ))}
      </ul>

      <div className="flex items-center gap-2 border-t border-pv-mid/30 pt-3">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nova etapa..."
          className="h-9 text-sm"
        />
        <Button onClick={() => void handleAdd()} disabled={add.isPending} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
}

function TemplateRowItem({
  stage,
  onMove,
}: {
  stage: StageTemplate;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const [name, setName] = useState(stage.name);
  const rename = useRenameStage();
  const remove = useRemoveStage();
  const { toast } = useToast();

  const dirty = name !== stage.name;

  const onSave = async () => {
    if (!isValidStageName(name)) {
      toast({ title: "Nome inválido", variant: "destructive" });
      return;
    }
    try {
      await rename.mutateAsync({ id: stage.id, name });
    } catch (err) {
      toast({
        title: "Falha ao renomear",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const onDelete = async () => {
    if (!window.confirm(`Remover etapa "${stage.name}"?`)) return;
    try {
      await remove.mutateAsync(stage.id);
    } catch (err) {
      toast({
        title: "Falha ao remover",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  return (
    <li className="flex items-center gap-2 bg-white border border-pv-mid/30 p-2">
      <span className="text-xs text-pv-ink/40 w-6 text-center font-mono">
        {stage.position + 1}
      </span>
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => onMove(stage.id, -1)}
          className="text-pv-ink/40 hover:text-pv-ink"
          aria-label="Subir"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onMove(stage.id, 1)}
          className="text-pv-ink/40 hover:text-pv-ink"
          aria-label="Descer"
        >
          <ArrowDown className="h-3 w-3" />
        </button>
      </div>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-8 text-sm flex-1"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => void onSave()}
        disabled={!dirty || rename.isPending}
      >
        <Save className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void onDelete()}
        disabled={remove.isPending}
      >
        <Trash2 className="h-3.5 w-3.5 text-red-500" />
      </Button>
    </li>
  );
}
