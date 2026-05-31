// Feature: evolution-multiconsultor-pronto
//
// Testes de EXEMPLO (não-propriedade) para a detecção da etapa de abertura
// e a não-regressão da resolução de fluxo — Tarefa 2.3.
//
// Cobre:
//   1. Critério 3.3 — fluxo resolvido com steps → opening step = primeiro
//      step ativo ordenado por `position` ascendente.
//   2. Não-regressão — consultor com exatamente 1 fluxo ativo na variante do
//      cliente resolve esse fluxo normalmente.
//
// _Requirements: 3.3_

import { describe, it, expect } from "vitest";

import {
  detectOpeningStep,
  selectActiveFlow,
  type FlowRow,
  type FlowStepRow,
} from "./openingStep";

describe("detectOpeningStep — etapa de abertura por position (Critério 3.3)", () => {
  it("retorna o primeiro step ATIVO ordenado por position ascendente", () => {
    // Steps fora de ordem de propósito, para provar a ordenação por position.
    const steps: FlowStepRow[] = [
      { id: "s2", position: 2, is_active: true, step_key: "pergunta_conta" },
      { id: "s0", position: 0, is_active: true, step_key: "abertura" },
      { id: "s1", position: 1, is_active: true, step_key: "nome_cliente" },
    ];

    const opening = detectOpeningStep(steps);

    expect(opening).not.toBeNull();
    expect(opening?.id).toBe("s0");
    expect(opening?.position).toBe(0);
    expect(opening?.step_key).toBe("abertura");
  });

  it("ignora steps inativos e escolhe o primeiro ATIVO por position", () => {
    // O step de menor position (0) está inativo; a abertura deve pular para o
    // próximo step ativo por position (position 1).
    const steps: FlowStepRow[] = [
      { id: "inativo", position: 0, is_active: false, step_key: "rascunho" },
      { id: "ativo-2", position: 2, is_active: true, step_key: "depois" },
      { id: "ativo-1", position: 1, is_active: true, step_key: "abertura" },
    ];

    const opening = detectOpeningStep(steps);

    expect(opening?.id).toBe("ativo-1");
    expect(opening?.position).toBe(1);
  });

  it("retorna null quando não há step ativo (degrada sem lançar)", () => {
    const steps: FlowStepRow[] = [
      { id: "x", position: 0, is_active: false },
      { id: "y", position: 1, is_active: false },
    ];

    expect(detectOpeningStep(steps)).toBeNull();
    // E também para entrada vazia / ausente — nunca lança.
    expect(detectOpeningStep([])).toBeNull();
    expect(detectOpeningStep(null)).toBeNull();
    expect(detectOpeningStep(undefined)).toBeNull();
  });
});

describe("selectActiveFlow — não-regressão de consultor com 1 fluxo ativo", () => {
  it("resolve normalmente o único fluxo ativo na variante do cliente", () => {
    // Consultor com exatamente 1 fluxo ativo na variante "D" (a variante do
    // cliente). Deve resolver esse fluxo, sem cair no welcome legado.
    const flows: FlowRow[] = [
      {
        id: "flow-d",
        variant: "D",
        is_active: true,
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ];

    const resolved = selectActiveFlow(flows, "D");

    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe("flow-d");
  });

  it("fim-a-fim: resolve o fluxo único e então detecta a etapa de abertura", () => {
    // Cenário 3.3 completo: dado um fluxo resolvido com steps, a abertura é o
    // primeiro step ativo por position.
    const flows: FlowRow[] = [
      {
        id: "flow-unico",
        variant: "D",
        is_active: true,
        created_at: "2024-03-10T12:00:00.000Z",
      },
    ];

    const resolvedFlow = selectActiveFlow(flows, "D");
    expect(resolvedFlow?.id).toBe("flow-unico");

    const stepsDoFluxo: FlowStepRow[] = [
      { id: "abre", position: 0, is_active: true, step_key: "abertura" },
      { id: "conta", position: 1, is_active: true, step_key: "pede_conta" },
    ];

    const opening = detectOpeningStep(stepsDoFluxo);
    expect(opening?.id).toBe("abre");
    expect(opening?.position).toBe(0);
  });

  it("default de variante 'A' quando o cliente não tem flow_variant definido", () => {
    // Consultor com 1 fluxo ativo na variante 'A' (default); cliente sem
    // variante explícita → resolve o fluxo 'A' normalmente.
    const flows: FlowRow[] = [
      { id: "flow-a", variant: "A", is_active: true, created_at: "2024-02-02T00:00:00.000Z" },
    ];

    expect(selectActiveFlow(flows, null)?.id).toBe("flow-a");
    expect(selectActiveFlow(flows, undefined)?.id).toBe("flow-a");
  });
});
