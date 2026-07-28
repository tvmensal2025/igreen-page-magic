import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Brain, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  isBrainScaleEligible as checkBrainScaleEligible,
  type BrainScaleEligibilityOpts,
} from "@/lib/brainScaleEligibility";

export type BrainScaleCampaign = {
  id: string;
  name: string;
  daily_budget_cents: number;
  brain_scale_enabled?: boolean;
  brain_scale_step_pct?: number;
  brain_scale_max_budget_cents?: number;
  brain_scale_target_cpl_cents?: number;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaign: BrainScaleCampaign | null;
  onUpdated: (patch: Partial<BrainScaleCampaign> & { id: string }) => void;
  /** Âncora do Cérebro MG (brain_config.anchor_campaign_id) — bloqueia ligar novo. */
  anchorCampaignId?: string | null;
};

const STEP_OPTS = [15, 20, 25, 30];

/**
 * Liga o Cérebro de orçamento nesta campanha (qualquer cidade).
 * Não vale para MG-ROT / âncora — esses usam o Cérebro MG de slots.
 */
export function CampaignBrainScaleDialog({
  open,
  onOpenChange,
  campaign,
  onUpdated,
  anchorCampaignId = null,
}: Props) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [stepPct, setStepPct] = useState(15);
  const [maxReais, setMaxReais] = useState("500");
  const [targetCpl, setTargetCpl] = useState("2.00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!campaign || !open) return;
    setEnabled(Boolean(campaign.brain_scale_enabled));
    setStepPct(Math.max(15, Math.min(30, Number(campaign.brain_scale_step_pct) || 15)));
    setMaxReais(String(Math.round((campaign.brain_scale_max_budget_cents ?? 50000) / 100)));
    setTargetCpl(((campaign.brain_scale_target_cpl_cents ?? 200) / 100).toFixed(2));
  }, [campaign, open]);

  if (!campaign) return null;

  async function handleSave() {
    if (!campaign) return;
    // Só impede LIGAR de novo em MG-ROT/âncora. Já ligado: pode ajustar % ou desligar.
    if (
      enabled &&
      !campaign.brain_scale_enabled &&
      !checkBrainScaleEligible(
        { id: campaign.id, name: campaign.name, brain_scale_enabled: false },
        { anchorCampaignId },
      )
    ) {
      toast({
        title: "Cérebro por campanha não se aplica",
        description:
          "Âncora e campanhas rotativas usam o assistente de Minas. Desligue aqui se já estava ligado por engano.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const maxCents = Math.max(517, Math.min(50000, Math.round(Number(maxReais || "0") * 100)));
      const targetCents = Math.max(50, Math.min(2000, Math.round(Number(targetCpl || "0") * 100)));
      const step = Math.max(15, Math.min(30, stepPct));
      const { data: saved, error } = await supabase
        .from("facebook_campaigns")
        .update({
          brain_scale_enabled: enabled,
          brain_scale_step_pct: step,
          brain_scale_max_budget_cents: maxCents,
          brain_scale_target_cpl_cents: targetCents,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaign.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!saved?.id) throw new Error("Nenhuma linha atualizada — verifique se a campanha é sua.");
      onUpdated({
        id: campaign.id,
        brain_scale_enabled: enabled,
        brain_scale_step_pct: step,
        brain_scale_max_budget_cents: maxCents,
        brain_scale_target_cpl_cents: targetCents,
      });
      toast({
        title: enabled ? `Cérebro ligado (+${step}%)` : "Cérebro desligado",
        description: enabled
          ? "Sobe se o custo por conversa estiver bom · desce se estiver alto · mede 48h · ajuste ~4h. Aviso no seu WhatsApp."
          : "Esta campanha não sobe/desce orçamento sozinha.",
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Falha ao salvar",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            Cérebro de orçamento
          </DialogTitle>
          <DialogDescription>
            Melhora só esta campanha (qualquer cidade). Não é o Cérebro de Minas (MG-ROT).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Ativar Cérebro</div>
              <p className="text-[11px] text-muted-foreground truncate">{campaign.name}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px]">Degrau de escala (%)</Label>
            <Select
              value={String(stepPct)}
              onValueChange={(v) => setStepPct(Number(v))}
              disabled={!enabled}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STEP_OPTS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}% (sobe ou desce)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px]">Custo-alvo por conversa (R$)</Label>
              <Input
                type="number"
                min={0.5}
                step={0.1}
                value={targetCpl}
                disabled={!enabled}
                onChange={(e) => setTargetCpl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px]">Teto R$/dia</Label>
              <Input
                type="number"
                min={5.17}
                step={1}
                value={maxReais}
                disabled={!enabled}
                onChange={(e) => setMaxReais(e.target.value)}
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Budget atual: R$ {(campaign.daily_budget_cents / 100).toFixed(0)}/dia.
            Sobe se custo ≤ alvo · desce se estiver alto · mede 48h · próximo ajuste ~4h.
            Você recebe aviso no WhatsApp quando mudar.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Elegível para Cérebro por campanha (não MG-ROT, não âncora do Cérebro MG).
 * Passe `anchorCampaignId` de brain_config — sem isso só bloqueia MG-ROT + UUID legado.
 * Já ligado → sempre true (para poder desligar).
 */
export function isBrainScaleEligible(
  campaign: { id: string; name: string; brain_scale_enabled?: boolean | null },
  opts?: BrainScaleEligibilityOpts,
): boolean {
  return checkBrainScaleEligible(campaign, opts);
}
