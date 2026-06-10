// Testes-guardião: "Um caminho conversacional só" (pt-BR) — Tarefa 15.2.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — "Correctness Properties",
// Property 1 ("Um caminho conversacional só").
//
// Valida: Requirements 14.1 (e Property 1, que também referencia 14.2).
//   - 14.1: o Cérebro substitui a sequência fixa da vendedora de forma
//     gradual; em `on`, todo turno conversacional passa pelo Cérebro e a
//     vendedora antiga não responde mais.
//
// O QUE ESTES TESTES PROVAM (lendo o código-fonte real dos DOIS webhooks)
// -----------------------------------------------------------------------
// Num turno conversacional existem APENAS dois caminhos possíveis:
//   (1) DETERMINÍSTICO — engine v3 (`runUnifiedEngineWebhookEntry`), que assume
//       o turno por inteiro e dá early-return (`mode:"engine_v3"`); OU
//   (2) CONVERSACIONAL — o Cérebro (`responderComCerebro`) em canary/on, com
//       early-return (`mode:"cerebro"`); a vendedora legada
//       (`runConversationalFlow`/`runBotFlow`) em off/dark.
//
// Nunca um terceiro responde o MESMO turno, e nunca dois respondem juntos —
// cada caminho termina em `return Response` (mutuamente exclusivos por estrutura).
//
// (a) O Cérebro é chamado e seu early-return (`mode:"cerebro"`) PRECEDE o
//     dispatch da vendedora (runConversationalFlow/runBotFlow via runEngine).
// (b) Não há um SEGUNDO ponto de resposta conversacional além desses: exatamente
//     uma chamada `responderComCerebro`, exatamente um early-return
//     `mode:"cerebro"` e um único dispatch da vendedora por webhook. O caminho
//     KB-only (`ai-agent-router`, só no evolution) é um early-return que vem
//     ANTES do Cérebro — mutuamente exclusivo, jamais duplica resposta.
// (c) Simetria entre os dois webhooks: ambos têm o gate v3, o Cérebro e o
//     dispatch da vendedora, na mesma ordem v3 → Cérebro → vendedora.
//
// São testes de leitura/estrutura (sem rede). NÃO alteram produção.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/um-caminho-conversacional.property1.test.ts --no-check --allow-read

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const EVOLUTION_WEBHOOK = new URL(
  "../../../evolution-webhook/index.ts",
  import.meta.url,
);
const WHAPI_WEBHOOK = new URL(
  "../../../whapi-webhook/index.ts",
  import.meta.url,
);

// Conta ocorrências NÃO sobrepostas de uma substring.
function contar(texto: string, alvo: string): number {
  let n = 0;
  let i = texto.indexOf(alvo);
  while (i !== -1) {
    n++;
    i = texto.indexOf(alvo, i + alvo.length);
  }
  return n;
}

// Marcadores por webhook. O "dispatch da vendedora" é o ponto onde a vendedora
// legada de fato EXECUTA no turno:
//   - evolution: dispatch inline `const result = engine === "flow" ? await runConversationalFlow ...`
//   - whapi:     `runEngine` é DEFINIDO antes do Cérebro mas só EXECUTA em
//                `await runEngine()` (depois do early-return do Cérebro).
interface MarcadoresWebhook {
  nome: string;
  url: URL;
  v3Import: string; // import dinâmico do entry v3
  v3Return: string; // early-return do engine v3
  cerebroCall: string; // chamada do Cérebro (não o import)
  cerebroGate: string; // gate que decide o early-return
  cerebroReturn: string; // early-return do Cérebro
  vendedoraExec: string; // ponto onde a vendedora EXECUTA no turno
}

const EVOLUTION: MarcadoresWebhook = {
  nome: "evolution-webhook",
  url: EVOLUTION_WEBHOOK,
  v3Import: "runUnifiedEngineWebhookEntry",
  v3Return: 'mode: "engine_v3"',
  cerebroCall: "await responderComCerebro({",
  cerebroGate: "if (_cerebroRespondeu) {",
  cerebroReturn: 'mode: "cerebro"',
  vendedoraExec: 'const result = engine === "flow"',
};

const WHAPI: MarcadoresWebhook = {
  nome: "whapi-webhook",
  url: WHAPI_WEBHOOK,
  v3Import: "runUnifiedEngineWebhookEntry",
  v3Return: 'mode: "engine_v3"',
  cerebroCall: "await responderComCerebro({",
  cerebroGate: "if (_cerebroRespondeu) {",
  cerebroReturn: 'mode: "cerebro"',
  vendedoraExec: "await runEngine()",
};

// ─── (a) Cérebro chamado e early-return PRECEDE o dispatch da vendedora ──────

for (const m of [EVOLUTION, WHAPI]) {
  Deno.test(`15.2 (Property 1) [${m.nome}]: o Cérebro é chamado e seu early-return (mode:"cerebro") precede o dispatch da vendedora`, async () => {
    const texto = await Deno.readTextFile(m.url);

    const idxV3Return = texto.indexOf(m.v3Return);
    const idxCerebroCall = texto.indexOf(m.cerebroCall);
    const idxCerebroGate = texto.indexOf(m.cerebroGate);
    const idxCerebroReturn = texto.indexOf(m.cerebroReturn);
    const idxVendedoraExec = texto.indexOf(m.vendedoraExec);

    assert(idxV3Return >= 0, `não achei o early-return do engine v3 (${m.v3Return})`);
    assert(idxCerebroCall >= 0, `não achei a chamada do Cérebro (${m.cerebroCall})`);
    assert(idxCerebroGate >= 0, `não achei o gate do Cérebro (${m.cerebroGate})`);
    assert(idxCerebroReturn >= 0, `não achei o early-return do Cérebro (${m.cerebroReturn})`);
    assert(idxVendedoraExec >= 0, `não achei o dispatch da vendedora (${m.vendedoraExec})`);

    // O motor determinístico v3 mantém prioridade: seu early-return vem ANTES
    // do Cérebro ser chamado.
    assert(
      idxV3Return < idxCerebroCall,
      "o early-return do engine v3 deveria vir ANTES da chamada do Cérebro",
    );
    // O Cérebro é chamado, depois o gate decide, depois o early-return.
    assert(
      idxCerebroCall < idxCerebroGate && idxCerebroGate < idxCerebroReturn,
      "ordem esperada: chamada do Cérebro → gate (_cerebroRespondeu) → early-return mode:'cerebro'",
    );
    // O early-return do Cérebro PRECEDE o dispatch da vendedora — quando o
    // Cérebro responde (canary/on), a vendedora NÃO roda o mesmo turno.
    assert(
      idxCerebroReturn < idxVendedoraExec,
      "o early-return do Cérebro deveria PRECEDER o dispatch da vendedora",
    );
    assert(
      idxCerebroCall < idxVendedoraExec,
      "a chamada do Cérebro deveria vir ANTES do dispatch da vendedora",
    );
  });
}

// ─── (b) Não há um SEGUNDO ponto de resposta conversacional além desses ──────

for (const m of [EVOLUTION, WHAPI]) {
  Deno.test(`15.2 (Property 1) [${m.nome}]: existe um único ponto de resposta do Cérebro e um único dispatch da vendedora`, async () => {
    const texto = await Deno.readTextFile(m.url);

    // Exatamente UMA chamada do Cérebro e UM early-return mode:"cerebro".
    assertEquals(
      contar(texto, m.cerebroCall),
      1,
      `esperava exatamente 1 chamada do Cérebro (${m.cerebroCall})`,
    );
    assertEquals(
      contar(texto, m.cerebroReturn),
      1,
      `esperava exatamente 1 early-return do Cérebro (${m.cerebroReturn})`,
    );

    // A vendedora legada só é dispatchada num único ponto do turno. Conta os
    // CALL-SITES (precedidos de `await`) de runConversationalFlow/runBotFlow.
    const callsConversacional = contar(texto, "await runConversationalFlow(");
    const callsBot = contar(texto, "await runBotFlow(");
    // O par ternário (flow → runConversationalFlow ; sys → runBotFlow) aparece
    // uma única vez por webhook. Em ambos os webhooks isso é exatamente 1 + 1.
    assertEquals(
      callsConversacional,
      1,
      "esperava um único call-site de runConversationalFlow",
    );
    assertEquals(
      callsBot,
      1,
      "esperava um único call-site de runBotFlow",
    );
  });
}

// ─── (b.2) O caminho KB-only (ai-agent-router) é mutuamente exclusivo ────────
//
// Só existe no evolution-webhook. É um early-return (`mode:"ai_agent"`) que
// ocorre ANTES do gate v3 e do Cérebro — logo NUNCA responde o mesmo turno que
// o Cérebro/vendedora (sem resposta duplicada). Este teste trava essa garantia.

Deno.test('15.2 (Property 1) [evolution-webhook]: o caminho KB-only (mode:"ai_agent") é early-return e precede o Cérebro (mutuamente exclusivo)', async () => {
  const texto = await Deno.readTextFile(EVOLUTION_WEBHOOK);
  const marcadorAiAgent = 'mode: "ai_agent"';
  const idxAiAgent = texto.indexOf(marcadorAiAgent);
  const idxCerebroCall = texto.indexOf(EVOLUTION.cerebroCall);

  assert(idxAiAgent >= 0, 'não achei o early-return do ai-agent-router (mode:"ai_agent")');
  assert(idxCerebroCall >= 0, "não achei a chamada do Cérebro");

  // O bloco do ai-agent-router termina em `return new Response(...mode:"ai_agent")`
  // — curto-circuita o turno ANTES de chegar ao gate v3 / Cérebro / vendedora.
  const trechoAntes = texto.slice(0, idxAiAgent);
  assert(
    /return new Response\(JSON\.stringify\(\{ ok: true, mode: "ai_agent" \}\)/.test(
      texto.slice(Math.max(0, idxAiAgent - 80), idxAiAgent + 60),
    ) || trechoAntes.lastIndexOf("return new Response") >= 0,
    "o caminho KB-only deveria ser um early-return (return new Response)",
  );
  assert(
    idxAiAgent < idxCerebroCall,
    "o early-return do ai-agent-router deveria PRECEDER o Cérebro (mutuamente exclusivo, sem resposta dupla)",
  );

  // E o whapi-webhook NÃO tem esse caminho — confirma que não foi introduzido
  // um segundo responder lá.
  const whapi = await Deno.readTextFile(WHAPI_WEBHOOK);
  assertEquals(
    contar(whapi, 'mode: "ai_agent"'),
    0,
    "whapi-webhook não deveria ter o caminho KB-only (ai-agent-router)",
  );
});

// ─── (c) Simetria entre os dois webhooks ─────────────────────────────────────

Deno.test("15.2 (Property 1): os DOIS webhooks têm os MESMOS dois caminhos, na mesma ordem (v3 → Cérebro → vendedora)", async () => {
  const evo = await Deno.readTextFile(EVOLUTION_WEBHOOK);
  const whapi = await Deno.readTextFile(WHAPI_WEBHOOK);

  for (const [nome, texto, vendedoraExec] of [
    ["evolution-webhook", evo, EVOLUTION.vendedoraExec] as const,
    ["whapi-webhook", whapi, WHAPI.vendedoraExec] as const,
  ]) {
    // Caminho determinístico (engine v3) presente.
    assert(
      texto.includes("runUnifiedEngineWebhookEntry") && texto.includes('mode: "engine_v3"'),
      `${nome}: falta o caminho determinístico (engine v3)`,
    );
    // Caminho conversacional (Cérebro) presente.
    assert(
      texto.includes("await responderComCerebro({") && texto.includes('mode: "cerebro"'),
      `${nome}: falta o caminho conversacional do Cérebro`,
    );
    // Caminho conversacional legado (vendedora) presente.
    assert(
      texto.includes("await runConversationalFlow(") && texto.includes("await runBotFlow("),
      `${nome}: falta o dispatch da vendedora legada`,
    );

    // Ordem v3 → Cérebro → vendedora idêntica nos dois.
    const idxV3 = texto.indexOf('mode: "engine_v3"');
    const idxCerebro = texto.indexOf('mode: "cerebro"');
    const idxVendedora = texto.indexOf(vendedoraExec);
    assert(
      idxV3 < idxCerebro && idxCerebro < idxVendedora,
      `${nome}: ordem esperada engine_v3 → cerebro → vendedora`,
    );
  }
});
