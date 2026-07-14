// =============================================================================
// Modal de configuração — Oportunidades de venda cruzada
// =============================================================================
// Edita mensagem WA + filtros (produtos/estágios) no template cross_sell_hint.
// Nada é disparado automaticamente.
// =============================================================================

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  CROSS_SELL_PRODUCTS,
  CROSS_SELL_STAGES,
  CROSS_SELL_TEMPLATE_KEY,
  DEFAULT_CROSS_SELL_MESSAGE,
  DEFAULT_CROSS_SELL_PREFS,
  PRODUCT_LABELS,
  STAGE_LABELS,
  applyCrossSellTemplate,
  buildCrossSellVariables,
  parseCrossSellVariables,
  produtoLabelForGaps,
  type CrossSellPrefs,
  type CrossSellProduct,
  type CrossSellStage,
} from "./crossSellConfig";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  onSaved?: () => void;
}

export function CrossSellConfigDialog({ open, onOpenChange, consultantId, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(DEFAULT_CROSS_SELL_MESSAGE);
  const [prefs, setPrefs] = useState<CrossSellPrefs>({
    stages: [...DEFAULT_CROSS_SELL_PREFS.stages],
    products: [...DEFAULT_CROSS_SELL_PREFS.products],
  });
  const [meta, setMeta] = useState<{ label: string; description: string | null; category: string }>({
    label: "Cross-sell — hint energia→telecom/seguro",
    description: "Sugestão de outros produtos (envio manual pelo card).",
    category: "pos-venda",
  });

  useEffect(() => {
    if (!open || !consultantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("consultant_message_templates")
        .select("consultant_id, template_key, label, description, category, text_content, variables")
        .eq("template_key", CROSS_SELL_TEMPLATE_KEY)
        .or(`consultant_id.eq.${consultantId},consultant_id.is.null`);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const rows = data || [];
      const mine = rows.find((r) => r.consultant_id === consultantId);
      const global = rows.find((r) => r.consultant_id == null);
      const chosen = mine || global;
      setMessage(chosen?.text_content?.trim() || DEFAULT_CROSS_SELL_MESSAGE);
      setPrefs(parseCrossSellVariables(chosen?.variables));
      if (chosen) {
        setMeta({
          label: chosen.label || meta.label,
          description: chosen.description,
          category: chosen.category || "pos-venda",
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, consultantId]);

  function toggleStage(stage: CrossSellStage, checked: boolean) {
    setPrefs((prev) => {
      const next = checked
        ? [...new Set([...prev.stages, stage])]
        : prev.stages.filter((s) => s !== stage);
      return { ...prev, stages: next.length > 0 ? next : prev.stages };
    });
  }

  function toggleProduct(product: CrossSellProduct, checked: boolean) {
    setPrefs((prev) => {
      const next = checked
        ? [...new Set([...prev.products, product])]
        : prev.products.filter((p) => p !== product);
      return { ...prev, products: next.length > 0 ? next : prev.products };
    });
  }

  async function handleSave() {
    const text = message.trim();
    if (!text) {
      toast.error("Informe a mensagem do WhatsApp.");
      return;
    }
    if (prefs.stages.length === 0 || prefs.products.length === 0) {
      toast.error("Selecione ao menos um estágio e um produto.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("consultant_message_templates").upsert(
        {
          consultant_id: consultantId,
          template_key: CROSS_SELL_TEMPLATE_KEY,
          label: meta.label,
          description: meta.description,
          category: meta.category,
          text_content: text,
          variables: buildCrossSellVariables(prefs) as import("@/integrations/supabase/types").Json,
          is_active: true,
        },
        { onConflict: "consultant_id,template_key" },
      );
      if (error) throw error;
      toast.success("Configuração de venda cruzada salva");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const preview = applyCrossSellTemplate(message || DEFAULT_CROSS_SELL_MESSAGE, {
    fullName: "Maria Silva",
    produto: produtoLabelForGaps({
      telecom: prefs.products.includes("telecom"),
      seguros: prefs.products.includes("seguros"),
    }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            Configurar venda cruzada
          </DialogTitle>
          <DialogDescription>
            Personalize a mensagem do botão Enviar e filtre quais clientes aparecem na lista.
            Nada é disparado automaticamente — só você decide quando enviar.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <div className="space-y-5 py-1">
            <div className="space-y-2">
              <Label htmlFor="cross-sell-msg">Mensagem do WhatsApp</Label>
              <Textarea
                id="cross-sell-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder={DEFAULT_CROSS_SELL_MESSAGE}
              />
              <p className="text-[11px] text-muted-foreground">
                Use <code className="text-[10px] bg-muted px-1 rounded">{"{{nome}}"}</code> para o
                primeiro nome e{" "}
                <code className="text-[10px] bg-muted px-1 rounded">{"{{produto}}"}</code> para o
                gap (Telecom / Seguro Auto / ambos).
              </p>
              <div className="rounded-lg border bg-muted/30 p-2.5">
                <p className="text-[10px] font-medium text-muted-foreground mb-1">Preview</p>
                <p className="text-xs whitespace-pre-wrap">{preview}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Produtos a oferecer</Label>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Define quais gaps entram na lista (ex.: só Telecom).
              </p>
              <div className="flex flex-wrap gap-3">
                {CROSS_SELL_PRODUCTS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={prefs.products.includes(p)}
                      onCheckedChange={(v) => toggleProduct(p, v === true)}
                    />
                    {PRODUCT_LABELS[p]}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Estágios pós-venda</Label>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Quais buckets do funil entram nas oportunidades.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CROSS_SELL_STAGES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={prefs.stages.includes(s)}
                      onCheckedChange={(v) => toggleStage(s, v === true)}
                    />
                    {STAGE_LABELS[s]}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={loading || saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
