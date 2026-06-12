/**
 * WizardSidebar — Sidebar esquerda do Modelo A.
 * Mostra os 5 steps com estado (done/active/pending) + saldo da carteira.
 */
import { Check, MapPin, Image, Type, DollarSign, Rocket, Loader2 } from "lucide-react";
import type { WizardStep } from "./hooks/useWizardState";

interface Props {
  currentStep: WizardStep;
  onStepClick: (step: WizardStep) => void;
  completedSteps: Set<number>;
  walletBalance: number | null; // centavos ou null (carregando)
}

const STEPS: { id: WizardStep; label: string; icon: any }[] = [
  { id: 1, label: "Região", icon: MapPin },
  { id: 2, label: "Criativo", icon: Image },
  { id: 3, label: "Texto & Mensagem", icon: Type },
  { id: 4, label: "Orçamento", icon: DollarSign },
  { id: 5, label: "Revisar & Publicar", icon: Rocket },
];

export function WizardSidebar({ currentStep, onStepClick, completedSteps, walletBalance }: Props) {
  return (
    <aside className="w-[220px] shrink-0 bg-[hsl(var(--ads-surface)/.6)] border-r border-[hsl(var(--ads-border))] p-4 flex flex-col gap-1 hidden lg:flex">
      {STEPS.map((s) => {
        const done = completedSteps.has(s.id);
        const active = currentStep === s.id;
        const canClick = done || s.id <= currentStep;
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => canClick && onStepClick(s.id)}
            disabled={!canClick}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-all
              ${active ? "bg-primary/12 border border-primary/30 text-[hsl(var(--ads-emerald-2))]" : ""}
              ${done && !active ? "text-[hsl(var(--ads-emerald-2))]/70 hover:bg-[hsl(var(--ads-surface))]" : ""}
              ${!done && !active ? "text-[hsl(var(--ads-muted))] cursor-not-allowed" : ""}
            `}
          >
            <div className={`
              w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0
              ${done ? "bg-[hsl(var(--ads-emerald))] text-white" : ""}
              ${active ? "bg-[hsl(var(--ads-emerald))] text-white" : ""}
              ${!done && !active ? "bg-[hsl(var(--ads-border))] text-[hsl(var(--ads-muted))]" : ""}
            `}>
              {done ? <Check className="w-3.5 h-3.5" /> : s.id}
            </div>
            <span className="font-medium truncate">{s.label}</span>
          </button>
        );
      })}

      {/* Saldo da carteira */}
      <div className="mt-auto pt-4 border-t border-[hsl(var(--ads-border))]">
        <div className="rounded-lg bg-[hsl(var(--ads-surface))] border border-[hsl(var(--ads-border))] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--ads-muted))] mb-1">
            Saldo carteira
          </div>
          {walletBalance === null ? (
            <Loader2 className="w-4 h-4 animate-spin text-[hsl(var(--ads-muted))]" />
          ) : (
            <div className={`text-lg font-bold ${walletBalance > 0 ? "text-[hsl(var(--ads-emerald-2))]" : "text-destructive"}`}>
              R$ {(walletBalance / 100).toFixed(2)}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
