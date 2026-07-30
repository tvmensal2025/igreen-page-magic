// Task 30 (whatsapp-flow-reliability-fix): testes do shortcut exato em
// `answerFaqWithAI`. Cobrimos só `normalizeFaqQuestion` aqui — o helper
// que decide a igualdade. O caminho com `supabase` é mockado em testes
// de integração no nível do webhook (PBT 2.32 do bugfix.md).

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeFaqQuestion, buildFaqSystemPrompt } from "./ai-faq-answerer.ts";

Deno.test("normalizeFaqQuestion: lowercase + trim", () => {
  assertEquals(normalizeFaqQuestion("  Quanto Custa  "), "quanto custa");
});

Deno.test("normalizeFaqQuestion: colapsa whitespace", () => {
  assertEquals(normalizeFaqQuestion("quanto    custa"), "quanto custa");
  assertEquals(normalizeFaqQuestion("quanto\tcusta\nmesmo"), "quanto custa mesmo");
});

Deno.test("normalizeFaqQuestion: remove diacríticos", () => {
  assertEquals(normalizeFaqQuestion("É caro?"), "e caro");
  assertEquals(normalizeFaqQuestion("São Paulo"), "sao paulo");
  assertEquals(normalizeFaqQuestion("não atende"), "nao atende");
});

Deno.test("normalizeFaqQuestion: remove pontuação final", () => {
  assertEquals(normalizeFaqQuestion("quanto custa?"), "quanto custa");
  assertEquals(normalizeFaqQuestion("quanto custa!"), "quanto custa");
  assertEquals(normalizeFaqQuestion("quanto custa..."), "quanto custa");
  assertEquals(normalizeFaqQuestion("quanto custa???"), "quanto custa");
});

Deno.test("normalizeFaqQuestion: pontuação interna preservada", () => {
  // Pontuação no meio não é removida — só a do final.
  assertEquals(normalizeFaqQuestion("oi, quanto custa"), "oi, quanto custa");
});

Deno.test("normalizeFaqQuestion: entradas vazias", () => {
  assertEquals(normalizeFaqQuestion(""), "");
  assertEquals(normalizeFaqQuestion("   "), "");
  assertEquals(normalizeFaqQuestion(null as any), "");
  assertEquals(normalizeFaqQuestion(undefined as any), "");
});

Deno.test("normalizeFaqQuestion: case + diacríticos juntos", () => {
  // "Como FUNCIONA?" deve casar com "como funciona" cadastrado em bot_flow_qa_triggers.
  assertEquals(normalizeFaqQuestion("Como FUNCIONA?"), "como funciona");
  // "É caro?" deve casar com "e caro" se cadastrado.
  assertEquals(normalizeFaqQuestion("É caro?"), "e caro");
});

Deno.test("buildFaqSystemPrompt: usa a identidade do consultor, nunca 'Rafael' fixo", () => {
  const p = buildFaqSystemPrompt({ assistantName: "Bia", consultantLabel: "Abel" });
  assertStringIncludes(p, "Você é Bia");
  assertStringIncludes(p, "Abel");
  if (p.includes("Rafael")) throw new Error("prompt vazou nome fixo Rafael");
});

Deno.test("buildFaqSystemPrompt: sem consultor cai em persona genérica", () => {
  const p = buildFaqSystemPrompt({ assistantName: null, consultantLabel: null });
  assertStringIncludes(p, "assistente da iGreen Energy");
  if (p.includes("Rafael")) throw new Error("prompt vazou nome fixo Rafael");
});
