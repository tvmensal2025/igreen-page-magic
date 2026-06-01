import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Loader2, CalendarPlus, DollarSign, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign: {
    id: string;
    name: string;
    status: string;
    daily_budget_cents: number;
    ended_at?: string | null;
  } | null;
  onUpdated: (patch: { id: string; status?: string; daily_budget_cents?: number; ended_at?: string | null }) => void;
}

export function ExtendCampaignDialog({ open, onOpenChange, campaign, onUpdated }: Props) {
  const { toast } = useToast();
  const [addDays, setAddDays] = useState(7);
  const [budgetReais, setBudgetReais] = useState<string>(
    campaign ? String(Math.round(campaign.daily_budget_cents / 100)) : "20"
  );
  const [loading, setLoading] = useState(false);

  if (!campaign) return null;

  const currentEnd = campaign.ended_at ? new Date(campaign.ended_at).getTime() : Date.now();
  const base = Math.max(currentEnd, Date.now());
  const newEnd = new Date(base + addDays * 86400_000);
  const budgetCents = Math.max(500, Math.round(Number(budgetReais || "0") * 100));
  const estTotal = (budgetCents / 100) * addDays;
  const wasExpired = campaign.ended_at && new Date(campaign.ended_at).getTime() < Date.now();

  async function handleSubmit() {
    if (!campaign) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-extend-campaign", {
        body: {
          campaign_id: campaign.id,
          add_days: addDays,
          new_daily_budget_cents: budgetCents,
          reactivate: true,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const metaWarn = (data as any)?.meta_error;
      toast({
        title: metaWarn ? "Atualizado parcialmente" : "Campanha estendida! 🚀",
        description: metaWarn
          ? `Banco atualizado. Aviso Meta: ${metaWarn}`
          : `+${addDays} dias · R$ ${(budgetCents / 100).toFixed(0)}/dia. Já está rodando.`,
        variant: metaWarn ? "destructive" : "default",
      });
      onUpdated({
        id: campaign.id,
        status: (data as any)?.status,
        daily_budget_cents: (data as any)?.daily_budget_cents,
        ended_at: (data as any)?.ended_at,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Falha ao estender", description: e?.message || "Erro", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Estender campanha
          </DialogTitle>
          <DialogDescription className="text-xs">
            <strong>{campaign.name}</strong>
            {wasExpired && (
              <span className="block mt-1 text-amber-500">
                Encerrou em {new Date(campaign.ended_at!).toLocaleDateString("pt-BR")} — adicione dias para reativar.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs">
              <CalendarPlus className="w-3.5 h-3.5" /> Adicionar dias: <strong className="text-foreground">{addDays}</strong>
            </Label>
            <Slider value={[addDays]} min={1} max={60} step={1} onValueChange={(v) => setAddDays(v[0])} />
            <p className="text-[11px] text-muted-foreground">
              Nova data fim: <strong className="text-foreground">{newEnd.toLocaleDateString("pt-BR")}</strong>
            </p>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs" htmlFor="budget">
              <DollarSign className="w-3.5 h-3.5" /> Orçamento diário (R$)
            </Label>
            <Input
              id="budget"
              type="number"
              min={5}
              step={1}
              value={budgetReais}
              onChange={(e) => setBudgetReais(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Gasto estimado no período: <strong className="text-foreground">R$ {estTotal.toFixed(2)}</strong>
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading || budgetCents < 500} className="gap-1.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Aplicar e reativar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
