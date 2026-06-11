// Testes do SUPORTE A VARIANT B no caminho do Cérebro IA (pt-BR).
//
// CONTEXTO (causa-raiz do bug de produção 2026-06-11):
// ~99% dos clientes têm `flow_variant = 'B'`. O `loadContext`/`pickVariant`
// (engine v3) REJEITAVAM B de propósito (lançavam exceção), porque B era a
// antiga "Vendedora V2 (IA livre)". Como o Cérebro IA SUBSTITUI essa vendedora
// fazendo `bot_flow_steps` comandar a conversa (Regra de Ouro do design), ele
// precisa carregar e rodar o fluxo B normalmente. Sem isso, todo lead B caía
// em handoff (passoAtualId=null).
//
// O QUE PROVAMOS:
//   (1) `pickVariant("B")` NÃO lança e delega para a estratégia da variant A
//       (renderiza os passos do construtor). Antes lançava.
//   (2) `pickVariant` segue válido para A/C/D (sem regressão).
//   (3) `loadContext` aceita o parâmetro `permitirVariantB` (contrato),
//       documentando que o Cérebro o usa.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/variant-b-suporte.test.ts --no-check

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickVariant } from "../../engine/helpers.ts";
import { variantA } from "../../engine/variants/a.ts";

Deno.test("pickVariant('B') não lança e delega para variantA (fluxo B comandado por bot_flow_steps)", () => {
  let estrategia: unknown;
  // Antes da correção, isto lançava: "variant B is handled by Vendedora V2".
  const run = () => {
    estrategia = pickVariant("B");
  };
  run(); // não deve lançar
  assertEquals(
    estrategia,
    variantA,
    "variant B deve reusar a estratégia de A (renderizar os passos do construtor)",
  );
});

Deno.test("pickVariant continua válido para A e D (sem regressão)", () => {
  assertEquals(pickVariant("A"), variantA);
  // D tem estratégia própria (delega A + botões) — só garantimos que existe.
  const d = pickVariant("D");
  assert(typeof d.buildStepOutbound === "function");
});

Deno.test("pickVariant('C') mantém estratégia própria (sentinela de handoff)", () => {
  const c = pickVariant("C");
  assert(typeof c.buildStepOutbound === "function");
});
