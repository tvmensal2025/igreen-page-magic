// JourneyStepper — cabeçalho horizontal com as 6 etapas do roteiro.
// Mostra status (feito/em andamento/pendente), permite focar uma etapa
// e exibe a próxima ação. Renderizado dentro do StepCoachPanel.

import { Check, Circle, Loader2 } from "lucide-react";
import type { JourneyStage, JourneyStageId } from "./useFlowJourney";

interface Props {
  stages: JourneyStage[];
  focoId: JourneyStageId;
  onFocus: (id: JourneyStageId) => void;
}

export default function JourneyStepper({ stages, focoId, onFocus }: Props) {
  const focado = stages.find((s) => s.id === focoId) ?? stages[0];
  const indiceFoco = stages.findIndex((s) => s.id === focoId);

  return (
    <div className="space-y-2">
      <ol className="flex items-center gap-1">
        {stages.map((stage, i) => {
          const ativo = stage.id === focoId;
          const Icon = stage.status === "feito"
            ? Check
            : stage.status === "em_andamento"
              ? Loader2
              : Circle;
          return (
            <li key={stage.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onFocus(stage.id)}
                title={stage.titulo}
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] transition-all ${
                  ativo
                    ? "border-primary bg-primary text-primary-foreground scale-110"
                    : stage.status === "feito"
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                      : stage.status === "em_andamento"
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-600"
                        : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                <Icon className={`h-3 w-3 ${stage.status === "em_andamento" ? "animate-spin" : ""}`} />
              </button>
              {i < stages.length - 1 && (
                <span
                  className={`h-px w-3 ${
                    i < indiceFoco ? "bg-primary/60" : "bg-border"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="rounded-md border border-primary/20 bg-background/60 p-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Etapa {stages.indexOf(focado) + 1} de {stages.length} · {focado.titulo}
        </p>
        <p className="mt-0.5 text-xs">{focado.resumo}</p>
        <p className="mt-1 text-[11px] text-primary">→ {focado.proximaAcao}</p>
      </div>
    </div>
  );
}
