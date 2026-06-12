// Testes da Property 9 — "Cliente em conversa não recomeça" (pt-BR) — Tarefa 12.3.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — "Correctness Properties":
//   ### Property 9: Cliente em conversa não recomeça
//   Ao virar a chave, cliente com cadastro parcial não é reiniciado: dados já
//   coletados são respeitados e ele entra no passo equivalente (ou vai a handoff).
//
// **Validates: Requirements 5.4, 14.1** — Property 9.
//
// FOCO desta suíte (NÃO duplica a 12.1/12.2)
// ------------------------------------------
// A 12.1 testa o MAPA (etapa → passo) e a 12.2 testa a APLICAÇÃO (entrar no
// passo / handoff) caso a caso. Esta suíte prova a INVARIANTE de não-reinício:
// para QUALQUER cliente com cadastro parcial (etapa antiga avançada + dados já
// coletados), o ponto de entrada NUNCA é o início do cadastro — é o passo
// equivalente correspondente (ou handoff), jamais `ask_quero_cadastrar`/
// `ask_name`. E os dados já coletados NÃO mudam (nem "pioram") essa decisão:
// a entrada é conservadora.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/migracao.property9.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import fc from "https://esm.sh/fast-check@3.23.2";

import {
  MAPA_ETAPA_PARA_PASSO,
  pontoDeEntradaMigracao,
} from "../migracao.ts";
import { ETAPAS_ORDER } from "../comum/types.ts";
import type { Etapa } from "../comum/types.ts";

// ─── Referências de "início do cadastro" ─────────────────────────────────────
//
// Os PRIMEIROS passos do cadastro no construtor visual. A invariante da
// Property 9 é que nenhum cliente já em conversa pode "voltar" para eles.
const PRIMEIROS_PASSOS_DO_CADASTRO: ReadonlySet<string> = new Set([
  "ask_quero_cadastrar", // porta de intenção (etapa antiga "interesse")
  "ask_name", // coleta do nome (etapa antiga "nome")
]);

// Etapas avançadas: o cliente já passou da intenção/nome. São exatamente as
// etapas posteriores a "nome" em ETAPAS_ORDER (a ordem da vendedora antiga).
const IDX_NOME = ETAPAS_ORDER.indexOf("nome");
const ETAPAS_AVANCADAS: Etapa[] = ETAPAS_ORDER.filter(
  (_etapa, idx) => idx > IDX_NOME,
);

// Subconjunto avançado que TEM passo equivalente (entra no passo, não handoff).
// Ex.: foto_conta, doc, email, finalizando, pos_cadastro.
const ETAPAS_AVANCADAS_COM_EQUIVALENTE: Etapa[] = ETAPAS_AVANCADAS.filter(
  (etapa) => MAPA_ETAPA_PARA_PASSO[etapa] !== null,
);

// Monta um `EstadoCerebro` mínimo com a etapa antiga e os dados já coletados na
// camada operacional, como a N8 (`montarMemoriaEmCamadas`) preserva o
// `fluxo_b_state` cru.
function estadoComEtapa(
  etapa: unknown,
  info: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    snapshot: {},
    memoria: {
      sessao: null,
      perfil: {},
      operacional: {
        currentStepId: null,
        fluxoBState: { etapa, info },
      },
    },
  };
}

// ─── Geradores ───────────────────────────────────────────────────────────────

// Uma etapa avançada qualquer (já passou de interesse/nome).
const etapaAvancadaArb = fc.constantFrom(...ETAPAS_AVANCADAS);

// Uma etapa avançada que tem passo equivalente.
const etapaAvancadaComEquivalenteArb = fc.constantFrom(
  ...ETAPAS_AVANCADAS_COM_EQUIVALENTE,
);

// Um "info" plausível de cadastro parcial: dados que o cliente já forneceu.
// Chaves típicas do fluxo (nome/valor/email/cpf/...) com valores arbitrários.
const infoColetadoArb = fc.record(
  {
    nome: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    valor: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
    email: fc.option(fc.emailAddress(), { nil: undefined }),
    cpf: fc.option(fc.string({ minLength: 11, maxLength: 14 }), { nil: undefined }),
    cidade: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  },
  { requiredKeys: [] },
);

// ─── Property 9 (a) — etapa avançada NUNCA volta ao início ───────────────────
//
// Para QUALQUER etapa avançada e QUALQUER conjunto de dados já coletados, a
// decisão NUNCA é "entrar" num dos primeiros passos do cadastro. Ou entra num
// passo posterior (equivalente), ou faz handoff — jamais recomeça.

Deno.test(
  "Property 9a: cliente em etapa avançada nunca recomeça no início do cadastro (Req 5.4, 14.1)",
  () => {
    fc.assert(
      fc.property(etapaAvancadaArb, infoColetadoArb, (etapa, info) => {
        const decisao = pontoDeEntradaMigracao(estadoComEtapa(etapa, info));

        if (decisao.acao === "entrar_no_passo") {
          // O passo de entrada NÃO pode ser um dos primeiros passos.
          assert(
            !PRIMEIROS_PASSOS_DO_CADASTRO.has(decisao.stepKey),
            `etapa avançada "${etapa}" não pode entrar no início ("${decisao.stepKey}")`,
          );
        } else {
          // A alternativa é handoff (também não reinicia).
          assertEquals(decisao.acao, "handoff");
        }
      }),
    );
  },
);

// ─── Property 9 (b) — etapa avançada com equivalente entra no passo certo ────
//
// Quando há equivalente, o cliente entra EXATAMENTE no passo correspondente do
// mapa (ex.: foto_conta → aguardando_conta), nunca em handoff e nunca no início.

Deno.test(
  "Property 9b: etapa avançada com equivalente entra no passo correspondente, não no início (Req 5.4, 14.1)",
  () => {
    fc.assert(
      fc.property(
        etapaAvancadaComEquivalenteArb,
        infoColetadoArb,
        (etapa, info) => {
          const passo = MAPA_ETAPA_PARA_PASSO[etapa]!; // garantido não-nulo
          const decisao = pontoDeEntradaMigracao(estadoComEtapa(etapa, info));

          // Entra no passo equivalente exato.
          assertEquals(decisao, {
            acao: "entrar_no_passo",
            stepKey: passo.stepKey,
          });
          // E confirma que esse passo não é o começo do cadastro.
          assert(
            !PRIMEIROS_PASSOS_DO_CADASTRO.has(passo.stepKey),
            `passo equivalente de "${etapa}" não pode ser início`,
          );
        },
      ),
    );
  },
);

// ─── Property 9 (c) — dados já coletados são respeitados (entrada conservadora) ─
//
// A decisão de ponto de entrada depende SÓ da etapa antiga, não dos dados já
// coletados: ter ou não ter dados não muda o passo. Isso prova que os dados não
// são descartados nem provocam reinício — a entrada é conservadora e estável.

Deno.test(
  "Property 9c: dados já coletados não alteram o ponto de entrada (entrada conservadora) (Req 5.4)",
  () => {
    fc.assert(
      fc.property(etapaAvancadaArb, infoColetadoArb, (etapa, info) => {
        const semDados = pontoDeEntradaMigracao(estadoComEtapa(etapa, {}));
        const comDados = pontoDeEntradaMigracao(estadoComEtapa(etapa, info));
        // Mesma etapa → mesma decisão, independentemente do que já foi coletado.
        assertEquals(comDados, semDados);
      }),
    );
  },
);

// ─── Property 9 (d) — exemplos concretos de cadastro parcial avançado ────────
//
// Casos "de manual" pedidos pela 12.3: cliente em foto_conta / doc / email /
// finalizando, com dados já coletados, entra no passo equivalente e jamais em
// ask_quero_cadastrar / ask_name.

Deno.test(
  "Property 9 (exemplos): foto_conta/doc/email/finalizando com dados entram no passo equivalente, nunca no início (Req 5.4, 14.1)",
  () => {
    const exemplos: Array<{
      etapa: Etapa;
      info: Record<string, unknown>;
      stepKeyEsperado: string;
    }> = [
      {
        etapa: "foto_conta",
        info: { nome: "Maria", valor: "450" },
        stepKeyEsperado: "aguardando_conta",
      },
      {
        etapa: "doc",
        info: { nome: "João", valor: "300", cpf: "12345678901" },
        stepKeyEsperado: "ask_tipo_documento",
      },
      {
        etapa: "email",
        info: { nome: "Ana", valor: "700", cpf: "98765432100" },
        stepKeyEsperado: "ask_email",
      },
      {
        etapa: "finalizando",
        info: {
          nome: "Carlos",
          valor: "1200",
          email: "carlos@example.com",
          cpf: "11122233344",
        },
        stepKeyEsperado: "finalizando",
      },
    ];

    for (const { etapa, info, stepKeyEsperado } of exemplos) {
      const decisao = pontoDeEntradaMigracao(estadoComEtapa(etapa, info));
      assertEquals(
        decisao,
        { acao: "entrar_no_passo", stepKey: stepKeyEsperado },
        `etapa "${etapa}" deveria entrar em "${stepKeyEsperado}"`,
      );
      // Invariante central da Property 9: nunca o início do cadastro.
      assert(
        decisao.acao === "entrar_no_passo" &&
          !PRIMEIROS_PASSOS_DO_CADASTRO.has(decisao.stepKey),
        `etapa "${etapa}" não pode reiniciar no início do cadastro`,
      );
    }
  },
);

// ─── Property 9 (e) — sanidade dos conjuntos de etapas ───────────────────────
//
// Garante que estamos de fato exercitando etapas avançadas (e não um conjunto
// vazio), e que os primeiros passos do cadastro estão fora desse conjunto.

Deno.test("Property 9 (sanidade): há etapas avançadas e elas não incluem interesse/nome", () => {
  assert(ETAPAS_AVANCADAS.length > 0, "deveria haver etapas avançadas");
  assert(
    ETAPAS_AVANCADAS_COM_EQUIVALENTE.length > 0,
    "deveria haver etapas avançadas com equivalente",
  );
  assert(!ETAPAS_AVANCADAS.includes("interesse"), "interesse não é avançada");
  assert(!ETAPAS_AVANCADAS.includes("nome"), "nome não é avançada");
});
