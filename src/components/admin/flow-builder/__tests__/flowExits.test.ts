import { describe, it, expect } from "vitest";
import { getStepExits } from "../flowExits";
import type { Step, Capture } from "../flowTypes";

function makeStep(overrides: Partial<Step> & { id: string; position: number }): Step {
  return {
    flow_id: "flow-1",
    step_type: "message",
    step_key: null,
    title: `Passo ${overrides.position}`,
    summary: null,
    icon: "msg",
    message_text: "",
    text_delay_ms: null,
    slot_key: null,
    transitions: [],
    captures: [],
    fallback: { mode: "repeat" },
    is_active: true,
    ...overrides,
  };
}

function buttonsCapture(value: { id: string; title: string }[]): Capture {
  return { field: "_buttons", enabled: true, value };
}

describe("getStepExits — caminho padrão", () => {
  it("sem transitions nem fallback goto, segue a ordem da lista para o próximo ativo", () => {
    const a = makeStep({ id: "a", position: 1 });
    const b = makeStep({ id: "b", position: 2, title: "Pedir conta" });
    const exits = getStepExits(a, [a, b]);
    expect(exits).toHaveLength(1);
    expect(exits[0].kind).toBe("default");
    expect(exits[0].destKind).toBe("order");
    expect(exits[0].destStep?.id).toBe("b");
    expect(exits[0].destLabel).toContain("#2");
  });

  it("último passo sem próximo ativo => fim do fluxo", () => {
    const a = makeStep({ id: "a", position: 1 });
    const exits = getStepExits(a, [a]);
    expect(exits[0].destKind).toBe("end");
    expect(exits[0].missing).toBe(false);
  });

  it("fallback goto define o destino padrão", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      fallback: { mode: "goto", goto_step_id: "c" },
    });
    const b = makeStep({ id: "b", position: 2 });
    const c = makeStep({ id: "c", position: 3, title: "Final" });
    const exits = getStepExits(a, [a, b, c]);
    expect(exits[0].destKind).toBe("step");
    expect(exits[0].destStep?.id).toBe("c");
  });

  it("transição default com goto_special humano vira handoff", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      transitions: [
        { trigger_intent: "default", trigger_phrases: [], goto_step_id: null, goto_special: "humano" },
      ],
    });
    const exits = getStepExits(a, [a]);
    expect(exits[0].destKind).toBe("humano");
    expect(exits[0].destLabel).toContain("humano");
  });

  it("default humano tem prioridade sobre fallback.goto (espelha o Inspetor)", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      transitions: [
        { trigger_intent: "default", trigger_phrases: [], goto_step_id: null, goto_special: "humano" },
      ],
      fallback: { mode: "goto", goto_step_id: "b" },
    });
    const b = makeStep({ id: "b", position: 2 });
    const exits = getStepExits(a, [a, b]);
    expect(exits[0].destKind).toBe("humano");
  });

  it("fallback.goto tem prioridade sobre default.goto_step_id (espelha o Inspetor)", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      transitions: [
        { trigger_intent: "default", trigger_phrases: [], goto_step_id: "c", goto_special: null },
      ],
      fallback: { mode: "goto", goto_step_id: "b" },
    });
    const b = makeStep({ id: "b", position: 2, title: "Fallback alvo" });
    const c = makeStep({ id: "c", position: 3, title: "Default alvo" });
    const exits = getStepExits(a, [a, b, c]);
    expect(exits[0].destStep?.id).toBe("b");
  });

  it("fallback ai_limit resolve para responder com IA", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      fallback: { mode: "ai_limit", max_questions: 3, then: "humano" },
    });
    const exits = getStepExits(a, [a]);
    expect(exits[0].destKind).toBe("ai");
  });
});

describe("getStepExits — botões", () => {
  it("resolve o destino de cada botão pela transition casada por frase", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      captures: [buttonsCapture([{ id: "simular", title: "📸 Quero simular" }])],
      transitions: [
        {
          trigger_intent: "palavra_chave",
          trigger_phrases: ["📸 Quero simular", "Quero simular", "simular"],
          goto_step_id: "b",
          goto_special: null,
        },
      ],
    });
    const b = makeStep({ id: "b", position: 2, title: "Pedir conta" });
    const exits = getStepExits(a, [a, b]);
    const btn = exits.find((e) => e.kind === "button");
    expect(btn).toBeTruthy();
    expect(btn?.label).toBe("📸 Quero simular");
    expect(btn?.destStep?.id).toBe("b");
    expect(btn?.missing).toBe(false);
  });

  it("botão sem transition correspondente é marcado como sem destino", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      captures: [buttonsCapture([{ id: "orfao", title: "Botão órfão" }])],
    });
    const exits = getStepExits(a, [a]);
    const btn = exits.find((e) => e.kind === "button");
    expect(btn?.destKind).toBe("none");
    expect(btn?.missing).toBe(true);
  });

  it("botão com goto_special humano resolve handoff", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      captures: [buttonsCapture([{ id: "humano", title: "👤 Falar com humano" }])],
      transitions: [
        {
          trigger_intent: "palavra_chave",
          trigger_phrases: ["👤 Falar com humano", "Falar com humano", "humano"],
          goto_step_id: null,
          goto_special: "humano",
        },
      ],
    });
    const exits = getStepExits(a, [a]);
    const btn = exits.find((e) => e.kind === "button");
    expect(btn?.destKind).toBe("humano");
  });

  it("desempata botões com títulos parecidos — cada transition pertence a um botão", () => {
    // "Sim" e "Sim, quero" têm títulos que se sobrepõem. Cada botão deve
    // reivindicar sua própria transition (por id), sem roubar a do outro.
    const a = makeStep({
      id: "a",
      position: 1,
      captures: [buttonsCapture([
        { id: "sim", title: "Sim" },
        { id: "sim_quero", title: "Sim, quero" },
      ])],
      transitions: [
        {
          trigger_intent: "sim",
          trigger_phrases: ["Sim", "sim"],
          goto_step_id: "b",
          goto_special: null,
        },
        {
          trigger_intent: "sim_quero",
          trigger_phrases: ["Sim, quero", "sim_quero"],
          goto_step_id: "c",
          goto_special: null,
        },
      ],
    });
    const b = makeStep({ id: "b", position: 2, title: "Destino Sim" });
    const c = makeStep({ id: "c", position: 3, title: "Destino Sim quero" });
    const exits = getStepExits(a, [a, b, c]);
    const buttons = exits.filter((e) => e.kind === "button");
    expect(buttons).toHaveLength(2);
    expect(buttons.find((e) => e.label === "Sim")?.destStep?.id).toBe("b");
    expect(buttons.find((e) => e.label === "Sim, quero")?.destStep?.id).toBe("c");
    // E nenhuma das transitions deve sobrar como palavra-chave.
    expect(exits.some((e) => e.kind === "keyword")).toBe(false);
  });
});

describe("getStepExits — palavras-chave", () => {
  it("transitions não-default que não pertencem a botão viram saídas keyword", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      transitions: [
        {
          trigger_intent: "palavra_chave",
          trigger_phrases: ["humano", "atendente"],
          goto_step_id: null,
          goto_special: "humano",
        },
      ],
    });
    const exits = getStepExits(a, [a]);
    const kw = exits.find((e) => e.kind === "keyword");
    expect(kw).toBeTruthy();
    expect(kw?.label).toBe("humano, atendente");
    expect(kw?.destKind).toBe("humano");
  });

  it("destino removido é sinalizado como missing", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      transitions: [
        {
          trigger_intent: "palavra_chave",
          trigger_phrases: ["x"],
          goto_step_id: "fantasma",
          goto_special: null,
        },
      ],
    });
    const exits = getStepExits(a, [a]);
    const kw = exits.find((e) => e.kind === "keyword");
    expect(kw?.destKind).toBe("missing");
    expect(kw?.missing).toBe(true);
  });

  it("destino inativo é sinalizado como inactive/missing", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      transitions: [
        {
          trigger_intent: "palavra_chave",
          trigger_phrases: ["x"],
          goto_step_id: "b",
          goto_special: null,
        },
      ],
    });
    const b = makeStep({ id: "b", position: 2, is_active: false, title: "Inativo" });
    const exits = getStepExits(a, [a, b]);
    const kw = exits.find((e) => e.kind === "keyword");
    expect(kw?.destKind).toBe("inactive");
    expect(kw?.missing).toBe(true);
  });
});

describe("getStepExits — ordem e completude", () => {
  it("retorna botões, depois palavras-chave, depois padrão (sempre presente)", () => {
    const a = makeStep({
      id: "a",
      position: 1,
      captures: [buttonsCapture([{ id: "simular", title: "Quero simular" }])],
      transitions: [
        {
          trigger_intent: "palavra_chave",
          trigger_phrases: ["Quero simular", "simular"],
          goto_step_id: "b",
          goto_special: null,
        },
        {
          trigger_intent: "palavra_chave",
          trigger_phrases: ["ajuda"],
          goto_step_id: "b",
          goto_special: null,
        },
      ],
    });
    const b = makeStep({ id: "b", position: 2 });
    const exits = getStepExits(a, [a, b]);
    expect(exits.map((e) => e.kind)).toEqual(["button", "keyword", "default"]);
  });
});
