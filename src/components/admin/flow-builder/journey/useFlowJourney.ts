// useFlowJourney — deriva 6 etapas de maturidade do fluxo a partir dos
// próprios passos + validação. Sem nova tabela, sem backend.
//
// As etapas são uma "narrativa" que o Consultor segue: Acolher → Qualificar
// → Confirmar → Encaminhar → Cobrir desvios → Publicar. Cada uma diz se
// está pronta, em andamento ou pendente, e dá a PRÓXIMA AÇÃO concreta.
//
// Persistência: localStorage só guarda em qual etapa o consultor estava
// "focado" da última vez, para reabrir o painel já no contexto certo.

import { useEffect, useMemo, useState } from "react";
import { Step, getButtons } from "../flowTypes";
import type { FlowValidation } from "../useFlowValidation";

export type JourneyStageId =
  | "acolher"
  | "qualificar"
  | "confirmar"
  | "encaminhar"
  | "cobrir"
  | "publicar";

export type JourneyStageStatus = "feito" | "em_andamento" | "pendente";

export type JourneyStage = {
  id: JourneyStageId;
  titulo: string;
  resumo: string;
  status: JourneyStageStatus;
  /** Passos do fluxo que cumprem esta etapa. */
  stepIds: string[];
  /** Próxima ação concreta para o consultor avançar. */
  proximaAcao: string;
};

const STORAGE_PREFIX = "flow-journey";

function key(consultantId: string | null, variant: string): string {
  return `${STORAGE_PREFIX}:${consultantId ?? "anon"}:${variant}`;
}

export function useFlowJourney(
  steps: Step[],
  validation: FlowValidation,
  opts: { consultantId: string | null; variant: string },
): {
  stages: JourneyStage[];
  focoId: JourneyStageId;
  setFoco: (id: JourneyStageId) => void;
  proximaEtapa: JourneyStage | null;
} {
  const stages = useMemo<JourneyStage[]>(() => {
    const ativos = steps.filter((s) => s.is_active);

    // (1) Acolher — passo de mensagem com texto, posição inicial.
    const acolherStep = ativos.find(
      (s) => s.step_type === "message" && (s.message_text ?? "").trim().length > 0,
    );
    const acolher: JourneyStage = {
      id: "acolher",
      titulo: "Acolher",
      resumo: "Primeira mensagem que recebe o lead com calor humano.",
      status: acolherStep ? "feito" : "pendente",
      stepIds: acolherStep ? [acolherStep.id] : [],
      proximaAcao: acolherStep
        ? "Pronto. Releia o tom — soa como você?"
        : "Adicione o primeiro passo de mensagem com a saudação.",
    };

    // (2) Qualificar — algum passo de captura.
    const qualificarSteps = ativos.filter((s) => (s.step_type ?? "").startsWith("capture_"));
    const qualificar: JourneyStage = {
      id: "qualificar",
      titulo: "Qualificar",
      resumo: "Pedir o que importa: conta de luz, documento, e-mail.",
      status: qualificarSteps.length > 0 ? "feito" : "pendente",
      stepIds: qualificarSteps.map((s) => s.id),
      proximaAcao: qualificarSteps.length > 0
        ? "Confira a ordem em que as informações são pedidas."
        : "Adicione pelo menos um passo de captura (conta, documento ou e-mail).",
    };

    // (3) Confirmar — toda captura tem confirmação (sem warning ocr_without_confirm).
    const ocrPendente = validation.warnings.some((w) => w.kind === "ocr_without_confirm");
    const confirmar: JourneyStage = {
      id: "confirmar",
      titulo: "Confirmar dados",
      resumo: "Mostrar pro lead o que foi lido e pedir que confirme.",
      status: qualificarSteps.length === 0
        ? "pendente"
        : ocrPendente ? "em_andamento" : "feito",
      stepIds: qualificarSteps.map((s) => s.id),
      proximaAcao: ocrPendente
        ? "Adicione um passo de confirmação logo depois do OCR."
        : qualificarSteps.length === 0
          ? "Primeiro adicione uma captura na etapa anterior."
          : "Confirmação coberta.",
    };

    // (4) Encaminhar — finalizar_cadastro ou saída humano.
    const finaliza = ativos.some(
      (s) => s.step_type === "finalizar_cadastro" ||
        s.transitions.some((t) => t.goto_special === "humano"),
    );
    const encaminhar: JourneyStage = {
      id: "encaminhar",
      titulo: "Encaminhar",
      resumo: "Fechar o ciclo: cadastrar ou passar para um humano.",
      status: finaliza ? "feito" : "pendente",
      stepIds: ativos
        .filter((s) => s.step_type === "finalizar_cadastro")
        .map((s) => s.id),
      proximaAcao: finaliza
        ? "Saída coberta — o lead tem para onde ir."
        : "Adicione um passo 'Finalizar cadastro' ou uma saída para humano.",
    };

    // (5) Cobrir desvios — passos com botão sem regra ou regra sem destino.
    const desvios = validation.warnings.filter((w) =>
      ["button_no_rule", "transition_no_dest", "transition_dest_missing", "ai_no_humano_exit"].includes(w.kind),
    );
    const cobrir: JourneyStage = {
      id: "cobrir",
      titulo: "Cobrir desvios",
      resumo: "Garantir que todo botão e regra tenha um caminho válido.",
      status: desvios.length === 0 ? "feito" : "em_andamento",
      stepIds: Array.from(new Set(desvios.map((d) => d.stepId))),
      proximaAcao: desvios.length === 0
        ? "Todos os caminhos têm destino — beleza."
        : `Resolva ${desvios.length} caminho(s) sem destino.`,
    };

    // (6) Publicar — zero erros.
    const publicar: JourneyStage = {
      id: "publicar",
      titulo: "Publicar",
      resumo: "Validação geral antes de soltar o fluxo no WhatsApp.",
      status: validation.errors === 0 && ativos.length >= 2 ? "feito" : "pendente",
      stepIds: [],
      proximaAcao: validation.errors > 0
        ? `Corrija os ${validation.errors} erro(s) bloqueantes antes de publicar.`
        : ativos.length < 2
          ? "O fluxo ainda é muito curto — adicione mais passos."
          : "Tudo pronto. Pode publicar.",
    };

    return [acolher, qualificar, confirmar, encaminhar, cobrir, publicar];
  }, [steps, validation]);

  const proximaEtapa = useMemo(
    () => stages.find((s) => s.status !== "feito") ?? null,
    [stages],
  );

  const [focoId, setFocoState] = useState<JourneyStageId>(() => {
    if (typeof window === "undefined") return "acolher";
    const saved = window.localStorage.getItem(key(opts.consultantId, opts.variant));
    if (saved && stages.some((s) => s.id === saved)) return saved as JourneyStageId;
    return proximaEtapa?.id ?? "publicar";
  });

  const setFoco = (id: JourneyStageId) => {
    setFocoState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key(opts.consultantId, opts.variant), id);
    }
  };

  // Se o foco anterior já está "feito" e existe próxima, avança suavemente.
  useEffect(() => {
    const cur = stages.find((s) => s.id === focoId);
    if (cur?.status === "feito" && proximaEtapa && proximaEtapa.id !== focoId) {
      setFocoState(proximaEtapa.id);
    }
  }, [stages, focoId, proximaEtapa]);

  return { stages, focoId, setFoco, proximaEtapa };
}
