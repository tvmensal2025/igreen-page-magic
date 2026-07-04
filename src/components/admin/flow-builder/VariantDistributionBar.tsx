import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreVertical, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { Variant, ALL_VARIANTS, VARIANT_LABEL } from "./flowTypes";

interface Props {
  consultantId: string;
  /** Variantes que já têm fluxo criado (editáveis). */
  existingVariants: Variant[];
  /** Variante atualmente selecionada para edição. */
  editingVariant: Variant;
  onSelectVariant: (v: Variant) => void;
  /** Callback após adicionar/excluir variante para recarregar lista. */
  onChanged: () => void | Promise<void>;
}

export default function VariantDistributionBar({
  consultantId,
  existingVariants,
  editingVariant,
  onSelectVariant,
  onChanged,
}: Props) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [activeVariants, setActiveVariants] = useState<Variant[]>([]);
  // Nome real de cada fluxo (definido pelo consultor). O cliente nunca vê a
  // letra; o nome é o rótulo amigável mostrado no chip.
  const [flowNames, setFlowNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Variant | null>(null);
  const [creating, setCreating] = useState(false);

  const loadActive = useCallback(async () => {
    const { data } = await supabase
      .from("consultants")
      .select("active_variants")
      .eq("id", consultantId)
      .maybeSingle();
    const arr = ((data as any)?.active_variants ?? ["A"]) as string[];
    setActiveVariants(arr.filter((v) => ALL_VARIANTS.includes(v as Variant)) as Variant[]);
  }, [consultantId]);

  const loadNames = useCallback(async () => {
    const { data } = await supabase
      .from("bot_flows")
      .select("variant, name")
      .eq("consultant_id", consultantId)
      .eq("is_active", true);
    const map: Record<string, string> = {};
    for (const r of ((data as any[]) || [])) {
      if (r?.variant && r?.name) map[String(r.variant)] = String(r.name);
    }
    setFlowNames(map);
  }, [consultantId]);

  useEffect(() => { loadActive(); loadNames(); }, [loadActive, loadNames]);

  async function toggleActive(v: Variant, on: boolean) {
    const current = new Set(activeVariants);
    if (on) current.add(v);
    else {
      if (activeVariants.length <= 1 && activeVariants.includes(v)) {
        toast.error("Pelo menos 1 fluxo precisa estar ativo.");
        return;
      }
      current.delete(v);
    }
    const next = ALL_VARIANTS.filter((x) => current.has(x));
    setBusy(v);
    const { error } = await supabase
      .from("consultants")
      .update({ active_variants: next })
      .eq("id", consultantId);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setActiveVariants(next);
    toast.success(on ? `Fluxo ${v} recebendo leads` : `Fluxo ${v} pausado (continua editável)`);
  }

  async function createVariant(target: Variant) {
    if (existingVariants.includes(target)) {
      onSelectVariant(target);
      return;
    }
    // Pede o nome do fluxo. O cliente nunca vê a letra (é só código interno);
    // o nome é o que identifica o fluxo para o consultor.
    const nome = await prompt({
      title: "Criar novo fluxo",
      description: "Dê um nome para o seu fluxo (ex.: \"Atendimento Solar SP\"). Ele começa vazio, do zero.",
      placeholder: "Nome do fluxo",
      defaultValue: "",
      confirmText: "Criar do zero",
    });
    // Cancelou o prompt → não cria nada.
    if (nome === null) return;
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) {
      toast.error("Dê um nome para o fluxo.");
      return;
    }

    setCreating(true);
    const { data: newId, error } = await (supabase as any).rpc("create_empty_bot_flow_variant", {
      _consultant_id: consultantId,
      _variant: target,
      _name: nomeLimpo,
    });
    setCreating(false);
    // Sempre revalida a lista de variantes existentes — mesmo em erro,
    // garante que a UI não fique "presa" mostrando que o fluxo não existe.
    await onChanged();
    if (error) {
      const msg = String(error.message || "").trim();
      toast.error(`Não foi possível criar o fluxo${msg ? `: ${msg}` : ""}`);
      return;
    }
    toast.success(`Fluxo "${nomeLimpo}" criado. Comece a montar os passos!`);
    onSelectVariant(target);
  }

  async function renameVariant(v: Variant) {
    if (v === "D" || v === "M") {
      toast.error(`O fluxo ${v === "M" ? "MG" : v} não pode ser renomeado.`);
      return;
    }
    const { data: row } = await supabase
      .from("bot_flows")
      .select("id, name")
      .eq("consultant_id", consultantId)
      .eq("variant", v)
      .eq("is_active", true)
      .maybeSingle();
    if (!row?.id) { toast.error("Fluxo não encontrado."); return; }
    const novo = await prompt({
      title: "Nome do Fluxo",
      description: "Escolha um nome para identificar este fluxo. Este nome é apenas para seu controle interno.",
      placeholder: "Ex: Atendimento Solar SP",
      defaultValue: (row as any).name || `Fluxo ${v}`,
      confirmText: "Salvar Nome",
    });
    if (novo === null || !novo.trim()) return;
    const { error } = await supabase
      .from("bot_flows")
      .update({ name: novo.trim() })
      .eq("id", (row as any).id);
    if (error) { toast.error(error.message); return; }
    toast.success("Nome do fluxo atualizado!");
    await loadNames();
    await onChanged();
  }


  async function deleteVariant(v: Variant) {
    // Bloqueia exclusão do último fluxo restante (precisa sobrar pelo menos 1).
    if (existingVariants.length <= 1) {
      toast.error("Não é possível excluir o único fluxo existente.");
      return;
    }
    const ok = await confirm({
      title: `Excluir fluxo ${v}?`,
      description: "Os passos deste fluxo serão removidos. Clientes ativos nele passarão a usar outro fluxo ativo.",
      confirmText: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(v);
    // Remove de active_variants antes — mantém pelo menos 1 fluxo ativo (qualquer um restante).
    const remaining = existingVariants.filter((x) => x !== v);
    const nextActive = activeVariants.filter((x) => x !== v);
    if (nextActive.length === 0 && remaining.length > 0) nextActive.push(remaining[0]);
    await supabase.from("consultants").update({ active_variants: nextActive }).eq("id", consultantId);
    // Apaga o fluxo (cascade nos steps)
    const { error } = await supabase
      .from("bot_flows").delete()
      .eq("consultant_id", consultantId).eq("variant", v);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setActiveVariants(nextActive as Variant[]);
    toast.success(`Fluxo ${v} excluído`);
    if (editingVariant === v && remaining.length > 0) onSelectVariant(remaining[0]);
    await onChanged();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/50 p-2">
        <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
          Seus fluxos
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Cada cliente novo entra em um dos fluxos ativos, alternando entre eles.
                Fluxos pausados continuam editáveis, mas não recebem clientes.
              </TooltipContent>
            </Tooltip>

          </TooltipProvider>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {existingVariants.map((v) => {
            const isActive = activeVariants.includes(v);
            const isEditing = editingVariant === v;
            return (
              <div
                key={v}
                className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1 transition ${
                  isEditing ? "border-primary bg-primary/10" : "border-border bg-background"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectVariant(v)}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <span className={`h-2 w-2 rounded-full ${isActive ? "bg-primary/100" : "bg-muted-foreground/40"}`} />
                  <span className="font-semibold">{v}</span>
                  <span className="hidden max-w-[160px] truncate text-muted-foreground sm:inline">
                    {flowNames[v] ?? VARIANT_LABEL[v].replace(/^[A-E]\s*/, "")}
                  </span>
                </button>
                {busy === v ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    checked={isActive}
                    onCheckedChange={(c) => toggleActive(v, c)}
                    className="scale-75"
                  />
                )}
                {existingVariants.length > 1 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-5 w-5">
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {v !== "D" && (
                        <DropdownMenuItem onClick={() => renameVariant(v)}>
                          Renomear fluxo {v}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => deleteVariant(v)}
                      >
                        Excluir fluxo {v}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}

          {ALL_VARIANTS.filter((v) => !existingVariants.includes(v)).length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs bg-primary text-white hover:bg-primary/90 hover:text-white border-0 shadow-sm transition-all" disabled={creating}>
                  {creating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
                  Construir novo fluxo
                </Button>

              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {ALL_VARIANTS.filter((v) => !existingVariants.includes(v)).map((v) => (
                  <DropdownMenuItem key={v} onClick={() => createVariant(v)}>
                    Novo fluxo do zero <span className="ml-1 text-muted-foreground">(espaço {v})</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="ml-auto">
          <Badge variant="secondary" className="text-[10px]">
            {activeVariants.length} fluxo{activeVariants.length === 1 ? "" : "s"} ativo{activeVariants.length === 1 ? "" : "s"} · revezando
          </Badge>
        </div>
      </div>
    </div>
  );

}
