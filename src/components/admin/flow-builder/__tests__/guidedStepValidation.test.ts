// Teste de integração: o passo montado pela Iris (`buildGuidedStepSeed`) entra
// LIMPO no fluxo, sem disparar os avisos que a auditoria cobrou.
//
// POR QUE ESTE TESTE EXISTE
// -------------------------
// `buildGuidedStepSeed.test.ts` já trava o FORMATO do seed (transitions,
// captures, paridade com o setButtonGoto) e o casamento no runtime
// (matchTransition). Falta o elo do MEIO: provar que, depois de virar um Step
// de verdade dentro de um fluxo, o `useFlowValidation` NÃO acusa:
//   • `button_no_rule`     — botão sem regra de destino;
//   • `transition_no_dest` — transition sem goto.
// Esses dois avisos eram exatamente os Problemas 1 e 3 da auditoria. Travá-los
// aqui garante que uma regressão no builder reapareça como teste vermelho.

import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { buildGuidedStepSeed, type GuidedStepInput } from "../GuidedStepDialog";
import { useFlowValidation } from "../useFlowValidation";
import type { Step } from "../flowTypes";

/** Atalho para a entrada do builder com defaults sensatos. */
function input(overrides: Partial<GuidedStepInput> = {}): GuidedStepInput {
  return {
    stepType: "message",
    titulo: "",
    mensagem: "",
    botoes: [],
    ...overrides,
  };
}

/**
 * Converte o `Partial<Step>` do seed num `Step` completo, simulando o que o
 * banco devolve depois do insert (id, flow_id, position fixados).
 */
function seedToStep(
  seed: Partial<Step>,
  over: { id: string; position: number },
): Step {
  return {
    flow_id: "flow-1",
    step_key: null,
    summary: null,
    text_delay_ms: null,
    slot_key: null,
    is_active: true,
    title: "Passo",
    message_text: "",
    icon: "msg",
    step_type: "message",
    transitions: [],
    captures: [],
    fallback: { mode: "repeat" },
    ...seed,
    ...over,
  } as Step;
}

function validate(steps: Step[]) {
  return renderHook(() => useFlowValidation(steps)).result.current;
}

describe("Iris construtora → useFlowValidation (sem avisos de destino)", () => {
  it("passo com botões (cadastro + humano) não gera button_no_rule nem transition_no_dest", () => {
    const seed = buildGuidedStepSeed(
      input({
        titulo: "Oferta",
        mensagem: "Quer simular sua economia?",
        botoes: [
          { id: "cadastrar", title: "📝 Cadastrar agora", dest: "special:cadastro" },
          { id: "humano", title: "👤 Falar com humano", dest: "special:humano" },
        ],
      }),
    );
    const novo = seedToStep(seed, { id: "novo", position: 1 });
    const { byStep } = validate([novo]);
    const kinds = (byStep["novo"] ?? []).map((w) => w.kind);
    expect(kinds).not.toContain("button_no_rule");
    expect(kinds).not.toContain("transition_no_dest");
  });

  it("botão apontando para um passo existente também entra sem avisos de destino", () => {
    // Fluxo já tem um passo de captura (posição 2). A Iris cria um passo de
    // mensagem (posição 1) cujo botão vai PARA esse passo existente.
    const captura = seedToStep(
      { step_type: "capture_conta", title: "Pedir conta", message_text: "Manda a conta" },
      { id: "captura", position: 2 },
    );
    const seed = buildGuidedStepSeed(
      input({
        titulo: "Início",
        mensagem: "Vamos começar?",
        botoes: [{ id: "simular", title: "📸 Quero simular", dest: "step:captura" }],
      }),
    );
    const inicio = seedToStep(seed, { id: "inicio", position: 1 });
    const { byStep } = validate([inicio, captura]);
    const kinds = (byStep["inicio"] ?? []).map((w) => w.kind);
    expect(kinds).not.toContain("button_no_rule");
    expect(kinds).not.toContain("transition_no_dest");
    expect(kinds).not.toContain("transition_dest_missing");
  });

  it("passo de mensagem sem botões não gera avisos de destino (mensagem preenchida)", () => {
    const seed = buildGuidedStepSeed(
      input({ titulo: "Aviso", mensagem: "Texto qualquer." }),
    );
    const novo = seedToStep(seed, { id: "novo", position: 1 });
    const { byStep } = validate([novo]);
    const kinds = (byStep["novo"] ?? []).map((w) => w.kind);
    expect(kinds).not.toContain("button_no_rule");
    expect(kinds).not.toContain("transition_no_dest");
    expect(kinds).not.toContain("empty_message");
  });

  it("passo de captura ignora botões e não gera transition órfã", () => {
    const seed = buildGuidedStepSeed(
      input({
        stepType: "capture_conta",
        titulo: "Conta",
        mensagem: "Manda a foto da conta",
        // Mesmo passando botões, captura ignora — não deve sobrar transition.
        botoes: [{ id: "x", title: "X", dest: "special:cadastro" }],
      }),
    );
    const novo = seedToStep(seed, { id: "novo", position: 1 });
    const { byStep } = validate([novo]);
    const kinds = (byStep["novo"] ?? []).map((w) => w.kind);
    expect(kinds).not.toContain("transition_no_dest");
    expect(kinds).not.toContain("button_no_rule");
  });
});
