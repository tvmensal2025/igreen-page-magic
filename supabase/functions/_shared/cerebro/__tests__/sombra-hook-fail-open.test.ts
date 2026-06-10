// Testes de FAIL-OPEN / NÃO-INTERFERÊNCIA do hook de SOMBRA — Tarefa 9.3.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — "Error Handling" e "Ativação
// segura". Requisitos 16.1, 16.2, 16.3: o Cérebro NUNCA bloqueia nem altera o
// caminho atual (vendedora/engine), e isso vale para os DOIS webhooks.
//
// FOCO (sem duplicar a 9.1)
// -------------------------
// A 9.1 já prova: gate por estágio, registro em `dark`, e fail-open para erro
// no Cérebro e na leitura da flag. AQUI provamos a GARANTIA DE NÃO-INTERFERÊNCIA
// em si — qualquer erro do Cérebro (em qualquer camada) resulta em:
//   (a) o hook NUNCA lançar/rejeitar; e
//   (b) o CAMINHO ATUAL seguir intacto, na ordem e sem efeito colateral.
//
// As três camadas que sustentam a garantia (todas exercitadas aqui):
//   1. hook fail-open (try/catch geral em `executarCerebroSombra`);
//   2. chamada no webhook protegida por try/catch próprio (simulada abaixo);
//   3. `processarTurno` (N1) fail-open com teto de 25s (mockado a falhar de
//      todas as formas: throw síncrono e promise rejeitada).
//
// ESTRATÉGIA (isolado, sem rede): injetamos `deps` por mocks que FALHAM de
// propósito, e cercamos a chamada com um "caminho atual" sentinela para provar
// que ele continua rodando mesmo com o Cérebro quebrado.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/sombra-hook-fail-open.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  executarCerebroSombra,
  type DependenciasSombra,
  type EntradaSombraHook,
} from "../sombra-hook.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SUPABASE_INERTE = {
  from() {
    throw new Error("não deveria ser usado nos mocks");
  },
};

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

/** Resultado válido do Cérebro (quando precisamos que o turno "rode"). */
// deno-lint-ignore no-explicit-any
function resultadoCerebroOk(): any {
  return {
    reply: "Olá!",
    outbound: [{ kind: "text", text: "Olá!", idempotencyContent: "Olá!" }],
    stateUpdate: {},
    shouldHandoff: false,
    decisao: { passoAtualId: "passo-1", proximoPassoId: "passo-2", intencao: "demonstrar_interesse" },
  };
}

/**
 * Simula o ponto de chamada dos DOIS webhooks: o hook é invocado dentro de um
 * try/catch próprio (camada 2) e, logo depois, o CAMINHO ATUAL roda. Devolve a
 * ordem dos eventos observados para provar a não-interferência.
 */
async function simularWebhook(
  entrada: EntradaSombraHook,
): Promise<{ eventos: string[]; hookRejeitou: boolean; caminhoAtualRodou: boolean }> {
  const eventos: string[] = [];
  let hookRejeitou = false;
  let caminhoAtualRodou = false;

  // Camada 2: try/catch no webhook (espelha evolution-webhook e whapi-webhook).
  try {
    eventos.push("antes-hook");
    await executarCerebroSombra(entrada);
    eventos.push("depois-hook");
  } catch (_e) {
    // Se cairmos aqui, o hook propagou erro — violação do fail-open.
    hookRejeitou = true;
    eventos.push("hook-lancou");
  }

  // CAMINHO ATUAL (vendedora/engine): tem de rodar SEMPRE, intacto.
  caminhoAtualRodou = true;
  eventos.push("caminho-atual");

  return { eventos, hookRejeitou, caminhoAtualRodou };
}

// ─── Camada 3: processarTurno falha de TODAS as formas ──────────────────────

Deno.test("não-interferência: processarTurno com throw síncrono não bloqueia o caminho atual (Req 16.1)", async () => {
  const deps: DependenciasSombra = {
    lerFlag: () => Promise.resolve("dark"),
    processarTurno: () => {
      throw new Error("falha síncrona no Cérebro");
    },
    registrarDecisaoSombra: () => Promise.resolve({ ok: true, coincide: true }),
  };

  const { eventos, hookRejeitou, caminhoAtualRodou } = await simularWebhook(
    entradaBase({ deps }),
  );

  assertEquals(hookRejeitou, false);
  assertEquals(caminhoAtualRodou, true);
  // O caminho atual roda DEPOIS do hook retornar, sem interrupção.
  assertEquals(eventos, ["antes-hook", "depois-hook", "caminho-atual"]);
});

Deno.test("não-interferência: processarTurno com PROMISE REJEITADA não bloqueia o caminho atual (Req 16.1)", async () => {
  const deps: DependenciasSombra = {
    lerFlag: () => Promise.resolve("dark"),
    processarTurno: () => Promise.reject(new Error("rejeição assíncrona no Cérebro")),
    registrarDecisaoSombra: () => Promise.resolve({ ok: true, coincide: true }),
  };

  const r = await executarCerebroSombra(entradaBase({ deps }));
  // Devolve neutro, sem lançar (fail-open).
  assertEquals(r.executou, false);
  assertEquals(r.enviouAoCliente, false);

  const { eventos, hookRejeitou, caminhoAtualRodou } = await simularWebhook(
    entradaBase({ deps }),
  );
  assertEquals(hookRejeitou, false);
  assertEquals(caminhoAtualRodou, true);
  assertEquals(eventos, ["antes-hook", "depois-hook", "caminho-atual"]);
});

// ─── Camada 1: erro no REGISTRADOR (gravação em ai_decisions) ───────────────

Deno.test("não-interferência: erro no registrador não bloqueia o caminho atual (Req 16.1)", async () => {
  let processou = 0;
  const deps: DependenciasSombra = {
    lerFlag: () => Promise.resolve("dark"),
    processarTurno: () => {
      processou++;
      return Promise.resolve(resultadoCerebroOk());
    },
    registrarDecisaoSombra: () => {
      throw new Error("falha ao gravar em ai_decisions");
    },
  };

  const r = await executarCerebroSombra(entradaBase({ deps }));
  // O Cérebro rodou, mas a gravação falhou: hook devolve neutro, sem lançar.
  assertEquals(r.executou, false);
  assertEquals(r.registrou, false);
  assertEquals(r.enviouAoCliente, false);
  assertEquals(processou, 1);

  const { hookRejeitou, caminhoAtualRodou } = await simularWebhook(
    entradaBase({ deps }),
  );
  assertEquals(hookRejeitou, false);
  assertEquals(caminhoAtualRodou, true);
});

Deno.test("não-interferência: registrador com PROMISE REJEITADA não bloqueia o caminho atual (Req 16.1)", async () => {
  const deps: DependenciasSombra = {
    lerFlag: () => Promise.resolve("dark"),
    processarTurno: () => Promise.resolve(resultadoCerebroOk()),
    registrarDecisaoSombra: () => Promise.reject(new Error("rejeição ao gravar")),
  };

  const r = await executarCerebroSombra(entradaBase({ deps }));
  assertEquals(r.executou, false);
  assertEquals(r.enviouAoCliente, false);

  const { hookRejeitou, caminhoAtualRodou } = await simularWebhook(
    entradaBase({ deps }),
  );
  assertEquals(hookRejeitou, false);
  assertEquals(caminhoAtualRodou, true);
});

// ─── Camada 1: erro na LEITURA DA FLAG ──────────────────────────────────────

Deno.test("não-interferência: erro ao ler a flag não bloqueia o caminho atual e não roda o Cérebro (Req 16.1)", async () => {
  let processou = 0;
  const deps: DependenciasSombra = {
    lerFlag: () => {
      throw new Error("falha ao ler flow_engine_v3");
    },
    processarTurno: () => {
      processou++;
      return Promise.resolve(resultadoCerebroOk());
    },
    registrarDecisaoSombra: () => Promise.resolve({ ok: true, coincide: true }),
  };

  const r = await executarCerebroSombra(entradaBase({ deps }));
  assertEquals(r.executou, false);
  // Falhou ANTES de decidir rodar: o Cérebro nem foi chamado.
  assertEquals(processou, 0);

  const { hookRejeitou, caminhoAtualRodou } = await simularWebhook(
    entradaBase({ deps }),
  );
  assertEquals(hookRejeitou, false);
  assertEquals(caminhoAtualRodou, true);
});

// ─── Garantia para os DOIS webhooks (Req 16.2, 16.3) ────────────────────────

Deno.test("não-interferência: a garantia vale para evolution E whapi (Req 16.2, 16.3)", async () => {
  // Tudo quebrado de uma vez: flag ok em `dark`, Cérebro lança, registrador lança.
  const deps: DependenciasSombra = {
    lerFlag: () => Promise.resolve("dark"),
    processarTurno: () => {
      throw new Error("Cérebro caiu");
    },
    registrarDecisaoSombra: () => {
      throw new Error("registrador caiu");
    },
  };

  for (const channel of ["evolution", "whapi"] as const) {
    const { eventos, hookRejeitou, caminhoAtualRodou } = await simularWebhook(
      entradaBase({ deps, channel }),
    );
    assertEquals(hookRejeitou, false, `hook não pode lançar no canal ${channel}`);
    assertEquals(caminhoAtualRodou, true, `caminho atual deve rodar no canal ${channel}`);
    assertEquals(eventos, ["antes-hook", "depois-hook", "caminho-atual"]);
  }
});

// ─── Não-interferência: a entrada do webhook NÃO é mutada pelo hook ─────────

Deno.test("não-interferência: o hook não altera a entrada vinda do webhook (Req 16.3)", async () => {
  const deps: DependenciasSombra = {
    lerFlag: () => Promise.resolve("dark"),
    processarTurno: () => Promise.resolve(resultadoCerebroOk()),
    registrarDecisaoSombra: () => Promise.resolve({ ok: true, coincide: true }),
  };
  const entrada = entradaBase({ deps });
  const snapshot = {
    customerId: entrada.customerId,
    consultantId: entrada.consultantId,
    legacyStep: entrada.legacyStep,
    inboundText: entrada.inboundText,
    channel: entrada.channel,
  };

  await executarCerebroSombra(entrada);

  // O hook só observa: os campos de entrada do caminho atual ficam intactos.
  assertEquals(entrada.customerId, snapshot.customerId);
  assertEquals(entrada.consultantId, snapshot.consultantId);
  assertEquals(entrada.legacyStep, snapshot.legacyStep);
  assertEquals(entrada.inboundText, snapshot.inboundText);
  assertEquals(entrada.channel, snapshot.channel);
});

// ─── Sanidade: em `dark` saudável o hook funciona e mesmo assim NADA é enviado ─

Deno.test("sanidade: em `dark` sem erros o hook roda e NÃO envia ao cliente (invariante de sombra)", async () => {
  const deps: DependenciasSombra = {
    lerFlag: () => Promise.resolve("dark"),
    processarTurno: () => Promise.resolve(resultadoCerebroOk()),
    registrarDecisaoSombra: () => Promise.resolve({ ok: true, coincide: true }),
  };
  const r = await executarCerebroSombra(entradaBase({ deps }));
  assertEquals(r.executou, true);
  assert(r.enviouAoCliente === false);
});
