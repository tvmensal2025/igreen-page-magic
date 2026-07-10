import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseMoneyBR, extractMoneyFromText } from "./parse-money.ts";
import { extractValor, extractValorPermissivo } from "./captureExtractors.ts";

Deno.test("parseMoneyBR: inteiro simples", () => {
  assertEquals(parseMoneyBR("200"), 200);
  assertEquals(parseMoneyBR("350"), 350);
  assertEquals(parseMoneyBR("1600"), 1600);
});

Deno.test("parseMoneyBR: decimal US NÃO vira milhar (bug 350.00→35000)", () => {
  assertEquals(parseMoneyBR("200.0"), 200);
  assertEquals(parseMoneyBR("200.00"), 200);
  assertEquals(parseMoneyBR("350.00"), 350);
  assertEquals(parseMoneyBR("350.50"), 350.5);
  assertEquals(parseMoneyBR("R$ 350.00"), 350);
  assertEquals(parseMoneyBR("R$ 200.0"), 200);
});

Deno.test("parseMoneyBR: decimal BR com vírgula", () => {
  assertEquals(parseMoneyBR("200,00"), 200);
  assertEquals(parseMoneyBR("350,00"), 350);
  assertAlmostEquals(parseMoneyBR("350,50")!, 350.5, 0.001);
  assertAlmostEquals(parseMoneyBR("1.688,15")!, 1688.15, 0.001);
  assertAlmostEquals(parseMoneyBR("R$ 250,50")!, 250.5, 0.001);
});

Deno.test("parseMoneyBR: milhar BR com ponto e 3 casas", () => {
  assertEquals(parseMoneyBR("1.688"), 1688);
  assertEquals(parseMoneyBR("1.688.150"), 1688150);
});

Deno.test("parseMoneyBR: rejeita vazio/inválido", () => {
  assertEquals(parseMoneyBR(""), null);
  assertEquals(parseMoneyBR(null), null);
  assertEquals(parseMoneyBR(undefined), null);
  assertEquals(parseMoneyBR("abc"), null);
  assertEquals(parseMoneyBR(0), null);
});

Deno.test("extractValor: 350.00 → 350 (regressão lead 3298043187)", () => {
  assertEquals(extractValor("350.00"), 350);
  assertEquals(extractValor("200.0"), 200);
  assertEquals(extractValor("200.00"), 200);
  assertEquals(extractValor("R$ 350.00"), 350);
  assertEquals(extractValor("350,00"), 350);
  assertEquals(extractValor("350"), 350);
  assertEquals(extractValor("uns 200"), 200);
});

Deno.test("extractValorPermissivo: mesmos casos US/BR", () => {
  assertEquals(extractValorPermissivo("350.00"), 350);
  assertEquals(extractValorPermissivo("200.0"), 200);
  assertEquals(extractValorPermissivo("350,50"), 350.5);
  assertAlmostEquals(extractValorPermissivo("1.688,15")!, 1688.15, 0.001);
});

Deno.test("extractMoneyFromText: simulação rápida (caso real 3298043187)", () => {
  assertEquals(extractMoneyFromText("350.00"), 350);
  assertEquals(extractMoneyFromText("200.0"), 200);
  assertEquals(extractMoneyFromText("200.00"), 200);
  assertEquals(extractMoneyFromText("R$ 350.00"), 350);
  assertEquals(extractMoneyFromText("350,00"), 350);
  assertAlmostEquals(extractMoneyFromText("1.688,15")!, 1688.15, 0.001);
  assertEquals(extractMoneyFromText("oi"), null);
});
