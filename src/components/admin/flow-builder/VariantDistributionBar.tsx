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
  const [activeVariants, setActiveVariants] = useState<Variant[]>([]);
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

  useEffect(() => { loadActive(); }, [loadActive]);

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

  async function addVariant() {
    const next = ALL_VARIANTS.find((v) => !existingVariants.includes(v));
    if (!next) { toast.error("Todos os fluxos (A–E) já foram criados (limite: 5)."); return; }
    setCreating(true);
    const { data: cons } = await supabase
      .from("consultants").select("name").eq("id", consultantId).maybeSingle();
    const baseName = (cons as any)?.name ? `Fluxo de ${(cons as any).name}` : "Fluxo";
    const { error } = await (supabase as any).from("bot_flows").insert({
      consultant_id: consultantId,
      name: `${baseName} (${next})`,
      is_active: true,
      variant: next,
      initial_delay_seconds: 0,
    });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Fluxo ${next} criado`);
    await onChanged();
    onSelectVariant(next);
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
          Distribuição de fluxos
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Clientes novos são distribuídos 1 a 1 (round-robin) entre os fluxos ativos.
                Fluxos pausados continuam editáveis mas não recebem leads.
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
                  <span className={`h-2 w-2 rounded-full ${isActive ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                  <span className="font-semibold">{v}</span>
                  <span className="hidden text-muted-foreground sm:inline">
                    {VARIANT_LABEL[v].replace(/^[A-E]\s*/, "")}
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
                {v !== "A" && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-5 w-5">
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => deleteVariant(v)}
                      >
                        Excluir variante {v}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}

          {existingVariants.length < ALL_VARIANTS.length && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={addVariant}
              disabled={creating}
            >
              {creating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
              Adicionar variante
            </Button>
          )}
        </div>

        <div className="ml-auto">
          <Badge variant="secondary" className="text-[10px]">
            {activeVariants.length} ativa{activeVariants.length === 1 ? "" : "s"} · round-robin 1 a 1
          </Badge>
        </div>
      </div>
    </div>
  );
}
