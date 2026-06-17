// =============================================================================
// Esteira — Admin do Modelo de Etapas (agrupado por família)
// =============================================================================

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const FAMILY_OPTIONS = [
  { value: "placas", label: "Placas Solares" },
  { value: "energia", label: "Energia (Solar)" },
  { value: "telecom", label: "Telecom" },
  { value: "seguros", label: "Seguros" },
] as const;

const FAMILY_LABEL: Record<string, string> = {
  placas: "Placas Solares",
  energia: "Energia (Solar)",
  telecom: "Telecom",
  seguros: "Seguros",
};

export function StageTemplateAdmin() {
  const { data: stages = [], isLoading } = useStageTemplate();
  const seed = useSeedDefaultTemplate();
  const add = useAddStage();
  const reorder = useReorderStages();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [newFamily, setNewFamily] = useState<string>("placas");

  // Agrupar por família.
  const grouped = useMemo(() => {
    const map = new Map<string, StageTemplate[]>();
    for (const s of stages) {
      const key = s.productFamily ?? "__generic";
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    // Ordenar cada grupo por position.
    for (const [, list] of map) {
      list.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [stages]);

  const handleAdd = async () => {
    if (!isValidStageName(newName)) {
      toast({ title: "Nome inválido", description: "Use 1 a 80 caracteres.", variant: "destructive" });
      return;
    }
    // Conta quantas etapas já existem nessa família para definir a position.
    const familyStages = grouped.get(newFamily) ?? [];
    const nextPosition = familyStages.length;
    try {
      await add.mutateAsync({ name: newName, position: nextPosition, productFamily: newFamily });
      setNewName("");
    } catch (err) {
      toast({
        title: "Não foi possível adicionar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const move = async (id: string, dir: -1 | 1, family: string) => {
    const familyStages = grouped.get(family) ?? [];
    const ordered = [...familyStages].sort((a, b) => a.position - b.position);
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
    <div className="space-y-6">
      {stages.length === 0 && (
        <div className="border border-dashed border-pv-mid/50 p-4 text-center">
          <p className="text-sm text-pv-ink/70 mb-2">
            Nenhuma etapa cadastrada. Inicialize com o modelo padrão.
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

      {/* Agrupado por família */}
      {FAMILY_OPTIONS.map(({ value: familyKey, label: familyLabel }) => {
        const familyStages = grouped.get(familyKey) ?? [];
        if (familyStages.length === 0) return null;
        return (
          <section key={familyKey} className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-accent">
              {familyLabel}
            </h4>
            <ul className="space-y-1.5">
              {familyStages.map((s) => (
                <TemplateRowItem
                  key={s.id}
                  stage={s}
                  onMove={(id, dir) => move(id, dir, familyKey)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {/* Adicionar nova etapa */}
      <div className="border-t border-pv-mid/30 pt-4 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-ink/60">
          Adicionar etapa
        </p>
        <div className="flex items-center gap-2">
          <Select value={newFamily} onValueChange={setNewFamily}>
            <SelectTrigger className="h-9 text-xs w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FAMILY_OPTIONS.map((f) => (
                <SelectItem key={f.value} value={f.value} className="text-xs">
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome da etapa..."
            className="h-9 text-sm flex-1"
          />
          <Button onClick={() => void handleAdd()} disabled={add.isPending} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>
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
