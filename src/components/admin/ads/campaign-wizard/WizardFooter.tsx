/**
 * WizardFooter — Barra inferior fixa com navegação (voltar/próximo/publicar).
 */
import { ChevronLeft, ChevronRight, Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={submitting}
          className="text-[hsl(var(--ads-muted))] hover:text-[hsl(var(--ads-emerald-2))]"
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
      ) : (
        <div />
      )}

      {/* Indicador de step */}
      <div className="text-[11px] text-[hsl(var(--ads-muted))] hidden sm:block">
        Passo {step} de 5
      </div>

      {/* Próximo / Publicar */}
      {isLast ? (
        <Button
          type="button"
          onClick={onNext}
          disabled={submitting || !canAdvance}
          className="bg-[hsl(var(--ads-emerald))] text-white font-bold px-6 hover:bg-[hsl(var(--ads-emerald-2))] disabled:opacity-40"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
          {submitting ? "Publicando..." : "Publicar campanha"}
        </Button>
      ) : (
        <Button
          type="button"
          onClick={onNext}
          disabled={!canAdvance}
          className="bg-[hsl(var(--ads-emerald))] text-white font-semibold px-5 hover:bg-[hsl(var(--ads-emerald-2))] disabled:opacity-40"
        >
          Próximo <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      )}
    </footer>
  );
}
