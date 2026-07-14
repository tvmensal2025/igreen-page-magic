/**
 * StepBudget — Step 4: orçamento (3 presets visuais + slider) e placements.
 * Os placements ficam colapsados (Automático recomendado).
 */
import { useState } from "react";
import { Zap, Check, ChevronDown, Sparkles } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ALL_PLACEMENTS, PLACEMENT_GROUPS } from "../wizardHelpers";
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
  { id: "eco", label: "Teste inicial", budget: 15, days: 7, hint: "R$ 105 total · dá tempo para aprender", icon: "🌱" },
  { id: "std", label: "Recomendado", budget: 25, days: 7, hint: "R$ 175 total · mais dados para otimizar", icon: "⭐" },
  { id: "custom", label: "Personalizado", budget: 0, days: 0, hint: "você define valor e prazo", icon: "🎛️" },
] as const;

export function StepBudget({ open, state, patch, patchFn }: Props) {
  const { budget, duration } = state;
  const isEco = budget === 15 && duration === 7;
  const isStd = budget === 25 && duration === 7;
  const isCustom = !isEco && !isStd;
  const [showPlacements, setShowPlacements] = useState(state.placementMode === "manual");

  // Estimativa baseada na faixa histórica recente (R$ 3–6 por conversa).
  // Não é promessa: o leilão, público e criativo alteram o CPL.
  const dailyLeads = `${Math.max(1, Math.floor(budget / 6))}–${Math.max(1, Math.floor(budget / 3))}`;
  const total = duration === 0 ? `${budget * 30}/mês est.` : `${budget * duration}`;

  function selectPreset(id: string) {
    if (id === "eco") patch({ budget: 15, duration: 7 });
    else if (id === "std") patch({ budget: 25, duration: 7 });
    else patch({ budget: Math.max(15, budget), duration: Math.max(7, duration) });
  }

  return (
    <div className="space-y-5">
      {/* 3 cards de preset */}
      <div>
        <Label className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-[hsl(var(--ads-emerald-2))]" /> Preset de orçamento</Label>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {PRESETS.map((p) => {
            const active = (p.id === "eco" && isEco) || (p.id === "std" && isStd) || (p.id === "custom" && isCustom);
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
        <div className="text-[11px] text-[hsl(var(--ads-muted))]">A R$ {budget}/dia × {duration === 0 ? "contínuo" : `${duration} dias`} = <strong className="text-foreground">R$ {total}</strong></div>
        <div className="text-[10px] text-[hsl(var(--ads-muted))] mt-1">Estimativa, não garantia. Criativo, público e leilão alteram o custo.</div>
      </div>

      {/* Sliders (sempre visíveis, mas destaque no personalizado) */}
      <div>
        <Label>Orçamento diário: <span className="text-[hsl(var(--ads-emerald-2))] font-bold">R$ {budget}</span></Label>
        <Slider min={10} max={500} step={5} value={[budget]} onValueChange={(v) => patch({ budget: v[0] })} className="mt-2" />
        <div className="flex justify-between text-xs text-[hsl(var(--ads-muted))] mt-1"><span>R$ 10</span><span>R$ 500</span></div>
      </div>
      <div>
        <Label>Duração: <span className="text-[hsl(var(--ads-emerald-2))] font-bold">{duration === 0 ? "Sem fim (até pausar)" : `${duration} dias`}</span></Label>
        <Slider min={0} max={30} step={1} value={[duration]} onValueChange={(v) => patch({ duration: v[0] })} className="mt-2" />
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
                <div className="text-[10px] text-[hsl(var(--ads-muted))] mt-0.5">Advantage+ otimiza CPL. <strong className="text-[hsl(var(--ads-emerald-2))]">Recomendado.</strong></div>
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
