/**
 * WizardFooter — Barra inferior fixa com navegação (voltar/próximo/publicar).
 */
import { ChevronLeft, ChevronRight, Loader2, Rocket } from "lucide-react";
import { AdsButton } from "../AdsButton";
import type { WizardStep } from "./hooks/useWizardState";

interface Props {
  step: WizardStep;
  onBack: () => void;
  onNext: () => void;
  submitting: boolean;
  canAdvance: boolean;
}

export function WizardFooter({ step, onBack, onNext, submitting, canAdvance }: Props) {
  const isFirst = step === 1;
  const isLast = step === 5;

  return (
    <footer className="shrink-0 border-t border-[hsl(var(--ads-border))] bg-[hsl(var(--ads-surface)/.8)] backdrop-blur-sm px-6 py-3 flex items-center justify-between">
      {/* Voltar */}
      {!isFirst ? (
        <AdsButton type="button" variant="ghost" size="md" onClick={onBack} disabled={submitting}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Voltar
        </AdsButton>
      ) : (
        <div />
      )}

      {/* Indicador de step */}
      <div className="text-[11px] text-[hsl(var(--ads-muted))] hidden sm:block">
        Passo {step} de 5
      </div>

      {/* Próximo / Publicar */}
      {isLast ? (
        <AdsButton type="button" variant="primary" size="md" onClick={onNext} disabled={submitting || !canAdvance} className="px-6 font-bold">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
          {submitting ? "Publicando..." : "Publicar campanha"}
        </AdsButton>
      ) : (
        <AdsButton type="button" variant="primary" size="md" onClick={onNext} disabled={!canAdvance} className="px-5 font-semibold">
          Próximo <ChevronRight className="w-4 h-4 ml-1" />
        </AdsButton>
      )}
    </footer>
  );
}
