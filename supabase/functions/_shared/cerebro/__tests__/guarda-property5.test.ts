// Testes da peça N5 — Guarda de Segurança, Tarefa 6.4 (pt-BR).
//
// Spec: `.kiro/specs/cerebro-ia/` — Tarefa 6.4 e design "Property 5: Guarda
// sempre roda" ("Nenhuma mensagem sai sem passar por N5").
//
// **Validates: Requirements 9.1, 9.7** — Property 5.
//
// FOCO desta suíte (não duplica 6.2/6.3): a INVARIANTE de que a Guarda é o
// PONTO ÚNICO de aprovação/bloqueio antes do envio. Ou seja:
//
//   1. `validarMensagem` é uma função TOTAL: para QUALQUER entrada ela devolve
//      um veredito bem-formado — ou APROVADO (passou) ou BLOQUEADO (não vai) —
//      e nunca lança (uma exceção deixaria a mensagem "escapar" do ponto único).
//   2. Toda SAÍDA é exatamente o `textoFinal` quando aprovado; nada vazio e
//      nada "sem validação" chega ao cliente.
//   3. Texto vazio (ou que vira vazio após a normalização) NUNCA é aprovado.
//
// Além disso, há um TESTE-GUARDIÃO documentando o CONTRATO que a N1
// (Orquestrador, Tarefa 7) DEVE respeitar: só envia o que a Guarda aprovou.
//
// São testes determinísticos e OFFLINE: usamos `passoAtual` que NÃO mapeia para
// etapa "rica" (simulação/consideração/finalização), então o crítico de IA
// (`criticar`, que faz rede) nunca roda. Sem mocks, sem rede.
//
// Rodar:
//   deno test --allow-env --allow-read \
//     supabase/functions/_shared/cerebro/__tests__/guarda-property5.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import fc from "https://esm.sh/fast-check@3.23.2";

import { validarMensagem } from "../guarda.ts";
import type { BotFlowStep, CustomerSnapshot } from "../tipos.ts";

// ─── Fixtures mínimos (só os campos relevantes) ──────────────────────────────

/**
 * Passo do fluxo neutro. Por padrão `stepKey: "interesse"`, que NÃO mapeia para
 * etapa rica — garante que a Guarda só roda as travas determinísticas (sem IA).
 */
function passo(over: Partial<BotFlowStep> = {}): BotFlowStep {
  return {
    id: "passo-1",
    flowId: "fluxo-1",
    stepKey: "interesse",
    stepType: "text_message",
    position: 0,
    messageText: "oi",
    persuasiveText: null,
    choiceOptions: null,
    preferredChoiceKind: null,
    captures: [],
    transitions: [],
    fallback: { mode: "safe_text", gotoStepId: null } as unknown as BotFlowStep["fallback"],
    waitFor: "none",
    waitSeconds: 0,
    pipelineKind: null,
    slotKey: null,
    conditionExpr: null,
    reachableStepIds: [],
    ...over,
  };
}

/** Estado do cliente; por padrão sem nome e sem valor de conta confirmados. */
function estado(
  customer: Partial<CustomerSnapshot["customer"]> = {},
): CustomerSnapshot {
  return {
    customerId: "c1",
    consultantId: "k1",
    flowId: "fluxo-1",
    currentStepId: "passo-1",
    status: "running",
    pauseReason: null,
    retries: 0,
    aiQuestionsThisStep: 0,
    enteredStepAt: "2024-01-01T00:00:00Z",
    expiresAt: null,
    lastInboundAt: "2024-01-01T00:00:00Z",
    lastOutboundAt: null,
    lastOutboundContentHash: null,
    customer: {
      name: null,
      electricityBillValue: null,
      documentUploaded: false,
      otpValidatedAt: null,
      phoneWhatsapp: null,
      ...customer,
    },
  };
}

/**
 * Simula a REGRA DE ENVIO da N1 (Orquestrador): nada "sai" ao cliente a não ser
 * o `textoFinal` que a Guarda aprovou e que não está vazio. É a mesma condição
 * de `index.ts` (`enviar = guarda.aprovado && textoFinal.trim().length > 0`).
 * Devolve o que de fato chegaria ao cliente (ou `null` = nada sai → handoff).
 */
function saidaAoCliente(
  veredito: { aprovado: boolean; textoFinal: string },
): string | null {
  const texto = veredito.aprovado ? (veredito.textoFinal ?? "").trim() : "";
  return texto.length > 0 ? texto : null;
}

// ─── Property 5 (a) — função TOTAL e veredito bem-formado ────────────────────
//
// Para QUALQUER texto proposto, a Guarda devolve um veredito coerente sem
// lançar: se aprovou, `textoFinal` é não-vazio (algo de fato sairá); se
// bloqueou, nada sai. Não existe terceiro estado — nada escapa do ponto único.

Deno.test(
  "Property 5a: validarMensagem é total — sempre aprova(c/ texto) ou bloqueia, nunca lança (Req 9.1, 9.7)",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 1500 }),
        fc.boolean(),
        async (textoProposto, comPasso) => {
          const veredito = await validarMensagem({
            textoProposto,
            // Passo neutro ou nulo: nunca etapa rica → sem IA, determinístico.
            passoAtual: comPasso ? passo() : null,
            estado: estado(),
          });

          // Veredito bem-formado: campos com os tipos do contrato.
          assertEquals(typeof veredito.aprovado, "boolean");
          assertEquals(typeof veredito.textoFinal, "string");

          if (veredito.aprovado) {
            // Aprovado ⇒ há conteúdo real para enviar (nada vazio "passa").
            assert(
              veredito.textoFinal.trim().length > 0,
              `aprovado não pode ter textoFinal vazio: ${JSON.stringify(veredito)}`,
            );
          } else {
            // Bloqueado ⇒ traz um motivo (rastreável) e nada sai ao cliente.
            assert(
              typeof veredito.motivoBloqueio === "string" &&
                veredito.motivoBloqueio.length > 0,
              `bloqueado deve ter motivoBloqueio: ${JSON.stringify(veredito)}`,
            );
            assertEquals(saidaAoCliente(veredito), null);
          }
        },
      ),
      { numRuns: 300 },
    );
  },
);

// ─── Property 5 (b) — texto vazio NUNCA é aprovado ───────────────────────────
//
// Qualquer entrada que seja vazia, só espaços/quebras ou só "ruído" que a
// normalização remove (marcadores de lista, negrito vazio) jamais pode ser
// aprovada — não existe mensagem vazia "saindo" pela Guarda.

Deno.test(
  "Property 5b: texto vazio/em-branco nunca é aprovado (Req 9.1, 9.7)",
  async () => {
    // Gera espaços em branco variados (espaço, tab, quebras, etc.).
    const brancoArb = fc.stringOf(
      fc.constantFrom(" ", "\t", "\n", "\r", "\u00a0", "\f", "\v"),
      { maxLength: 40 },
    );
    await fc.assert(
      fc.asyncProperty(brancoArb, async (branco) => {
        const veredito = await validarMensagem({
          textoProposto: branco,
          passoAtual: passo(),
          estado: estado(),
        });
        assertEquals(veredito.aprovado, false);
        assertEquals(saidaAoCliente(veredito), null);
      }),
      { numRuns: 200 },
    );
  },
);

Deno.test(
  "Property 5b (exemplos): vazio e variações de espaço em branco não são aprovados",
  async () => {
    const entradasVazias = [
      "",
      "   ",
      "\n\n\n",
      "\t \t",
      "\r\n \r\n",
    ];
    for (const textoProposto of entradasVazias) {
      const veredito = await validarMensagem({
        textoProposto,
        passoAtual: passo(),
        estado: estado(),
      });
      assertEquals(
        veredito.aprovado,
        false,
        `não deveria aprovar entrada vazia: ${JSON.stringify(textoProposto)}`,
      );
      assertEquals(saidaAoCliente(veredito), null);
    }
  },
);

// ─── Property 5 (c) — toda SAÍDA passou pela Guarda e é não-vazia ────────────
//
// Aplicando a MESMA regra de envio da N1 sobre o veredito da Guarda, o que
// chega ao cliente é SEMPRE: (i) não-nulo só quando a Guarda aprovou, e
// (ii) nunca vazio. Não há caminho que entregue texto "sem validação".

Deno.test(
  "Property 5c: nada sai sem aprovação da Guarda e nada vazio chega ao cliente (Req 9.1, 9.7)",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 1200 }),
        async (textoProposto) => {
          const veredito = await validarMensagem({
            textoProposto,
            passoAtual: passo(),
            estado: estado(),
          });
          const saida = saidaAoCliente(veredito);

          if (saida === null) {
            // Nada sai: ou bloqueou, ou aprovou um texto que ficou vazio
            // (impossível pela 5a, mas a regra de envio é a salvaguarda final).
            return;
          }
          // Saiu algo ⇒ a Guarda APROVOU e o conteúdo é não-vazio.
          assert(veredito.aprovado, "só sai se a Guarda aprovou");
          assert(saida.trim().length > 0, "nada vazio chega ao cliente");
        },
      ),
      { numRuns: 300 },
    );
  },
);

// ─── Caminho feliz: mensagem comercial segura SAI pelo ponto único ───────────
//
// Comprova o outro lado da invariante: uma saída legítima de fato PASSA pela
// Guarda (não é a regra que bloqueia tudo). Mensagens curtas, com CTA, sem
// conteúdo inventado/técnico, no passo neutro "interesse".

Deno.test(
  "Property 5 (positivo): mensagem comercial segura é aprovada e é o que sai",
  async () => {
    const segurasArb = fc.constantFrom(
      "Oi! Que bom seu interesse. Quer ver quanto dá pra economizar?",
      "Posso te explicar como funciona a economia na conta de luz?",
      "Bacana! Te mostro como começar agora mesmo?",
      "Legal ter você por aqui. Vamos seguir?",
      "Quer que eu te conte o próximo passo?",
    );
    await fc.assert(
      fc.asyncProperty(segurasArb, async (texto) => {
        const veredito = await validarMensagem({
          textoProposto: texto,
          passoAtual: passo({ stepKey: "interesse" }),
          estado: estado(),
        });
        assert(
          veredito.aprovado,
          `mensagem segura deveria passar: ${veredito.motivoBloqueio}`,
        );
        // O que "sai" é exatamente o textoFinal aprovado (não-vazio).
        assertEquals(saidaAoCliente(veredito), veredito.textoFinal.trim());
      }),
      { numRuns: 50 },
    );
  },
);

// ─── Teste-guardião do CONTRATO da N1 (Tarefa 7) ─────────────────────────────
//
// A N1 (Orquestrador) DEVE chamar `validarMensagem` ANTES de enviar e só pode
// deixar sair o texto aprovado pela Guarda. Este teste lê o código-fonte da N1
// (`index.ts`) e fixa esse contrato, de modo que a integração da Tarefa 7
// (e qualquer mudança futura) o respeite — se alguém remover a Guarda do
// caminho de envio, este teste quebra.
//
// **Validates: Requirements 9.7** — Property 5 (ponto único antes do envio).

Deno.test(
  "guardião do contrato N1: o Orquestrador chama validarMensagem e só envia o que a Guarda aprovou",
  async () => {
    const fonteN1 = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );

    // 1) A N1 importa a Guarda (peça N5) — o ponto único de validação.
    assert(
      /import\s*\{\s*validarMensagem\s*\}\s*from\s*["']\.\/guarda\.ts["']/.test(
        fonteN1,
      ),
      "a N1 deve importar `validarMensagem` de ./guarda.ts",
    );

    // 2) A N1 chama `validarMensagem` no fluxo do turno (antes do envio).
    assert(
      /validarMensagem\s*\(/.test(fonteN1),
      "a N1 deve chamar `validarMensagem` antes de enviar",
    );

    // 3) O envio é CONDICIONADO à aprovação da Guarda: existe uma decisão de
    //    enviar que depende de `guarda.aprovado`. Isso garante que nada sai sem
    //    passar pela Guarda (Property 5 / Req 9.7).
    assert(
      /guarda\.aprovado/.test(fonteN1),
      "o envio da N1 deve depender de `guarda.aprovado`",
    );

    // 4) O outbound só é montado quando a decisão de enviar é verdadeira — ou
    //    seja, não há outbound desacoplado da aprovação da Guarda.
    assert(
      /outbound:\s*enviar\s*\?/.test(fonteN1),
      "o `outbound` da N1 deve depender da decisão de enviar (derivada da Guarda)",
    );
  },
);
