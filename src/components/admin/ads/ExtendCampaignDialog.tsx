import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Loader2, CalendarPlus, DollarSign, Sparkles, AlertTriangle, Infinity as InfinityIcon } from "lucide-react";
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
  onUpdated: (patch: {
    id: string;
    status?: string;
    daily_budget_cents?: number;
    ended_at?: string | null;
    duration_days?: number | null;
  }) => void;
}

export function ExtendCampaignDialog({ open, onOpenChange, campaign, onUpdated }: Props) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"continuous" | "days">("continuous");
  const [addDays, setAddDays] = useState(7);
  const [budgetReais, setBudgetReais] = useState<string>(
    campaign ? String(Math.max(10, Math.round(campaign.daily_budget_cents / 100))) : "10",
  );
  const [loading, setLoading] = useState(false);

  if (!campaign) return null;

  const currentEnd = campaign.ended_at ? new Date(campaign.ended_at).getTime() : Date.now();
  const base = Math.max(currentEnd, Date.now());
  const newEnd = new Date(base + addDays * 86400_000);
  const budgetCents = Math.max(517, Math.round(Number(budgetReais || "0") * 100));
  const estTotal = mode === "continuous" ? budgetCents / 100 * 30 : (budgetCents / 100) * addDays;
  const wasExpired = campaign.ended_at && new Date(campaign.ended_at).getTime() < Date.now();
  const currentBudgetCents = Math.max(0, campaign.daily_budget_cents);
  const budgetChangePct = currentBudgetCents > 0
    ? Math.abs(budgetCents - currentBudgetCents) / currentBudgetCents * 100
    : 0;
  const largeBudgetChange = budgetChangePct > 20;

  async function handleSubmit() {
    if (!campaign) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-extend-campaign", {
        body: {
          campaign_id: campaign.id,
          add_days: mode === "continuous" ? 0 : addDays,
          continuous: mode === "continuous",
          new_daily_budget_cents: budgetCents,
          reactivate: true,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const metaWarn = (data as any)?.meta_error;
      toast({
        title: metaWarn ? "Atualizado parcialmente" : mode === "continuous" ? "Campanha contínua ativa! 🚀" : "Campanha estendida! 🚀",
        description: metaWarn
          ? `Banco atualizado. Aviso Meta: ${metaWarn}`
          : mode === "continuous"
            ? `R$ ${(budgetCents / 100).toFixed(0)}/dia · sem data fim. Já está rodando.`
            : `+${addDays} dias · R$ ${(budgetCents / 100).toFixed(0)}/dia. Já está rodando.`,
        variant: metaWarn ? "destructive" : "default",
      });
      onUpdated({
        id: campaign.id,
        status: (data as any)?.status,
        daily_budget_cents: (data as any)?.daily_budget_cents,
        ended_at: (data as any)?.ended_at ?? null,
        duration_days: mode === "continuous" ? null : undefined,
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
            Ajustar campanha
          </DialogTitle>
          <DialogDescription className="text-xs">
            <strong>{campaign.name}</strong>
            {wasExpired && (
              <span className="block mt-1 text-warning">
                Encerrou em {new Date(campaign.ended_at!).toLocaleDateString("pt-BR")} — escolha contínuo ou adicione dias.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("continuous")}
              className={`rounded-lg border p-3 text-left text-xs transition ${
                mode === "continuous" ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <div className="font-semibold flex items-center gap-1">
                <InfinityIcon className="w-3.5 h-3.5" /> Contínuo
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Sem data fim · valor mínimo ok</div>
            </button>
            <button
              type="button"
              onClick={() => setMode("days")}
              className={`rounded-lg border p-3 text-left text-xs transition ${
                mode === "days" ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <div className="font-semibold flex items-center gap-1">
                <CalendarPlus className="w-3.5 h-3.5" /> Com prazo
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Adiciona N dias e encerra</div>
            </button>
          </div>

          {mode === "days" && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-xs">
                <CalendarPlus className="w-3.5 h-3.5" /> Adicionar dias: <strong className="text-foreground">{addDays}</strong>
              </Label>
              <Slider value={[addDays]} min={1} max={60} step={1} onValueChange={(v) => setAddDays(v[0])} />
              <p className="text-[11px] text-muted-foreground">
                Nova data fim: <strong className="text-foreground">{newEnd.toLocaleDateString("pt-BR")}</strong>
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs" htmlFor="budget">
              <DollarSign className="w-3.5 h-3.5" /> Orçamento diário (R$) — mínimo 5,17
            </Label>
            <Input
              id="budget"
              type="number"
              min={5.17}
              max={500}
              step={0.01}
              value={budgetReais}
              onChange={(e) => setBudgetReais(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              {mode === "continuous"
                ? <>Estimativa mensal: <strong className="text-foreground">R$ {estTotal.toFixed(2)}</strong></>
                : <>Gasto estimado no período: <strong className="text-foreground">R$ {estTotal.toFixed(2)}</strong></>}
            </p>
            {largeBudgetChange && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-[11px] text-muted-foreground">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning" />
                <span>
                  Mudança de {budgetChangePct.toFixed(0)}% em relação ao orçamento atual. Alterações maiores podem afetar a fase de aprendizado da Meta.
                </span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading || budgetCents < 517} className="gap-1.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {mode === "continuous" ? "Ativar contínuo" : "Aplicar e reativar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
