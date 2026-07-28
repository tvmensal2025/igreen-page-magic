/**
 * StepBudget — Step 4: orçamento (3 presets visuais + slider) e placements.
 * Os placements ficam colapsados (Automático recomendado).
 */
import { useState } from "react";
import { Zap, Check, ChevronDown, Sparkles } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ALL_PLACEMENTS, PLACEMENT_GROUPS, ADS_MIN_DAILY_BUDGET_BRL } from "../wizardHelpers";
import type { WizardState } from "../hooks/useWizardState";
import { RodizioBlock } from "../RodizioBlock";

interface Props {
  /** Wizard aberto? Repassado ao RodizioBlock para carregar/limpar participantes. */
  open: boolean;
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  /** Atualização funcional do estado (usada pelo rodízio). */
  patchFn: (fn: (prev: WizardState) => Partial<WizardState>) => void;
}

const PRESETS = [
  { id: "cont", label: "Contínuo", budget: ADS_MIN_DAILY_BUDGET_BRL, days: 0, hint: "R$ 5,17/dia · mínimo Meta · sem data fim", icon: "♾️" },
  { id: "std", label: "7 dias", budget: 25, days: 7, hint: "R$ 175 total · teste com prazo", icon: "⭐" },
  { id: "custom", label: "Personalizado", budget: 0, days: -1, hint: "você define valor e prazo", icon: "🎛️" },
] as const;

/** Reexport do mínimo Meta (R$ 5,17). */
export { ADS_MIN_DAILY_BUDGET_BRL };

function formatBudgetBrl(v: number): string {
  return v.toLocaleString("pt-BR", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function StepBudget({ open, state, patch, patchFn }: Props) {
  const { budget, duration } = state;
  const isCont = Math.abs(budget - ADS_MIN_DAILY_BUDGET_BRL) < 0.001 && duration === 0;
  const isStd = budget === 25 && duration === 7;
  const isCustom = !isCont && !isStd;
  const [showPlacements, setShowPlacements] = useState(state.placementMode === "manual");

  // Estimativa baseada na faixa histórica recente (R$ 3–6 por conversa).
  // Não é promessa: o leilão, público e criativo alteram o CPL.
  const dailyLeads = `${Math.max(1, Math.floor(budget / 6))}–${Math.max(1, Math.floor(budget / 3))}`;
  const total = duration === 0
    ? `${formatBudgetBrl(budget * 30)}/mês est.`
    : formatBudgetBrl(budget * duration);

  function selectPreset(id: string) {
    if (id === "cont") patch({ budget: ADS_MIN_DAILY_BUDGET_BRL, duration: 0 });
    else if (id === "std") patch({ budget: 25, duration: 7 });
    else patch({ budget: Math.max(ADS_MIN_DAILY_BUDGET_BRL, budget || ADS_MIN_DAILY_BUDGET_BRL), duration: duration === 0 ? 0 : Math.max(0, duration) });
  }

  function onBudgetSlider(raw: number) {
    // 1º notch = mínimo Meta exato (5,17); depois sobe em reais inteiros.
    const next = raw <= ADS_MIN_DAILY_BUDGET_BRL + 0.5
      ? ADS_MIN_DAILY_BUDGET_BRL
      : Math.max(6, Math.round(raw));
    patch({ budget: next });
  }

  return (
    <div className="space-y-5">
      {/* 3 cards de preset */}
      <div>
        <Label className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald-2))]" /> Preset de orçamento</Label>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {PRESETS.map((p) => {
            const active = (p.id === "cont" && isCont) || (p.id === "std" && isStd) || (p.id === "custom" && isCustom);
            return (
              <button key={p.id} type="button" onClick={() => selectPreset(p.id)}
                className={`ads-select-card ${active ? "is-active" : ""}`}>
                <div className="text-lg">{p.icon}</div>
                <div className="font-semibold text-xs flex items-center gap-1 mt-1">
                  {active && <Check className="w-3 h-3 text-primary" />} {p.label}
                </div>
                <div className="text-[10px] text-[hsl(var(--ads-muted))] mt-0.5">{p.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Número grande de leads/dia */}
      <div className="rounded-xl border border-[hsl(var(--ads-border))] bg-primary/5 p-4 text-center">
        <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--ads-muted))]">Conversas estimadas no WhatsApp</div>
        <div className="text-4xl ads-num font-semibold my-1">{dailyLeads}<span className="text-sm font-normal text-[hsl(var(--ads-muted))]">/dia</span></div>
        <div className="text-[11px] text-[hsl(var(--ads-muted))]">A R$ {formatBudgetBrl(budget)}/dia × {duration === 0 ? "contínuo" : `${duration} dias`} = <strong className="text-foreground">R$ {total}</strong></div>
        <div className="text-[10px] text-[hsl(var(--ads-muted))] mt-1">Estimativa, não garantia. Criativo, público e leilão alteram o custo.</div>
      </div>

      {/* Sliders (sempre visíveis, mas destaque no personalizado) */}
      <div>
        <Label>Orçamento diário: <span className="text-[hsl(var(--ads-emerald-2))] font-bold">R$ {formatBudgetBrl(budget)}</span></Label>
        <Slider
          min={ADS_MIN_DAILY_BUDGET_BRL}
          max={500}
          step={1}
          value={[Math.max(ADS_MIN_DAILY_BUDGET_BRL, budget)]}
          onValueChange={(v) => onBudgetSlider(v[0])}
          className="mt-2"
        />
        <div className="flex justify-between text-xs text-[hsl(var(--ads-muted))] mt-1">
          <span>R$ {formatBudgetBrl(ADS_MIN_DAILY_BUDGET_BRL)} (mínimo Meta)</span>
          <span>R$ 500</span>
        </div>
      </div>
      <div>
        <Label>
          Duração:{" "}
          <span className="text-[hsl(var(--ads-emerald-2))] font-bold">
            {duration === 0 ? "Sem fim (fica ativo até pausar)" : `${duration} dias`}
          </span>
        </Label>
        <Slider min={0} max={30} step={1} value={[duration]} onValueChange={(v) => patch({ duration: v[0] })} className="mt-2" />
        <div className="flex justify-between text-xs text-[hsl(var(--ads-muted))] mt-1">
          <span>0 = contínuo</span>
          <span>30 dias</span>
        </div>
      </div>

      {/* Placements colapsados */}
      <div className="rounded-lg border border-[hsl(var(--ads-border))] overflow-hidden">
        <button type="button" onClick={() => setShowPlacements((s) => !s)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold">
          <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-[hsl(var(--ads-emerald-2))]" /> Onde publicar
            <span className="text-[10px] font-normal text-[hsl(var(--ads-muted))]">({state.placementMode === "auto" ? "Automático" : "Manual"})</span>
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showPlacements ? "rotate-180" : ""}`} />
        </button>
        {showPlacements && (
          <div className="px-3 pb-3 space-y-3 border-t border-[hsl(var(--ads-border))] pt-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => patch({ placementMode: "auto", placements: ALL_PLACEMENTS })}
                className={`ads-select-card ${state.placementMode === "auto" ? "is-active" : ""}`}>
                <div className="font-semibold text-xs flex items-center gap-1.5">{state.placementMode === "auto" && <Check className="w-3 h-3 text-[hsl(var(--ads-emerald-2))]" />} Automático</div>
                <div className="text-[10px] text-[hsl(var(--ads-muted))] mt-0.5">Advantage+ otimiza o custo por conversa. <strong className="text-[hsl(var(--ads-emerald-2))]">Recomendado.</strong></div>
              </button>
              <button type="button" onClick={() => patch({ placementMode: "manual" })}
                className={`ads-select-card ${state.placementMode === "manual" ? "is-active" : ""}`}>
                <div className="font-semibold text-xs flex items-center gap-1.5">{state.placementMode === "manual" && <Check className="w-3 h-3 text-[hsl(var(--ads-emerald-2))]" />} Manual</div>
                <div className="text-[10px] text-[hsl(var(--ads-muted))] mt-0.5">Você escolhe onde aparece.</div>
              </button>
            </div>
            {state.placementMode === "manual" && (
              <div className="space-y-2 pt-1">
                {PLACEMENT_GROUPS.map((group) => (
                  <div key={group.label}>
                    <div className="text-xs font-semibold text-[hsl(var(--ads-muted))] mb-1">{group.label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map(([key, label]) => {
                        const active = state.placements.includes(key);
                        return (
                          <button key={key} type="button"
                            onClick={() => patch({ placements: active ? state.placements.filter((p) => p !== key) : [...state.placements, key] })}
                            className={`px-2.5 py-1 rounded-full text-xs border transition ${active ? "bg-[hsl(var(--ads-emerald-2))] text-white border-[hsl(var(--ads-emerald-2))]" : "border-[hsl(var(--ads-border))]"}`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="text-[11px] text-warning pt-1">⚠ Audience Network e Messenger não suportam destino WhatsApp.</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rodízio de leads — logo abaixo de "Onde publicar" (mesmo padrão visual) */}
      <RodizioBlock open={open} state={state} patch={patch} patchFn={patchFn} />
    </div>
  );
}
