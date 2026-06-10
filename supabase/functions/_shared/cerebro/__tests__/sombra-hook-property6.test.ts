// Testes da Property 6 — "Sombra não envia" (pt-BR) — Tarefa 9.4.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — "Correctness Properties":
//   ### Property 6: Sombra não envia
//   Em `dark`, o Cérebro nunca envia ao cliente; apenas registra a decisão.
//
// **Validates: Requirements 3.3, 2.3** — Property 6.
//
// FOCO desta suíte (NÃO duplica 9.1/9.3)
// --------------------------------------
// A 9.1 prova o gate por estágio e o registro; a 9.3 prova fail-open /
// não-interferência. AQUI provamos UMA coisa só, em muitos formatos de entrada:
// a INVARIANTE de que a sombra OBSERVA mas NUNCA envia ao cliente. Em concreto:
//
//   1. INVARIANTE no resultado: `enviouAoCliente` é SEMPRE `false`, para
//      qualquer estágio e qualquer inbound (texto, botão, mídia, vazio).
//   2. ÚNICO efeito permitido em `dark`: o registro (`registrarDecisaoSombra`).
//      Mesmo quando o Cérebro devolve `outbound` (mensagens prontas), essas
//      mensagens são DESCARTADAS — nenhuma delas vira envio. O hook não possui
//      sequer uma dependência de envio (não há `sendMessage`/`enviar` em
//      `DependenciasSombra`), então é estruturalmente impossível enviar.
//   3. Fora de `dark` (`off`/`canary`/`on`) a sombra não roda nem registra —
//      e, claro, também não envia.
//
// Além do nível do hook, há um TESTE-GUARDIÃO que lê o CÓDIGO-FONTE dos DOIS
// webhooks (evolution + whapi) e fixa o contrato de integração: o retorno de
// `executarCerebroSombra` é IGNORADO — não é atribuído a nada nem usado para
// derivar qualquer envio (`sendMessage`/`reply`/`outbound`). Se alguém ligar a
// saída da sombra a um envio, este teste quebra.
//
// ESTRATÉGIA (isolado, sem rede): injetamos `deps` por mocks e contamos as
// chamadas. O Cérebro mockado SEMPRE devolve `outbound` não-vazio de propósito,
// para provar que ter mensagens prontas NÃO leva a envio na sombra.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/sombra-hook-property6.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import fc from "https://esm.sh/fast-check@3.23.2";

import {
  executarCerebroSombra,
  type DependenciasSombra,
  type EntradaSombraHook,
} from "../sombra-hook.ts";
import type { FlowEngineV3Flag } from "../../feature-flag.ts";
import type { ResultadoCerebro } from "../tipos.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SUPABASE_INERTE = {
  from() {
    throw new Error("não deveria ser usado nos mocks");
  },
};

/**
 * Resultado do Cérebro com `outbound` SEMPRE preenchido (mensagens prontas para
 * envio). Em sombra elas têm de ser ignoradas — é exatamente o que validamos.
 */
function resultadoComOutbound(): ResultadoCerebro {
  return {
    reply: "Olá! Posso te ajudar a economizar na conta de luz.",
    outbound: [
      { kind: "text", text: "Olá!", idempotencyContent: "Olá!" },
      { kind: "text", text: "Quer ver quanto dá pra economizar?", idempotencyContent: "cta" },
    ],
    stateUpdate: {},
    shouldHandoff: false,
    decisao: {
      passoAtualId: "passo-1",
      proximoPassoId: "passo-2",
      intencao: "demonstrar_interesse",
    },
  } as ResultadoCerebro;
}

/**
 * Monta `deps` mockadas e um registro de TODOS os efeitos observáveis. Note que
 * NÃO existe nenhuma dependência de "envio" no contrato do hook — o único
 * efeito externo possível em `dark` é `registrarDecisaoSombra`.
 */
function montarDeps(flag: FlowEngineV3Flag) {
  const efeitos = {
    processarTurnoChamado: 0,
    registrarChamado: 0,
    /** `outbound` que o Cérebro produziu (e que NÃO pode virar envio). */
    outboundProduzido: 0,
  };
  const deps: DependenciasSombra = {
    // deno-lint-ignore no-explicit-any
    lerFlag: (_s: any, _c: string) => Promise.resolve(flag),
    // deno-lint-ignore no-explicit-any
    processarTurno: (_e: any) => {
      efeitos.processarTurnoChamado++;
      const r = resultadoComOutbound();
      efeitos.outboundProduzido += r.outbound?.length ?? 0;
      return Promise.resolve(r);
    },
    // deno-lint-ignore no-explicit-any
    registrarDecisaoSombra: (_entrada: any) => {
      efeitos.registrarChamado++;
      return Promise.resolve({ ok: true, coincide: true });
    },
  };
  return { deps, efeitos };
}

// ─── Geradores (constrangidos ao espaço de entrada real do webhook) ─────────

/** Um inbound plausível: texto, botão, mídia ou vazio. */
const inboundArb = fc.oneof(
  fc.record({
    inboundText: fc.string({ maxLength: 60 }),
    inboundButtonId: fc.constant(null),
    inboundMediaKind: fc.constant(null),
  }),
  fc.record({
    inboundText: fc.constant(null),
    inboundButtonId: fc.constantFrom("btn_sim", "btn_nao", "2"),
    inboundMediaKind: fc.constant(null),
  }),
  fc.record({
    inboundText: fc.constant(null),
    inboundButtonId: fc.constant(null),
    inboundMediaKind: fc.constantFrom("image", "audio", "video", "document") as fc.Arbitrary<
      "image" | "audio" | "video" | "document"
    >,
  }),
);

const canalArb = fc.constantFrom("evolution", "whapi") as fc.Arbitrary<"evolution" | "whapi">;

function entradaBase(over: Partial<EntradaSombraHook> = {}): EntradaSombraHook {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: SUPABASE_INERTE as any,
    customerId: "cliente-1",
    consultantId: "consultor-1",
    legacyStep: "passo-2",
    inboundText: "quero economizar",
    channel: "evolution",
    ...over,
  };
}

// ─── Property 6 (a) — em `dark`, NUNCA envia; só registra ───────────────────
//
// Para QUALQUER inbound e canal, em `dark`: o hook roda o Cérebro, grava 1
// registro e a invariante `enviouAoCliente=false` se mantém. As mensagens
// prontas (`outbound`) que o Cérebro produziu são DESCARTADAS — o único efeito
// externo é o registro. Não há nenhum envio.

Deno.test(
  "Property 6a: em `dark`, a sombra registra mas NUNCA envia ao cliente (Req 3.3, 2.3)",
  async () => {
    await fc.assert(
      fc.asyncProperty(inboundArb, canalArb, async (inbound, channel) => {
        const { deps, efeitos } = montarDeps("dark");
        const r = await executarCerebroSombra(
          entradaBase({ ...inbound, channel, deps }),
        );

        // Invariante de sombra: NADA é enviado ao cliente.
        assertEquals(r.enviouAoCliente, false);
        // Rodou em sombra e gravou exatamente uma vez.
        assertEquals(r.executou, true);
        assertEquals(r.registrou, true);
        assertEquals(efeitos.processarTurnoChamado, 1);
        assertEquals(efeitos.registrarChamado, 1);
        // O Cérebro produziu mensagens prontas, mas elas foram DESCARTADAS:
        // o único efeito externo foi o registro (não há envio).
        assert(
          efeitos.outboundProduzido > 0,
          "o teste deve exercitar o caso em que há outbound a descartar",
        );
      }),
      { numRuns: 200 },
    );
  },
);

// ─── Property 6 (b) — fora de `dark` não roda, não registra, não envia ──────
//
// Em `off`/`canary`/`on` a sombra é inerte: não chama o Cérebro, não grava e —
// pela mesma invariante — não envia. (O envio real em `canary`/`on` é de outra
// peça, fora deste hook de sombra.)

Deno.test(
  "Property 6b: fora de `dark` a sombra não roda, não registra e não envia (Req 2.3)",
  async () => {
    const naoDarkArb = fc.constantFrom("off", "canary", "on") as fc.Arbitrary<FlowEngineV3Flag>;
    await fc.assert(
      fc.asyncProperty(naoDarkArb, inboundArb, async (flag, inbound) => {
        const { deps, efeitos } = montarDeps(flag);
        const r = await executarCerebroSombra(entradaBase({ ...inbound, deps }));

        assertEquals(r.enviouAoCliente, false);
        assertEquals(r.executou, false);
        assertEquals(r.registrou, false);
        assertEquals(efeitos.processarTurnoChamado, 0);
        assertEquals(efeitos.registrarChamado, 0);
      }),
      { numRuns: 120 },
    );
  },
);

// ─── Property 6 (c) — invariante de TIPO/runtime sempre presente ────────────
//
// `enviouAoCliente` é o literal `false` no tipo `ResultadoSombraHook`. Aqui
// fixamos em runtime que, em qualquer estágio, o resultado carrega essa marca —
// é o "selo" de que aquele caminho não envia.

Deno.test(
  "Property 6c: o resultado do hook SEMPRE traz enviouAoCliente=false (Req 3.3)",
  async () => {
    const flagArb = fc.constantFrom("off", "dark", "canary", "on") as fc.Arbitrary<FlowEngineV3Flag>;
    await fc.assert(
      fc.asyncProperty(flagArb, async (flag) => {
        const { deps } = montarDeps(flag);
        const r = await executarCerebroSombra(entradaBase({ deps }));
        assert(r.enviouAoCliente === false);
      }),
      { numRuns: 80 },
    );
  },
);

// ─── Exemplo determinístico (complementa as propriedades) ────────────────────

Deno.test(
  "Property 6 (exemplo): mesmo com outbound pronto, em `dark` nada sai e só há 1 registro (Req 3.3)",
  async () => {
    const { deps, efeitos } = montarDeps("dark");
    const r = await executarCerebroSombra(entradaBase({ deps }));
    assertEquals(r.enviouAoCliente, false);
    assertEquals(r.executou, true);
    assertEquals(efeitos.outboundProduzido, 2); // o Cérebro tinha 2 mensagens prontas
    assertEquals(efeitos.registrarChamado, 1); // …e nenhuma foi enviada; só registrou
  },
);

// ─── Teste-guardião do CONTRATO dos webhooks (Tarefa 9.2) ───────────────────
//
// Os DOIS webhooks chamam `executarCerebroSombra` mas têm de IGNORAR o retorno:
// nada da sombra pode virar envio ao cliente. Este teste lê o código-fonte dos
// dois webhooks e fixa esse contrato — se alguém atribuir o retorno do hook a
// uma variável e usá-lo para enviar, o teste quebra.
//
// **Validates: Requirements 3.3** — Property 6 (a sombra não envia, nem via
// integração nos webhooks).

const WEBHOOKS: Array<{ nome: string; url: URL }> = [
  { nome: "evolution-webhook", url: new URL("../../../evolution-webhook/index.ts", import.meta.url) },
  { nome: "whapi-webhook", url: new URL("../../../whapi-webhook/index.ts", import.meta.url) },
];

Deno.test(
  "guardião dos webhooks: o retorno de executarCerebroSombra é IGNORADO (não vira envio) (Req 3.3)",
  async () => {
    for (const { nome, url } of WEBHOOKS) {
      const fonte = await Deno.readTextFile(url);

      // 1) O webhook de fato chama o hook de sombra.
      assert(
        /await\s+executarCerebroSombra\s*\(/.test(fonte),
        `${nome}: deve chamar \`await executarCerebroSombra(\``,
      );

      // 2) A chamada NÃO é atribuída a nada — o retorno é descartado. Ou seja,
      //    não existe `const x = await executarCerebroSombra(...)` nem
      //    `x = executarCerebroSombra(...)`. Sem captura, é impossível derivar
      //    um envio a partir do resultado da sombra.
      assert(
        !/=\s*await\s+executarCerebroSombra\s*\(/.test(fonte),
        `${nome}: o retorno de executarCerebroSombra NÃO pode ser atribuído (deve ser ignorado)`,
      );
      assert(
        !/[\w$.\]]\s*=\s*executarCerebroSombra\s*\(/.test(fonte),
        `${nome}: o retorno de executarCerebroSombra NÃO pode ser atribuído (deve ser ignorado)`,
      );

      // 3) Não há campos do resultado de sombra sendo lidos para envio. Como o
      //    resultado nem é capturado, qualquer uso de `.enviouAoCliente`,
      //    `.outbound`/`.reply` derivado da sombra seria um acesso a um valor
      //    inexistente — proibido por contrato.
      assert(
        !/executarCerebroSombra\s*\([^;]*\)\s*\.\s*(outbound|reply|enviouAoCliente)/s.test(fonte),
        `${nome}: não pode encadear envio a partir do retorno da sombra`,
      );
    }
  },
);

// ─── Teste-guardião do CONTRATO de TIPO do hook ─────────────────────────────
//
// O hook declara a invariante no próprio tipo: `enviouAoCliente: false` (literal)
// e não expõe nenhuma dependência de envio. Lemos o código do hook para fixar
// isso — se a invariante de tipo for afrouxada (ex.: `enviouAoCliente: boolean`),
// o teste quebra.

Deno.test(
  "guardião do hook: ResultadoSombraHook trava enviouAoCliente como literal `false` (Req 3.3)",
  async () => {
    const fonte = await Deno.readTextFile(new URL("../sombra-hook.ts", import.meta.url));

    // A invariante de sombra é literal `false` no tipo de resultado.
    assert(
      /enviouAoCliente:\s*false/.test(fonte),
      "o hook deve declarar `enviouAoCliente: false` (literal) como invariante",
    );

    // O contrato de dependências do hook NÃO inclui nenhum mecanismo de envio:
    // não há `sendMessage`/`enviarMensagem`/`enviar` em `DependenciasSombra`.
    const blocoDeps = fonte.match(/interface\s+DependenciasSombra\s*\{[\s\S]*?\}/)?.[0] ?? "";
    assert(blocoDeps.length > 0, "deve existir a interface DependenciasSombra");
    assert(
      !/(sendMessage|enviarMensagem|\benviar\b|sendText|outbound)/i.test(blocoDeps),
      "DependenciasSombra não pode expor nenhuma dependência de envio",
    );
  },
);
