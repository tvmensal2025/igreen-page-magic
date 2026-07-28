import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Percent, Save, Plus, Trash2, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  invalidateBonusTiers,
  DEFAULT_AD_BONUS_TIERS,
  fetchAdBonusTiers,
  type AdBonusTierRow,
  type AdBonusDistribuidora,
  type BonusTier,
} from "@/hooks/useAdBonusTiers";
import type { EntradaBonusFaixa } from "@/data/entradaBonusTiers";

const TIER_ORDER: BonusTier[] = ["alto", "medio", "sem_bonus"];

const TIER_TITLE: Record<BonusTier, string> = {
  alto: "🟢 Bônus alto",
  medio: "🟡 Bônus médio",
  sem_bonus: "⚪ Sem bônus",
};

function emptyFaixa(): EntradaBonusFaixa {
  return {
    minPessoas: 0,
    maxPessoas: null,
    totalPct: 0,
    imediatoPct: 0,
    injecaoPct: 0,
    label: "",
  };
}

function emptyDist(): AdBonusDistribuidora {
  return { ufs: [], label: "", nomeApi: "" };
}

function faixaLabel(f: EntradaBonusFaixa): string {
  if (f.label.trim()) return f.label;
  const range =
    f.maxPessoas == null ? `${f.minPessoas}+` : `${f.minPessoas}–${f.maxPessoas}`;
  const split =
    f.injecaoPct > 0 ? `${f.imediatoPct}+${f.injecaoPct}` : `${f.imediatoPct || f.totalPct}`;
  return `${range} · ${f.totalPct || f.imediatoPct + f.injecaoPct}% (${split})`;
}

function cloneTier(t: AdBonusTierRow): AdBonusTierRow {
  return {
    ...t,
    faixas: t.faixas.map((f) => ({ ...f })),
    distribuidoras: t.distribuidoras.map((d) => ({ ...d, ufs: [...d.ufs] })),
  };
}

export function BonusTiersAdminCard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Record<BonusTier, AdBonusTierRow>>(() => ({
    alto: cloneTier(DEFAULT_AD_BONUS_TIERS.alto),
    medio: cloneTier(DEFAULT_AD_BONUS_TIERS.medio),
    sem_bonus: cloneTier(DEFAULT_AD_BONUS_TIERS.sem_bonus),
  }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await fetchAdBonusTiers();
      setRows({
        alto: cloneTier(data.alto),
        medio: cloneTier(data.medio),
        sem_bonus: cloneTier(data.sem_bonus),
      });
      setLoading(false);
    })();
  }, []);

  function patchTier(tier: BonusTier, patch: Partial<AdBonusTierRow>) {
    setRows((prev) => ({ ...prev, [tier]: { ...prev[tier], ...patch } }));
  }

  function patchFaixa(tier: BonusTier, idx: number, patch: Partial<EntradaBonusFaixa>) {
    setRows((prev) => {
      const faixas = prev[tier].faixas.map((f, i) => {
        if (i !== idx) return f;
        const next = { ...f, ...patch };
        const imediato = Number(next.imediatoPct) || 0;
        const injecao = Number(next.injecaoPct) || 0;
        next.totalPct = imediato + injecao;
        if (!patch.label) next.label = faixaLabel(next);
        return next;
      });
      return { ...prev, [tier]: { ...prev[tier], faixas } };
    });
  }

  function patchDist(tier: BonusTier, idx: number, patch: Partial<AdBonusDistribuidora>) {
    setRows((prev) => {
      const distribuidoras = prev[tier].distribuidoras.map((d, i) =>
        i === idx ? { ...d, ...patch } : d,
      );
      return { ...prev, [tier]: { ...prev[tier], distribuidoras } };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const payload = TIER_ORDER.map((tier) => {
        const r = rows[tier];
        const faixas = r.faixas
          .filter((f) => Number.isFinite(f.minPessoas))
          .map((f) => {
            const imediato = Math.max(0, Number(f.imediatoPct) || 0);
            const injecao = Math.max(0, Number(f.injecaoPct) || 0);
            const total = imediato + injecao;
            const next = {
              ...f,
              minPessoas: Math.max(0, Math.round(Number(f.minPessoas) || 0)),
              maxPessoas:
                f.maxPessoas == null || String(f.maxPessoas) === ""
                  ? null
                  : Math.max(0, Math.round(Number(f.maxPessoas))),
              totalPct: total,
              imediatoPct: imediato,
              injecaoPct: injecao,
            };
            return { ...next, label: faixaLabel(next) };
          });

        const distribuidoras = r.distribuidoras
          .map((d) => ({
            ufs: (Array.isArray(d.ufs) ? d.ufs : String(d.ufs || "").split(/[,;/|\s]+/))
              .map((u) => String(u).trim().toUpperCase())
              .filter(Boolean),
            label: String(d.label || "").trim(),
            nomeApi: String(d.nomeApi || d.label || "")
              .trim()
              .toUpperCase(),
          }))
          .filter((d) => d.label || d.nomeApi);

        return {
          tier,
          label: r.label || TIER_TITLE[tier],
          percent: Math.max(0, Math.min(100, Math.round(Number(r.percent) || 0))),
          faixas,
          distribuidoras,
        };
      });

      const { error } = await (supabase as any)
        .from("ad_bonus_tiers")
        .upsert(payload, { onConflict: "tier" });
      if (error) throw error;
      invalidateBonusTiers();
      toast({
        title: "Tabela salva",
        description: "Faixas e distribuidoras atualizadas. Vale para o Ads e o resumo do painel.",
      });
    } catch (e: any) {
      toast({
        title: "Erro ao salvar",
        description: e?.message || "Tente novamente",
        variant: "destructive",
      });
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
            Tabela editável (faixas de pessoas + % + lista de distribuidoras). Se sair da tabela, exclua; se mudar o mês que vem, ajuste aqui.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {TIER_ORDER.map((tier) => {
          const r = rows[tier];
          const accent =
            tier === "alto" ? "border-primary/40" : tier === "medio" ? "border-warning/40" : "border-muted";
          return (
            <div key={tier} className={`rounded-lg border ${accent} bg-card/50 p-3 space-y-3`}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="text-xs font-bold text-primary">{TIER_TITLE[tier]}</div>
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Teto no Ads</Label>
                  <div className="flex items-center gap-1 w-28">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={r.percent}
                      onChange={(e) => patchTier(tier, { percent: Number(e.target.value || 0) })}
                      className="h-9"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              </div>

              {/* Distribuidoras */}
              <div className="rounded-lg border border-border/60 bg-secondary/20 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5" /> Distribuidoras
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() =>
                      patchTier(tier, { distribuidoras: [...r.distribuidoras, emptyDist()] })
                    }
                  >
                    <Plus className="w-3 h-3" /> Adicionar
                  </Button>
                </div>
                {r.distribuidoras.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-1">
                    Nenhuma neste tier. (CPFL Piratininga não existe mais — não listar.)
                  </p>
                ) : (
                  <div className="space-y-2">
                    {r.distribuidoras.map((d, idx) => (
                      <div key={`${tier}-d-${idx}`} className="grid grid-cols-[4.5rem_1fr_1fr_auto] gap-1.5 items-center">
                        <Input
                          value={d.ufs.join(",")}
                          onChange={(e) =>
                            patchDist(tier, idx, {
                              ufs: e.target.value
                                .split(/[,;/|\s]+/)
                                .map((u) => u.trim().toUpperCase())
                                .filter(Boolean),
                            })
                          }
                          placeholder="UF"
                          className="h-8 text-xs"
                          title="UFs separadas por vírgula"
                        />
                        <Input
                          value={d.label}
                          onChange={(e) => patchDist(tier, idx, { label: e.target.value })}
                          placeholder="Nome exibido"
                          className="h-8 text-xs"
                        />
                        <Input
                          value={d.nomeApi}
                          onChange={(e) => patchDist(tier, idx, { nomeApi: e.target.value.toUpperCase() })}
                          placeholder="Nome API iGreen"
                          className="h-8 text-xs"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          title="Excluir distribuidora"
                          onClick={() =>
                            patchTier(tier, {
                              distribuidoras: r.distribuidoras.filter((_, i) => i !== idx),
                            })
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Faixas */}
              <div className="rounded-lg border border-border/60 bg-secondary/30 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-foreground">
                    Faixas (de X a Y pessoas → %)
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => patchTier(tier, { faixas: [...r.faixas, emptyFaixa()] })}
                  >
                    <Plus className="w-3 h-3" /> Nova faixa
                  </Button>
                </div>
                {r.faixas.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-1">Sem faixas neste tier.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="hidden sm:grid grid-cols-[4.5rem_4.5rem_4.5rem_4.5rem_1fr_auto] gap-1.5 text-[10px] text-muted-foreground px-0.5">
                      <span>De</span>
                      <span>Até</span>
                      <span>% agora</span>
                      <span>% inj.</span>
                      <span>Rótulo</span>
                      <span />
                    </div>
                    {r.faixas.map((f, idx) => (
                      <div
                        key={`${tier}-f-${idx}`}
                        className="grid grid-cols-2 sm:grid-cols-[4.5rem_4.5rem_4.5rem_4.5rem_1fr_auto] gap-1.5 items-center"
                      >
                        <Input
                          type="number"
                          min={0}
                          value={f.minPessoas}
                          onChange={(e) => patchFaixa(tier, idx, { minPessoas: Number(e.target.value || 0) })}
                          className="h-8 text-xs"
                          placeholder="De"
                        />
                        <Input
                          type="number"
                          min={0}
                          value={f.maxPessoas ?? ""}
                          onChange={(e) =>
                            patchFaixa(tier, idx, {
                              maxPessoas: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          className="h-8 text-xs"
                          placeholder="∞"
                          title="Vazio = sem teto (ex.: 200+)"
                        />
                        <Input
                          type="number"
                          min={0}
                          step="0.5"
                          value={f.imediatoPct}
                          onChange={(e) => patchFaixa(tier, idx, { imediatoPct: Number(e.target.value || 0) })}
                          className="h-8 text-xs"
                          placeholder="% agora"
                        />
                        <Input
                          type="number"
                          min={0}
                          step="0.5"
                          value={f.injecaoPct}
                          onChange={(e) => patchFaixa(tier, idx, { injecaoPct: Number(e.target.value || 0) })}
                          className="h-8 text-xs"
                          placeholder="% inj."
                        />
                        <Input
                          value={f.label}
                          onChange={(e) => patchFaixa(tier, idx, { label: e.target.value })}
                          className="h-8 text-xs col-span-2 sm:col-span-1"
                          placeholder="Rótulo"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          title="Excluir faixa"
                          onClick={() =>
                            patchTier(tier, { faixas: r.faixas.filter((_, i) => i !== idx) })
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Total da faixa = % agora + % na injeção. “Até” vazio = sem limite (ex.: 200+).
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar tabela
        </Button>
      </div>
    </Card>
  );
}
