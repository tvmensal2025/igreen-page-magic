// StepCoachPanel — "consultor virtual" que acompanha quem está montando o fluxo.
//
// Objetivo (pedido do usuário):
//   "Quero um sistema guiado para quando for criar um fluxo, esteja um
//    profissional ali guiando 100%, do início ao fim, orientando: se apertar
//    tal botão o que vai acontecer, o passo atual + ação = resultado."
//
// O que ele faz:
//   1. Mostra QUAL é o passo atual selecionado (#N, título, tipo).
//   2. Narra TODAS as saídas em linguagem "Se X → então Y" usando
//      `getStepExits` (mesma fonte de verdade do runtime — sem duplicar lógica).
//   3. Mostra problemas DESTE passo vindos de `useFlowValidation`
//      (mesma fonte do FlowHealthDialog — sem duplicar lógica).
//   4. Orienta o próximo passo a configurar.
//
// Reuso (sem reinventar):
//   - `flowExits.getStepExits`     → regras "se apertar tal botão, vai pra Y"
//   - `useFlowValidation`          → problemas/avisos do passo
//   - `flowTypes`                  → tipos/botões/transitions
//
// Onde aparece: coluna direita do `FluxoBuilder`, acima do `WhatsAppPreview`.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GraduationCap,
  ArrowRight,
  MousePointerClick,
  MessageSquareText,
  Repeat,
  Flag,
  UserRound,
  Bot,
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lightbulb,
} from "lucide-react";
import { Step, getButtons, STEP_TYPE_OPTIONS } from "./flowTypes";
import { getStepExits, type StepExit, type ExitDestKind } from "./flowExits";
import type { FlowValidation, FlowWarning } from "./useFlowValidation";

interface Props {
  step: Step | null;
  steps: Step[];
  validation: FlowValidation;
  /** Pula para outro passo (clicar num destino no painel). */
  onJumpToStep?: (stepId: string) => void;
}

// Ícone amigável por tipo de destino — combina com a narração.
const DEST_ICON: Record<ExitDestKind, React.ComponentType<{ className?: string }>> = {
  step: ArrowRight,
  inactive: AlertTriangle,
  missing: XCircle,
  none: XCircle,
  order: ArrowRight,
  end: Flag,
  humano: UserRound,
  cadastro: ClipboardList,
  repeat: Repeat,
  ai: Bot,
};

// Rótulo humano por tipo de gatilho.
const TRIGGER_LABEL: Record<StepExit["kind"], string> = {
  button: "Se o lead apertar o botão",
  keyword: "Se o lead escrever",
  default: "Se nada acima casar (caminho padrão)",
};

// Tradução curta dos tipos de problema para a "voz do consultor".
const WARN_TITLE: Record<FlowWarning["kind"], string> = {
  empty_message: "Mensagem em branco",
  unresolved_var: "Variável que ainda não existe",
  var_before_capture: "Usando dado antes de pedir",
  goto_no_wait: "Pergunta sem esperar resposta",
  media_missing: "Mídia não anexada",
  flow_no_ending: "Fluxo sem final claro",
  too_many_buttons: "Botões demais",
  button_no_rule: "Botão sem destino",
  transition_no_dest: "Regra sem destino",
  transition_dest_missing: "Destino apagado",
  transition_dest_inactive: "Destino desligado",
  orphan_step: "Passo isolado",
  loop_detected: "Passo em loop",
  ocr_without_confirm: "Foto sem confirmação",
  ai_no_buttons: "IA sem botões de saída",
  ai_no_humano_exit: "IA sem saída humano",
  conversion_step_no_cta: "Conversão sem CTA",
};

function stepTypeLabel(type: string): string {
  return STEP_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

export default function StepCoachPanel({ step, steps, validation, onJumpToStep }: Props) {
  // Estado: nada selecionado — instrução de onboarding.
  if (!step) {
    return (
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="h-5 w-5 text-primary" />
            Consultor do fluxo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Oi! Eu te acompanho enquanto você monta o atendimento. Clique em
            qualquer passo da lista ao lado e eu explico, em português claro:
          </p>
          <ul className="space-y-1.5 pl-4 text-xs">
            <li>• O que esse passo faz</li>
            <li>• Para onde cada botão e palavra leva</li>
            <li>• Qual o próximo passo</li>
            <li>• O que ainda precisa ser ajustado</li>
          </ul>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/20 bg-background/60 p-2.5 text-xs">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Dica: comece pelo passo #1 (boas-vindas) e siga a sequência. Eu vou
              avisando se algo ficar solto pelo caminho.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const exits = getStepExits(step, steps);
  const buttons = getButtons(step);
  const warnings = validation.byStep[step.id] ?? [];
  const errors = warnings.filter((w) => w.level === "error");
  const warns = warnings.filter((w) => w.level === "warn");

  // Próximo passo "natural" (padrão) — primeiro destino com passo concreto.
  const defaultExit = exits.find((e) => e.kind === "default");

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            Consultor do fluxo
          </span>
          <Badge variant="outline" className="font-normal">
            Passo #{step.position}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* (1) Voz do consultor: o que é este passo */}
        <section>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Você está editando
          </p>
          <p className="mt-1 text-sm font-semibold">{step.title}</p>
          <p className="text-xs text-muted-foreground">
            Tipo: {stepTypeLabel(step.step_type)}
          </p>
          {step.message_text && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/40 p-2 text-xs">
              <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="line-clamp-3 text-muted-foreground">{step.message_text}</p>
            </div>
          )}
        </section>

        {/* (2) Regras: passo atual + ação = resultado */}
        <section>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Regras deste passo
          </p>
          <p className="text-xs text-muted-foreground">
            {buttons.length > 0
              ? `${buttons.length} botão(ões) configurado(s). Veja para onde cada um leva:`
              : "Sem botões — o lead responde escrevendo. Veja como o fluxo decide:"}
          </p>
          <ul className="mt-2 space-y-1.5">
            {exits.map((exit) => {
              const Icon = DEST_ICON[exit.destKind];
              const TriggerIcon = exit.kind === "button" ? MousePointerClick : MessageSquareText;
              const broken = exit.missing;
              const canJump = !!exit.destStep && !!onJumpToStep;
              return (
                <li
                  key={exit.id}
                  className={`rounded-md border p-2 text-xs ${
                    broken
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border/60 bg-background/50"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <TriggerIcon className="h-3 w-3" />
                    <span>{TRIGGER_LABEL[exit.kind]}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="font-medium">"{exit.label}"</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    {canJump ? (
                      <button
                        type="button"
                        onClick={() => onJumpToStep!(exit.destStep!.id)}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        <Icon className="h-3 w-3" />
                        {exit.destLabel}
                      </button>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          broken ? "text-destructive" : ""
                        }`}
                      >
                        <Icon className="h-3 w-3" />
                        {exit.destLabel}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* (3) Próximo passo natural — orientação "para onde ir agora" */}
        {defaultExit && defaultExit.destStep && onJumpToStep && (
          <section className="rounded-md border border-primary/20 bg-background/60 p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Lightbulb className="h-3.5 w-3.5 text-primary" />
              Próxima parada sugerida
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              O caminho padrão segue para <strong>{defaultExit.destLabel}</strong>. Quer
              revisar e configurar?
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-7 text-xs"
              onClick={() => onJumpToStep(defaultExit.destStep!.id)}
            >
              Ir para o próximo passo
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </section>
        )}

        {/* (4) Diagnóstico — problemas só deste passo */}
        <section>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Como está este passo
          </p>
          {warnings.length === 0 ? (
            <div className="mt-1 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>Tudo certo aqui. Pode seguir.</span>
            </div>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {errors.concat(warns).map((w) => {
                const isError = w.level === "error";
                const Icon = isError ? XCircle : AlertTriangle;
                return (
                  <li
                    key={w.id}
                    className={`rounded-md border p-2 text-xs ${
                      isError
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-warning/30 bg-warning/5"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      <Icon
                        className={`h-3.5 w-3.5 ${
                          isError ? "text-destructive" : "text-warning"
                        }`}
                      />
                      {WARN_TITLE[w.kind] ?? "Atenção"}
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{w.message}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
