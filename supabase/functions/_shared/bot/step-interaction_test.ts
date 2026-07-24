import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  trigramSim,
  resolvePostBillNextStepId,
  stepHasInteractiveWait,
} from "./step-interaction.ts";

Deno.test("trigramSim: idêntico = 1", () => {
  assertEquals(trigramSim("Oi Maria", "Oi Maria"), 1);
});

Deno.test("trigramSim: vazio = 0", () => {
  assertEquals(trigramSim("", "x"), 0);
});

Deno.test("trigramSim: parecido alto", () => {
  const s = trigramSim("quero saber mais", "quero saber mais sobre");
  assertEquals(s > 0.5, true);
});

Deno.test("resolvePostBillNextStepId: prioriza success_goto", () => {
  assertEquals(
    resolvePostBillNextStepId({
      success_goto_step_id: "sim",
      mode: "goto",
      goto_step_id: "outro",
    }),
    "sim",
  );
});

Deno.test("resolvePostBillNextStepId: goto mode", () => {
  assertEquals(
    resolvePostBillNextStepId({ mode: "goto", goto_step_id: "next" }),
    "next",
  );
});

Deno.test("resolvePostBillNextStepId: null", () => {
  assertEquals(resolvePostBillNextStepId(null), null);
  assertEquals(resolvePostBillNextStepId({ mode: "repeat" }), null);
});

Deno.test("stepHasInteractiveWait: botões", () => {
  assertEquals(
    stepHasInteractiveWait({
      captures: [{ field: "_buttons", value: [{ id: "1" }], enabled: true }],
    }),
    true,
  );
});

Deno.test("stepHasInteractiveWait: fallback ai", () => {
  assertEquals(stepHasInteractiveWait({ fallback: { mode: "ai" } }), true);
});

Deno.test("stepHasInteractiveWait: mensagem pura", () => {
  assertEquals(stepHasInteractiveWait({ captures: [], transitions: [], fallback: {} }), false);
});
