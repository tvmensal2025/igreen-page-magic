import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Percent, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { invalidateBonusTiers, type BonusTier } from "@/hooks/useAdBonusTiers";

const TIER_META: { tier: BonusTier; title: string; hint: string; accent: string }[] = [
  { tier: "alto", title: "🟢 Bônus alto", hint: "Distribuidoras em que o consultor consegue o maior bônus.", accent: "border-primary/40" },
  { tier: "medio", title: "🟡 Bônus médio", hint: "Distribuidoras com bônus parcial.", accent: "border-warning/40" },
  { tier: "sem_bonus", title: "⚪ Sem bônus", hint: "Distribuidoras sem bônus adicional.", accent: "border-muted" },
];

export function BonusTiersAdminCard() {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<BonusTier, number>>({ alto: 60, medio: 30, sem_bonus: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("ad_bonus_tiers").select("tier,percent");
      const next = { alto: 60, medio: 30, sem_bonus: 0 } as Record<BonusTier, number>;
      (data || []).forEach((r: any) => {
        if (r.tier in next) next[r.tier as BonusTier] = r.percent;
      });
      setValues(next);
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const rows = (Object.keys(values) as BonusTier[]).map((t) => ({
        tier: t,
        label: t === "alto" ? "Bônus alto" : t === "medio" ? "Bônus médio" : "Sem bônus",
        percent: Math.max(0, Math.min(100, Math.round(values[t]))),
      }));
      const { error } = await (supabase as any)
        .from("ad_bonus_tiers")
        .upsert(rows, { onConflict: "tier" });
      if (error) throw error;
      invalidateBonusTiers();
      toast({ title: "Bônus atualizado", description: "Os novos valores aparecem nas próximas campanhas." });
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e?.message || "Tente novamente", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando bônus…
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Percent className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="font-heading font-bold text-sm sm:text-base">Bônus por tier de distribuidora</h3>
          <p className="text-xs text-muted-foreground">
            Esses % aparecem no criador de campanhas (modelos prontos e wizard). São apenas rótulos editáveis pra refletir a realidade do mês.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {TIER_META.map((m) => (
          <div key={m.tier} className={`rounded-lg border ${m.accent} bg-card/50 p-3 space-y-2`}>
            <div className="text-xs font-bold text-primary">{m.title}</div>
            <p className="text-[11px] text-muted-foreground">{m.hint}</p>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Percentual exibido</Label>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                max={100}
                value={values[m.tier]}
                onChange={(e) => setValues((p) => ({ ...p, [m.tier]: Number(e.target.value || 0) }))}
                className="h-9"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar bônus
        </Button>
      </div>
    </Card>
  );
}
