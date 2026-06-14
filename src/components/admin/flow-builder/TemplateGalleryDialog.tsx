// Galeria de templates de fluxo (aprovados pelo super-admin).
//
// Mostra os templates que a comunidade publicou e o super-admin aprovou. Cada
// card traz nome, descrição, autor (nome sempre; telefone só se o autor
// permitiu) e um botão "Usar este modelo", que recria os passos num fluxo NOVO
// e vazio do consultor (RPC `use_flow_template`) — sem tocar no fluxo do autor.
import { useEffect, useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Sparkles, User, Phone, LayoutTemplate } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ALL_VARIANTS, type Variant } from "./flowTypes";

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  author_name: string | null;
  author_phone: string | null;
  show_phone: boolean;
  variant: string;
  steps_count: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string | null;
  /** Variantes já existentes do consultor (para achar um espaço livre). */
  existingVariants: Variant[];
  /** Chamado após usar um template (recarrega a lista de fluxos). */
  onUsed?: (flowId: string) => void;
}

export default function TemplateGalleryDialog({
  open, onOpenChange, consultantId, existingVariants, onUsed,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [usingId, setUsingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("flow_template_submissions")
        .select("id, name, description, author_name, author_phone, show_phone, variant, steps_snapshot")
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const mapped: TemplateRow[] = ((data as any[]) || []).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        author_name: r.author_name,
        author_phone: r.author_phone,
        show_phone: r.show_phone,
        variant: r.variant,
        steps_count: Array.isArray(r.steps_snapshot) ? r.steps_snapshot.length : 0,
      }));
      setRows(mapped);
    } catch (e: any) {
      toast.error("Erro ao carregar a galeria: " + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function applyTemplate(tpl: TemplateRow) {
    if (!consultantId) return;
    // Acha o próximo espaço (letra) livre para o novo fluxo.
    const freeVariant = ALL_VARIANTS.find((v) => !existingVariants.includes(v));
    if (!freeVariant) {
      toast.error("Você atingiu o limite de fluxos. Exclua um antes de usar outro.");
      return;
    }
    setUsingId(tpl.id);
    try {
      const { data: newId, error } = await (supabase as any).rpc("use_flow_template", {
        _submission_id: tpl.id,
        _consultant_id: consultantId,
        _variant: freeVariant,
        _name: tpl.name,
      });
      if (error) throw error;
      toast.success(`Modelo "${tpl.name}" aplicado! Um novo fluxo foi criado.`);
      onUsed?.(newId as string);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Não foi possível usar o modelo: " + (e?.message || String(e)));
    } finally {
      setUsingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-5 w-5 text-primary" />
            Galeria de modelos
          </DialogTitle>
          <DialogDescription>
            Modelos de fluxo publicados pela comunidade e aprovados. Use um como
            ponto de partida — ele vira um novo fluxo seu, que você pode editar à vontade.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid h-48 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/20 p-10 text-center">
            <Sparkles className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Ainda não há modelos na galeria. Publique o seu e ajude a comunidade!
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[460px] pr-3">
            <div className="grid gap-3">
              {rows.map((tpl) => (
                <div key={tpl.id} className="rounded-xl border bg-card p-3.5 shadow-sm transition hover:border-primary/40 hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{tpl.name}</h3>
                      {tpl.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{tpl.description}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {tpl.steps_count} {tpl.steps_count === 1 ? "passo" : "passos"}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {tpl.author_name || "Consultor iGreen"}
                      </span>
                      {tpl.show_phone && tpl.author_phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {tpl.author_phone}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => applyTemplate(tpl)}
                      disabled={usingId === tpl.id}
                    >
                      {usingId === tpl.id
                        ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                      Usar este modelo
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
