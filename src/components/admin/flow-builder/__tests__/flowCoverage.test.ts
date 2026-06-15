// Trava o "Cadastro 100%" — guia que ajuda o consultor a finalizar o fluxo.
// Garante que os marcos obrigatórios e o cálculo de progresso/próximo batem.

import { describe, it, expect } from "vitest";
import { computeFlowCoverage, type Step } from "../flowTypes";

function mk(step_type: string, position: number, over: Partial<Step> = {}): Step {
  return {
    id: `s${position}`, flow_id: "f", position, step_type, step_key: null,
    title: step_type, summary: null, icon: "msg", message_text: "", text_delay_ms: null,
    slot_key: null, transitions: [], captures: [], fallback: { mode: "repeat" },
    is_active: true, ...over,
  } as Step;
}

describe("computeFlowCoverage — cadastro completo", () => {
  it("fluxo vazio → 0% e próximo marco = conta", () => {
    const c = computeFlowCoverage([]);
    expect(c.percent).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.next?.key).toBe("conta");
  });

  it("fluxo completo (conta+doc+email+telefone+finalizar) → 100% e sem próximo", () => {
    const steps = [
      mk("capture_conta", 1),
      mk("capture_documento", 2),
      mk("capture_email", 3),
      mk("confirm_phone", 4),
      mk("finalizar_cadastro", 5),
    ];
    const c = computeFlowCoverage(steps);
    expect(c.percent).toBe(100);
    expect(c.complete).toBe(true);
    expect(c.next).toBeNull();
  });

  it("falta finalizar → não está completo e próximo é finalizar", () => {
    const steps = [
      mk("capture_conta", 1),
      mk("capture_documento", 2),
      mk("capture_email", 3),
      mk("confirm_phone", 4),
    ];
    const c = computeFlowCoverage(steps);
    expect(c.complete).toBe(false);
    expect(c.next?.key).toBe("finalizar");
    expect(c.percent).toBe(80);
  });

  it("passos inativos não contam para a cobertura", () => {
    const steps = [mk("capture_conta", 1, { is_active: false })];
    const c = computeFlowCoverage(steps);
    expect(c.milestones.find((m) => m.milestone.key === "conta")?.done).toBe(false);
  });

  it("capture_doc (alias) satisfaz o marco documento", () => {
    const steps = [mk("capture_doc", 1)];
    const c = computeFlowCoverage(steps);
    expect(c.milestones.find((m) => m.milestone.key === "documento")?.done).toBe(true);
  });
});
