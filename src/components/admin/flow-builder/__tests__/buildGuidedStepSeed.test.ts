import { describe, it, expect } from "vitest";
import {
  buildGuidedStepSeed,
  aceitaBotoesPara,
  type GuidedStepInput,
} from "../GuidedStepDialog";
import { matchTransition } from "../../../../../supabase/functions/_shared/flow-router";
import type { Transition } from "../flowTypes";

/** Atalho para montar a entrada do builder com defaults sensatos. */
function input(overrides: Partial<GuidedStepInput> = {}): GuidedStepInput {
  return {
    stepType: "message",
    titulo: "",
    mensagem: "",
    botoes: [],
    ...overrides,
  };
}

describe("buildGuidedStepSeed — formato base", () => {
  it("monta um passo de mensagem sem botões com fallback repeat", () => {
    const seed = buildGuidedStepSeed(
      input({ stepType: "message", titulo: "Boas-vindas", mensagem: "Oi {{nome}}!" }),
    );
    expect(seed.step_type).toBe("message");
    expect(seed.title).toBe("Boas-vindas");
    expect(seed.message_text).toBe("Oi {{nome}}!");
    expect(seed.transitions).toEqual([]);
    expect(seed.captures).toEqual([]);
    expect(seed.fallback).toEqual({ mode: "repeat" });
  });

  it("usa o rótulo do tipo como título quando o título vem vazio", () => {
    const seed = buildGuidedStepSeed(input({ stepType: "message", titulo: "   " }));
    expect(seed.title).toBe("Mensagem comum");
  });

  it("faz trim do título e da mensagem", () => {
    const seed = buildGuidedStepSeed(
      input({ titulo: "  Passo  ", mensagem: "  texto  " }),
    );
    expect(seed.title).toBe("Passo");
    expect(seed.message_text).toBe("texto");
  });
});

describe("buildGuidedStepSeed — botões com destino explícito (Opção A)", () => {
  it("cada botão vira UMA transition com destino explícito (nunca sem regra)", () => {
    const seed = buildGuidedStepSeed(
      input({
        botoes: [
          { id: "cadastrar", title: "📝 Cadastrar agora", dest: "special:cadastro" },
          { id: "humano", title: "👤 Falar com humano", dest: "special:humano" },
        ],
      }),
    );
    const transitions = seed.transitions as Transition[];
    expect(transitions).toHaveLength(2);
    // TODA transition tem destino: goto_step_id OU goto_special preenchido.
    for (const t of transitions) {
      const temDestino = !!t.goto_step_id || !!t.goto_special;
      expect(temDestino).toBe(true);
    }
  });

  it("destino special:cadastro e special:humano viram goto_special", () => {
    const seed = buildGuidedStepSeed(
      input({
        botoes: [
          { id: "cadastrar", title: "📝 Cadastrar agora", dest: "special:cadastro" },
          { id: "humano", title: "👤 Falar com humano", dest: "special:humano" },
        ],
      }),
    );
    const transitions = seed.transitions as Transition[];
    expect(transitions[0].goto_special).toBe("cadastro");
    expect(transitions[0].goto_step_id).toBeNull();
    expect(transitions[1].goto_special).toBe("humano");
    expect(transitions[1].goto_step_id).toBeNull();
  });

  it("destino step:<id> vira goto_step_id (passo existente)", () => {
    const seed = buildGuidedStepSeed(
      input({
        botoes: [
          { id: "simular", title: "📸 Quero simular", dest: "step:abc-123" },
        ],
      }),
    );
    const t = (seed.transitions as Transition[])[0];
    expect(t.goto_step_id).toBe("abc-123");
    expect(t.goto_special).toBeNull();
  });

  it("trigger_phrases espelha o setButtonGoto: [título, título sem emoji, id]", () => {
    const seed = buildGuidedStepSeed(
      input({
        botoes: [
          { id: "simular", title: "📸 Quero simular", dest: "special:cadastro" },
        ],
      }),
    );
    const t = (seed.transitions as Transition[])[0];
    expect(t.trigger_intent).toBe("palavra_chave");
    expect(t.trigger_phrases).toEqual(["📸 Quero simular", "Quero simular", "simular"]);
  });

  it("grava os botões em captures._buttons no formato {id,title}", () => {
    const seed = buildGuidedStepSeed(
      input({
        botoes: [
          { id: "sim", title: "✅ Sim", dest: "special:cadastro" },
        ],
      }),
    );
    const cap = seed.captures!.find((c) => c.field === "_buttons");
    expect(cap).toBeTruthy();
    expect(cap?.enabled).toBe(true);
    expect(cap?.value).toEqual([{ id: "sim", title: "✅ Sim" }]);
  });
});

describe("buildGuidedStepSeed — tipos de captura não usam botões", () => {
  it("capture_conta ignora botões e não cria transitions/captures de botão", () => {
    const seed = buildGuidedStepSeed(
      input({
        stepType: "capture_conta",
        botoes: [{ id: "x", title: "X", dest: "special:cadastro" }],
      }),
    );
    expect(seed.transitions).toEqual([]);
    expect(seed.captures).toEqual([]);
  });

  it("aceitaBotoesPara reflete só message/confirm_phone/finalizar_cadastro", () => {
    expect(aceitaBotoesPara("message")).toBe(true);
    expect(aceitaBotoesPara("confirm_phone")).toBe(true);
    expect(aceitaBotoesPara("finalizar_cadastro")).toBe(true);
    expect(aceitaBotoesPara("capture_conta")).toBe(false);
    expect(aceitaBotoesPara("capture_documento")).toBe(false);
    expect(aceitaBotoesPara("capture_email")).toBe(false);
  });
});

describe("buildGuidedStepSeed — integração com o runtime (matchTransition)", () => {
  it("o clique no botão casa a transition no runtime (não cai no fallback repeat)", () => {
    const seed = buildGuidedStepSeed(
      input({
        botoes: [
          { id: "cadastrar", title: "📝 Cadastrar agora", dest: "special:cadastro" },
        ],
      }),
    );
    const transitions = seed.transitions as Transition[];
    // Simula o clique: o runtime recebe o id do botão.
    const matched = matchTransition({
      transitions: transitions as never,
      buttonId: "cadastrar",
      buttons: [{ id: "cadastrar", title: "📝 Cadastrar agora" }],
    });
    expect(matched).not.toBeNull();
    expect(matched?.goto_special).toBe("cadastro");
  });

  it("também casa quando o cliente digita o número da opção", () => {
    const seed = buildGuidedStepSeed(
      input({
        botoes: [
          { id: "humano", title: "👤 Falar com humano", dest: "special:humano" },
        ],
      }),
    );
    const transitions = seed.transitions as Transition[];
    const matched = matchTransition({
      transitions: transitions as never,
      messageText: "1",
      buttons: [{ id: "humano", title: "👤 Falar com humano" }],
    });
    expect(matched?.goto_special).toBe("humano");
  });
});
