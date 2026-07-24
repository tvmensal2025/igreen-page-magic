import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isClubProgressIntent,
  isComoFuncionaStep,
  isConfidentDocDetection,
  isPositiveCheckinIntent,
} from "./flow-predicates.ts";

Deno.test("isPositiveCheckinIntent aceita confirmação e emoji", () => {
  assertEquals(isPositiveCheckinIntent("Beleza, vamos"), true);
  assertEquals(isPositiveCheckinIntent("👍"), true);
  assertEquals(isPositiveCheckinIntent("não"), false);
});

Deno.test("isClubProgressIntent não avança com recusa isolada", () => {
  assertEquals(isClubProgressIntent("não"), false);
  assertEquals(isClubProgressIntent("pode seguir"), true);
  assertEquals(isClubProgressIntent("quero finalizar"), true);
});

Deno.test("isComoFuncionaStep reconhece chaves e título", () => {
  assertEquals(isComoFuncionaStep({ step_key: "como_funciona" }), true);
  assertEquals(isComoFuncionaStep({ title: "D Como Funciona" }), true);
  assertEquals(isComoFuncionaStep({ step_key: "ask_name" }), false);
});

Deno.test("isConfidentDocDetection respeita origem, tipo e limite", () => {
  assertEquals(isConfidentDocDetection({ source: "vision", tipo: "cnh", confianca: 0.62 }), true);
  assertEquals(isConfidentDocDetection({ source: "vision", tipo: "rg", confianca: 0.77 }), false);
  assertEquals(isConfidentDocDetection({ source: "fallback", tipo: "cnh", confianca: 1 }), false);
});
