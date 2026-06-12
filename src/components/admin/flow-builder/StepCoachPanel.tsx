// StepCoachPanel — Consultor de Fluxo (Iris). Acompanha o consultor do
// "fluxo em branco" até "publicar com segurança".
//
// Camadas:
//   1) JourneyStepper      — roteiro de 6 etapas (Acolher → Publicar).
//   2) Saudação animada    — fala que muda a cada troca de passo.
//   3) Regras em fala viva — "Se o lead tocar em X, ele vai pra Y".
//   4) Diagnóstico vivo    — avisos do passo, com CTA "Corrigir agora".
//   5) Rodapé de ações     — Simular daqui · Próximo passo · Saúde do fluxo.
//
// Reuso (sem reinventar):
//   - flowExits.getStepExits       — fonte das saídas
//   - useFlowValidation            — fonte dos avisos
//   - journey/voice                — TODA frase pt-BR vem daqui
//   - journey/useFlowJourney       — derivação do roteiro
//   - FlowHealthDialog             — modal de saúde (já existe)

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GraduationCap,
  ArrowRight,
  MousePointerClick,
  MessageSquareText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wrench,
  Play,
  Stethoscope,
  Lightbulb,
} from "lucide-react";
import { Step, STEP_TYPE_OPTIONS } from "./flowTypes";
import { getStepExits } from "./flowExits";
import type { FlowValidation } from "./useFlowValidation";
import { falarRegra, falarDiagnostico, falarEtapa } from "./journey/voice";
import { useFlowJourney } from "./journey/useFlowJourney";
import JourneyStepper from "./journey/JourneyStepper";

interface Props {
  step: Step | null;
  steps: Step[];
  validation: FlowValidation;
  consultantId: string | null;
  variant: string;
  onJumpToStep?: (stepId: string) => void;
  onOpenInspector?: (stepId: string) => void;
  onSimulateFromHere?: (stepId: string) => void;
  onOpenHealth?: () => void;
}

function stepTypeLabel(type: string): string {
  return STEP_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export default function StepCoachPanel({
  step,
  steps,
  validation,
  consultantId,
  variant,
  onJumpToStep,
  onOpenInspector,
  onSimulateFromHere,
  onOpenHealth,
}: Props) {
  const journey = useFlowJourney(steps, validation, { consultantId, variant });

  // Lembra o passo anterior para gerar saudação contextual ("Boa, agora vamos pro #4…").
  // Importante: guardamos o anterior ANTES de atualizar o ref, para `falarEtapa`
  // receber o passo de origem da troca (e não o atual).
  const anteriorRef = useRef<Step | null>(null);
  const [anteriorSnap, setAnteriorSnap] = useState<Step | null>(null);
  const [transicao, setTransicao] = useState(false);
  useEffect(() => {
    if (step && anteriorRef.current?.id !== step.id) {
      setAnteriorSnap(anteriorRef.current);
      anteriorRef.current = step;
      setTransicao(true);
      const t = setTimeout(() => setTransicao(false), 280);
      return () => clearTimeout(t);
    }
  }, [step?.id, step]);

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            <span>Iris <span className="text-xs font-normal text-muted-foreground">· consultora de fluxo</span></span>
          </span>
          {step && (
            <Badge variant="outline" className="font-normal">
              Passo #{step.position}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* (1) Roteiro do fluxo — sempre visível, mesmo sem passo selecionado */}
        <JourneyStepper
          stages={journey.stages}
          focoId={journey.focoId}
          onFocus={(id) => {
            journey.setFoco(id);
            const stage = journey.stages.find((s) => s.id === id);
            const first = stage?.stepIds[0];
            if (first && onJumpToStep) onJumpToStep(first);
          }}
        />

        {!step ? (
          <div className="rounded-md border border-dashed border-primary/30 bg-background/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Clique num passo da lista pra eu te guiar.</p>
            <p className="mt-1">
              Eu explico o que cada botão faz, te aviso quando algo ficar solto, e sugiro o próximo
              passo a configurar.
            </p>
          </div>
        ) : (
          <>
            {/* (2) Saudação animada quando troca de passo */}
            <section
              className={`transition-all duration-300 ${
                transicao ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100"
              }`}
            >
              <p className="text-sm">{falarEtapa(step, anteriorSnap)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Tipo: {stepTypeLabel(step.step_type)}
              </p>
              {step.message_text && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/40 p-2 text-xs">
                  <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="line-clamp-3 text-muted-foreground">{step.message_text}</p>
                </div>
              )}
            </section>

            {/* (3) Regras em fala viva */}
            <RegrasSection
              step={step}
              steps={steps}
              onJumpToStep={onJumpToStep}
              onOpenInspector={onOpenInspector}
            />

            {/* (3.b) Como o lead CHEGA aqui — grafo invertido */}
            <EntradasSection
              step={step}
              steps={steps}
              onJumpToStep={onJumpToStep}
            />

            {/* (4) Diagnóstico vivo */}
            <DiagnosticoSection
              step={step}
              validation={validation}
              onOpenInspector={onOpenInspector}
            />
          </>
        )}

        {/* (5) Rodapé de ações — sempre acessível */}
        <div className="flex flex-wrap gap-1.5 border-t border-border/50 pt-3">
          {step && onSimulateFromHere && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-xs"
              onClick={() => onSimulateFromHere(step.id)}
            >
              <Play className="mr-1 h-3 w-3" /> Simular daqui
            </Button>
          )}
          {journey.proximaEtapa && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-xs"
              onClick={() => {
                journey.setFoco(journey.proximaEtapa!.id);
                const first = journey.proximaEtapa!.stepIds[0];
                if (first && onJumpToStep) onJumpToStep(first);
              }}
            >
              <ArrowRight className="mr-1 h-3 w-3" /> Próximo
            </Button>
          )}
          {onOpenHealth && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-xs"
              onClick={onOpenHealth}
            >
              <Stethoscope className="mr-1 h-3 w-3" /> Saúde
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

// Calcula quem aponta para este passo (grafo invertido). Reusa getStepExits
// para garantir que o "como chega" siga EXATAMENTE a mesma lógica do "para
// onde vai" — botões, palavras-chave e padrão.
function EntradasSection({
  step,
  steps,
  onJumpToStep,
}: {
  step: Step;
  steps: Step[];
  onJumpToStep?: (id: string) => void;
}) {
  const entradas = steps
    .filter((s) => s.id !== step.id && s.is_active)
    .flatMap((origem) =>
      getStepExits(origem, steps)
        .filter((exit) => exit.destStep?.id === step.id)
        .map((exit) => ({ origem, exit })),
    );

  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Como o lead chega aqui</p>
      {entradas.length === 0 ? (
        <div className="mt-1 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            {step.position === 1
              ? "Este é o ponto de partida — o lead começa por aqui."
              : "Ninguém aponta pra esse passo. Ele está solto no fluxo."}
          </span>
        </div>
      ) : (
        <ul className="mt-1 space-y-1">
          {entradas.map(({ origem, exit }, i) => (
            <li key={`${origem.id}:${exit.id}:${i}`} className="rounded-md border border-border/60 bg-background/50 p-2 text-xs">
              <button
                type="button"
                onClick={() => onJumpToStep?.(origem.id)}
                className="text-left hover:underline"
              >
                <span className="font-medium text-primary">#{origem.position} {origem.title}</span>
                <span className="text-muted-foreground">
                  {" "}— {exit.kind === "button"
                    ? `quando tocam em "${exit.label}"`
                    : exit.kind === "keyword"
                      ? `quando escrevem "${exit.label}"`
                      : "como caminho padrão"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

/* ─────────────────────────────────────────────────────────────────────── */

function RegrasSection({
  step,
  steps,
  onJumpToStep,
  onOpenInspector,
}: {
  step: Step;
  steps: Step[];
  onJumpToStep?: (id: string) => void;
  onOpenInspector?: (id: string) => void;
}) {
  const exits = getStepExits(step, steps);
  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Regras deste passo</p>
      <ul className="mt-2 space-y-1.5">
        {exits.map((exit) => {
          const broken = exit.missing;
          const TriggerIcon =
            exit.kind === "button" ? MousePointerClick :
            exit.kind === "keyword" ? MessageSquareText : Lightbulb;
          const canJump = !!exit.destStep && !!onJumpToStep;
          return (
            <li
              key={exit.id}
              className={`rounded-md border p-2 text-xs ${
                broken ? "border-destructive/30 bg-destructive/5" : "border-border/60 bg-background/50"
              }`}
            >
              <div className="flex items-start gap-1.5">
                <TriggerIcon className={`mt-0.5 h-3 w-3 shrink-0 ${broken ? "text-destructive" : "text-muted-foreground"}`} />
                <p className={broken ? "text-destructive" : "text-foreground"}>
                  {falarRegra(exit)}
                </p>
              </div>
              <div className="mt-1 flex gap-2">
                {canJump && (
                  <button
                    type="button"
                    onClick={() => onJumpToStep!(exit.destStep!.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    Ir até {exit.destLabel} <ArrowRight className="h-3 w-3" />
                  </button>
                )}
                {broken && onOpenInspector && (
                  <button
                    type="button"
                    onClick={() => onOpenInspector(step.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive hover:underline"
                  >
                    <Wrench className="h-3 w-3" /> Corrigir agora
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DiagnosticoSection({
  step,
  validation,
  onOpenInspector,
}: {
  step: Step;
  validation: FlowValidation;
  onOpenInspector?: (id: string) => void;
}) {
  const warnings = validation.byStep[step.id] ?? [];
  if (warnings.length === 0) {
    return (
      <section>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Como está este passo</p>
        <div className="mt-1 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          <span>Tudo certo aqui. Pode seguir.</span>
        </div>
      </section>
    );
  }
  const errors = warnings.filter((w) => w.level === "error");
  const warns = warnings.filter((w) => w.level !== "error");
  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Como está este passo</p>
      <ul className="mt-1 space-y-1.5">
        {errors.concat(warns).map((w) => {
          const isError = w.level === "error";
          const voz = falarDiagnostico(w);
          const Icon = isError ? XCircle : AlertTriangle;
          return (
            <li
              key={w.id}
              className={`rounded-md border p-2 text-xs ${
                isError ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30 bg-amber-500/5"
              }`}
            >
              <div className="flex items-start gap-1.5">
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isError ? "text-destructive" : "text-amber-600"}`} />
                <div className="flex-1">
                  <p className="font-medium">{voz.titulo}</p>
                  <p className="mt-0.5 text-muted-foreground">{voz.detalhe}</p>
                  {voz.cta && onOpenInspector && (
                    <button
                      type="button"
                      onClick={() => onOpenInspector(step.id)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      <Wrench className="h-3 w-3" /> {voz.cta}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
