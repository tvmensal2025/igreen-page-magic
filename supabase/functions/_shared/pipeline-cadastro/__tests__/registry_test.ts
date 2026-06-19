import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CADASTRO_STEP_REGISTRY,
  classifyStep,
} from "../registry.ts";

Deno.test("CADASTRO_STEP_REGISTRY has exactly 49 entries (audit canonical)", () => {
  assertEquals(Object.keys(CADASTRO_STEP_REGISTRY).length, 49);
});

Deno.test("CADASTRO_STEP_REGISTRY split: 43 cadastro-only + 6 híbrido", () => {
  const values = Object.values(CADASTRO_STEP_REGISTRY);
  const cadastroOnly = values.filter((v) => v === "cadastro-only").length;
  const hibrido = values.filter((v) => v === "híbrido").length;
  assertEquals(cadastroOnly, 43);
  assertEquals(hibrido, 6);
});

Deno.test("classifyStep: cadastro-only step → pipeline", () => {
  assertEquals(classifyStep("aguardando_conta"), "pipeline");
});

Deno.test("classifyStep: híbrido step → transition_first", () => {
  assertEquals(classifyStep("ask_quero_cadastrar"), "transition_first");
});

Deno.test("classifyStep: step not in registry → transition_first", () => {
  assertEquals(classifyStep("welcome"), "transition_first");
});

Deno.test("classifyStep: null step key → transition_first", () => {
  assertEquals(classifyStep(null), "transition_first");
});
