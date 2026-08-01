import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FLOW_TEMPLATES, FlowTemplate, TemplateStepSeed } from "./flowTemplates";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowId: string | null;
  currentMaxPosition: number;
  onApplied: () => void;
  /** Prefere Sofia Multicanal quando o dialog abre. */
  preferTemplateId?: string | null;
}

type SeedTransition = NonNullable<TemplateStepSeed["transitions"]>[number];

/** Remove goto_step_key e deixa só o que o runtime entende. */
function stripSeedKeys(transitions: SeedTransition[] | undefined): Array<{
  trigger_intent: string;
  trigger_phrases: string[];
  goto_step_id: string | null;
  goto_special: string | null;
}> {
  return (transitions ?? []).map((t) => ({
    trigger_intent: t.trigger_intent,
    trigger_phrases: t.trigger_phrases ?? [],
    goto_step_id: t.goto_step_id ?? null,
    goto_special: t.goto_special ?? null,
  }));
}

/** Após insert, resolve goto_step_key → UUID real do passo no mesmo flow. */
async function resolveGotoKeys(
  flowId: string,
  inserted: Array<{ id: string; step_key: string }>,
  seeds: TemplateStepSeed[],
): Promise<void> {
  const byKey = new Map(inserted.map((r) => [r.step_key, r.id]));
  for (const seed of seeds) {
    const rowId = byKey.get(seed.step_key);
    if (!rowId) continue;
    const txs = seed.transitions ?? [];
    if (!txs.some((t) => t.goto_step_key)) continue;
    const resolved = txs.map((t) => ({
      trigger_intent: t.trigger_intent,
      trigger_phrases: t.trigger_phrases ?? [],
      goto_step_id: t.goto_step_key
        ? byKey.get(t.goto_step_key) ?? t.goto_step_id ?? null
        : t.goto_step_id ?? null,
      goto_special: t.goto_special ?? null,
    }));
    const { error } = await supabase
      .from("bot_flow_steps")
      .update({ transitions: resolved as any })
      .eq("id", rowId)
      .eq("flow_id", flowId);
    if (error) throw error;
  }
}

export default function FlowTemplatesDialog({
  open,
  onOpenChange,
  flowId,
  currentMaxPosition,
  onApplied,
  preferTemplateId = null,
}: Props) {
  const confirm = useConfirm();
  const [picked, setPicked] = useState<string | null>(preferTemplateId);
  const [applying, setApplying] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(
    preferTemplateId === "sofia_ativacao_multicanal",
  );

  async function apply(tpl: FlowTemplate) {
    if (!flowId) return;
    setApplying(true);
    try {
      let basePosition = currentMaxPosition;
      if (replaceExisting) {
        const ok = await confirm({
          title: `Substituir pelos passos de "${tpl.name}"?`,
          description: `Isso apaga os passos deste fluxo e grava os ${tpl.steps.length} oficiais.`,
          confirmText: "Substituir passos",
          cancelText: "Cancelar",
          tone: "danger",
        });
        if (!ok) {
          setApplying(false);
          return;
        }
        const { error: delErr } = await supabase
          .from("bot_flow_steps")
          .delete()
          .eq("flow_id", flowId);
        if (delErr) throw delErr;
        basePosition = 0;
      }

      const rows = tpl.steps.map((s, i) => ({
        flow_id: flowId,
        position: basePosition + i + 1,
        step_type: s.step_type,
        step_key: s.step_key,
        title: s.title,
        summary: s.summary ?? "",
        icon: s.icon ?? "msg",
        message_text: s.message_text ?? "",
        slot_key: s.slot_key ?? s.step_key,
        media_order: s.media_order ?? [],
        transitions: stripSeedKeys(s.transitions),
        captures: s.captures ?? [],
        fallback: s.fallback ?? { mode: "repeat" },
        is_active: true,
      }));

      const { data: inserted, error } = await supabase
        .from("bot_flow_steps")
        .insert(rows as any)
        .select("id, step_key");
      if (error) throw error;

      await resolveGotoKeys(
        flowId,
        ((inserted as any[]) || []).map((r) => ({
          id: String(r.id),
          step_key: String(r.step_key),
        })),
        tpl.steps,
      );

      toast.success(
        replaceExisting
          ? `${tpl.name}: ${rows.length} passos substituídos (transitions resolvidas)`
          : `${tpl.name}: ${rows.length} passos adicionados`,
      );
      onApplied();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro ao aplicar template: " + (e?.message || "desconhecido"));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (v && preferTemplateId) {
          setPicked(preferTemplateId);
          setReplaceExisting(preferTemplateId === "sofia_ativacao_multicanal");
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Templates de fluxo
          </DialogTitle>
          <DialogDescription>
            Sofia = roteiro oficial de leads novos (11 passos). Use &quot;Substituir passos&quot; na
            variante A para gravar o fluxo limpo com botões e OCR.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[420px] pr-3">
          <div className="grid gap-2">
            {FLOW_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  setPicked(tpl.id);
                  if (tpl.id === "sofia_ativacao_multicanal") setReplaceExisting(true);
                }}
                className={`group flex items-start gap-3 rounded-lg border p-3 text-left transition-all hover:border-primary/50 ${
                  picked === tpl.id ? "border-primary bg-primary/5 ring-2 ring-primary/20" : ""
                }`}
              >
                <span className="text-2xl">{tpl.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{tpl.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {tpl.steps.length} passos
                    </Badge>
                    {tpl.id === "sofia_ativacao_multicanal" && (
                      <Badge className="text-[10px]">Roteiro oficial</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tpl.description}</p>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>

        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
          <Checkbox
            id="replace-steps"
            checked={replaceExisting}
            onCheckedChange={(v) => setReplaceExisting(v === true)}
          />
          <Label htmlFor="replace-steps" className="text-sm cursor-pointer">
            Substituir passos atuais (recomendado para Sofia na C)
          </Label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Cancelar
          </Button>
          <Button
            disabled={!picked || applying || !flowId}
            onClick={() => {
              const tpl = FLOW_TEMPLATES.find((t) => t.id === picked);
              if (tpl) void apply(tpl);
            }}
          >
            {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {replaceExisting ? "Substituir e aplicar" : "Adicionar ao fluxo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
