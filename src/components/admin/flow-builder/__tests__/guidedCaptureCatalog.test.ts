// Trava o catálogo da Iris organizado por INTENÇÃO (GUIDED_CAPTURE_OPTIONS) e
// o seed gerado para os novos tipos (capture_name) contra regressões.
//
// POR QUE ESTE TESTE EXISTE
// -------------------------
// O redesenho passou a perguntar a INTENÇÃO (falar | pedir) e deduzir o
// step_type. Se alguém adicionar uma opção de captura com step_type que o
// runtime não conhece, ou trazer de volta "representante" (removido de
// propósito), o fluxo quebra silenciosamente. Aqui garantimos:
//   • todo stepType ofertado é reconhecido pelo runtime;
//   • a variável produzida é canônica e bate com o validador;
//   • "representante" NÃO aparece como captura;
//   • capture_name (pedir o nome) gera seed limpo, sem botões/transitions.

import { describe, it, expect } from "vitest";
import { buildGuidedStepSeed, type GuidedStepInput } from "../GuidedStepDialog";
import { GUIDED_CAPTURE_OPTIONS } from "../flowTypes";
import { useFlowValidation } from "../useFlowValidation";
import { renderHook } from "@testing-library/react";
import type { Step } from "../flowTypes";

// step_types reconhecidos pelo runtime (manual-step-send KNOWN_TYPES +
// whapi-webhook ask_*). Espelha .tmp/map-guided-intents.py.
const RUNTIME_KNOWN_TYPES = new Set([
  "message",
  "capture_name",
  "capture_conta",
  "capture_documento",
  "capture_email",
  "confirm_phone",
  "finalizar_cadastro",
]);

// Variáveis canônicas conhecidas pelo useFlowValidation (KNOWN_VARS).
const KNOWN_VARS = new Set([
  "nome", "valor_conta", "economia_range", "telefone", "cpf", "representante", "email",
]);

function input(overrides: Partial<GuidedStepInput> = {}): GuidedStepInput {
  return { stepType: "message", titulo: "", mensagem: "", botoes: [], ...overrides };
}

describe("GUIDED_CAPTURE_OPTIONS — catálogo por intenção (pedir)", () => {
  it("todo stepType ofertado é reconhecido pelo runtime", () => {
    for (const opt of GUIDED_CAPTURE_OPTIONS) {
      expect(RUNTIME_KNOWN_TYPES.has(opt.stepType)).toBe(true);
    }
  });

  it("toda variável produzida é canônica (conhecida pelo validador)", () => {
    for (const opt of GUIDED_CAPTURE_OPTIONS) {
      expect(KNOWN_VARS.has(opt.produces)).toBe(true);
    }
  });

  it('"representante" NÃO é uma opção de captura (somos nós, confundiria)', () => {
    const keys = GUIDED_CAPTURE_OPTIONS.map((o) => o.key);
    const labels = GUIDED_CAPTURE_OPTIONS.map((o) => o.label.toLowerCase());
    expect(keys).not.toContain("representante");
    expect(labels.some((l) => l.includes("representante"))).toBe(false);
  });

  it('"nome" é opcional e os demais são obrigatórios', () => {
    const nome = GUIDED_CAPTURE_OPTIONS.find((o) => o.key === "nome");
    expect(nome?.optional).toBe(true);
    const naoOpcionais = GUIDED_CAPTURE_OPTIONS.filter((o) => o.key !== "nome");
    expect(naoOpcionais.every((o) => !o.optional)).toBe(true);
  });

  it("as chaves esperadas estão presentes (nome, valor_conta, documento, email, telefone)", () => {
    const keys = GUIDED_CAPTURE_OPTIONS.map((o) => o.key).sort();
    expect(keys).toEqual(["documento", "email", "nome", "telefone", "valor_conta"]);
  });
});

describe("buildGuidedStepSeed — pedir o nome (capture_name)", () => {
  it("monta capture_name sem botões nem transitions, com fallback repeat", () => {
    const seed = buildGuidedStepSeed(
      input({ stepType: "capture_name", titulo: "Nome", mensagem: "Como posso te chamar?" }),
    );
    expect(seed.step_type).toBe("capture_name");
    expect(seed.transitions).toEqual([]);
    expect(seed.captures).toEqual([]);
    expect(seed.fallback).toEqual({ mode: "repeat" });
  });

  it("capture_name não gera avisos de destino no validador", () => {
    const seed = buildGuidedStepSeed(
      input({ stepType: "capture_name", titulo: "Nome", mensagem: "Qual seu nome?" }),
    );
    const step: Step = {
      flow_id: "f1", step_key: null, summary: null, text_delay_ms: null,
      slot_key: null, is_active: true, icon: "user",
      title: "Nome", message_text: "Qual seu nome?", step_type: "capture_name",
      transitions: [], captures: [], fallback: { mode: "repeat" },
      ...seed, id: "novo", position: 1,
    } as Step;
    const { byStep } = renderHook(() => useFlowValidation([step])).result.current;
    const kinds = (byStep["novo"] ?? []).map((w) => w.kind);
    expect(kinds).not.toContain("button_no_rule");
    expect(kinds).not.toContain("transition_no_dest");
  });
});
