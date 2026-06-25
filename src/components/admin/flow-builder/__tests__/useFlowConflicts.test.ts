import { describe, it, expect } from "vitest";
import { detectConflicts } from "../useFlowConflicts";
import type { Step } from "../flowTypes";

function step(over: Partial<Step>): Step {
  return {
    id: over.id ?? "x",
    flow_id: "f",
    position: 0,
    step_type: "message",
    step_key: over.step_key ?? "k",
    title: over.title ?? "T",
    summary: "",
    icon: "msg",
    message_text: "",
    slot_key: over.step_key ?? "k",
    transitions: over.transitions ?? [],
    captures: [],
    fallback: { mode: "repeat" },
    is_active: true,
    media_order: [],
  } as unknown as Step;
}

describe("detectConflicts — só conflito real", () => {
  it("step_keys parecidos (d_como_funciona*) NÃO são conflito", () => {
    const r = detectConflicts([
      step({ id: "1", step_key: "d_como_funciona", title: "Como funciona" }),
      step({ id: "2", step_key: "d_como_funciona_copy_in3s", title: "Como funciona (pós rápida)" }),
      step({ id: "3", step_key: "d_como_funciona_copy_qwpu", title: "Como funciona (pós completa)" }),
    ]);
    expect(r.involvedCount).toBe(0);
  });

  it("mesma palavra 'como funciona' em passos diferentes NÃO é conflito", () => {
    const r = detectConflicts([
      step({
        id: "1",
        transitions: [{ trigger_phrases: ["como funciona"], goto_step_id: "a" }] as any,
      }),
      step({
        id: "2",
        transitions: [{ trigger_phrases: ["como funciona"], goto_step_id: "b" }] as any,
      }),
    ]);
    expect(r.involvedCount).toBe(0);
  });

  it("dois passos com título 100% idêntico É conflito", () => {
    const r = detectConflicts([
      step({ id: "1", title: "Pedir conta de luz" }),
      step({ id: "2", title: "Pedir conta de luz" }),
    ]);
    expect(r.conflicts.some((c) => c.kind === "duplicateTitle")).toBe(true);
  });

  it("mesma frase em duas rotas do MESMO passo É conflito", () => {
    const r = detectConflicts([
      step({
        id: "1",
        transitions: [
          { trigger_phrases: ["sim"], goto_step_id: "a" },
          { trigger_phrases: ["sim"], goto_step_id: "b" },
        ] as any,
      }),
    ]);
    expect(r.conflicts.some((c) => c.kind === "sameStepPhrase")).toBe(true);
  });
});
