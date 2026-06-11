// Testes do MODO NÚMERO DE TESTE do hook de resposta do Cérebro (pt-BR).
//
// O QUE PROVAMOS
// --------------
//   (1) `ehNumeroDeTeste` casa por dígitos, tolerando DDI/9º dígito e formatação.
//   (2) Número FORA da lista nunca é tratado como teste.
//   (3) Lista vazia → ninguém é número de teste (fail-safe).
//   (4) `deveResponderComCerebro` libera o Cérebro para o número de teste MESMO
//       em `dark`/`off` (motivo = "numero_teste"), lendo a lista do banco.
//   (5) Número normal em `dark`/`off` continua NÃO respondendo (cai na vendedora).
//
// ESTRATÉGIA: a lista vem de `rollout_config.cerebro_numeros_teste`. Mockamos o
// supabase com um `.from().select().eq().single()` que devolve o CSV desejado.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/numero-teste.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  deveResponderComCerebro,
  ehNumeroDeTeste,
  limparCacheNumerosTeste,
  soDigitos,
} from "../resposta-hook.ts";
import type { FlowEngineV3Flag } from "../../feature-flag.ts";

/** Supabase falso: devolve o CSV de números de teste de rollout_config. */
function fakeSupabase(csv: string | null) {
  return {
    from(_tabela: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: unknown) {
              return {
                single() {
                  return Promise.resolve({
                    data: { cerebro_numeros_teste: csv },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
}

function depsComFlag(flag: FlowEngineV3Flag) {
  return { lerFlag: async () => flag };
}

Deno.test("soDigitos: remove tudo que não é dígito", () => {
  assertEquals(soDigitos("+55 (11) 97125-4913"), "5511971254913");
  assertEquals(soDigitos(null), "");
  assertEquals(soDigitos(undefined), "");
});

Deno.test("ehNumeroDeTeste: casa por sufixo (DDI/9º dígito) e formatação", () => {
  const lista = new Set(["11971254913"]);
  assert(ehNumeroDeTeste("5511971254913", lista));
  assert(ehNumeroDeTeste("+55 11 97125-4913", lista));
  assert(ehNumeroDeTeste("11971254913", lista));
});

Deno.test("ehNumeroDeTeste: número fora da lista nunca é teste", () => {
  const lista = new Set(["11971254913"]);
  assert(!ehNumeroDeTeste("5511999990000", lista));
  assert(!ehNumeroDeTeste("", lista));
  assert(!ehNumeroDeTeste(null, lista));
});

Deno.test("ehNumeroDeTeste: lista vazia → ninguém é número de teste", () => {
  assert(!ehNumeroDeTeste("5511971254913", new Set()));
});

Deno.test("deveResponderComCerebro: número de teste responde MESMO em dark (lendo do banco)", async () => {
  limparCacheNumerosTeste();
  const sb = fakeSupabase("11971254913");
  const decisao = await deveResponderComCerebro(
    sb,
    "consultor-x",
    depsComFlag("dark"),
    "5511971254913",
  );
  assertEquals(decisao.responder, true);
  assertEquals(decisao.flag, "dark");
  assertEquals(decisao.motivo, "numero_teste");
});

Deno.test("deveResponderComCerebro: número normal em dark NÃO responde", async () => {
  limparCacheNumerosTeste();
  const sb = fakeSupabase("11971254913");
  const decisao = await deveResponderComCerebro(
    sb,
    "consultor-x",
    depsComFlag("dark"),
    "5511999990000",
  );
  assertEquals(decisao.responder, false);
  assertEquals(decisao.motivo, "flag");
});

Deno.test("deveResponderComCerebro: lista vazia no banco → número de teste não vale (fail-safe)", async () => {
  limparCacheNumerosTeste();
  const sb = fakeSupabase(null);
  const decisao = await deveResponderComCerebro(
    sb,
    "consultor-x",
    depsComFlag("dark"),
    "5511971254913",
  );
  assertEquals(decisao.responder, false);
  assertEquals(decisao.motivo, "flag");
});

Deno.test("deveResponderComCerebro: em on responde por flag (motivo=flag)", async () => {
  limparCacheNumerosTeste();
  const sb = fakeSupabase(null);
  const decisao = await deveResponderComCerebro(
    sb,
    "consultor-x",
    depsComFlag("on"),
    "5511999990000",
  );
  assertEquals(decisao.responder, true);
  assertEquals(decisao.motivo, "flag");
});

// ─── Flag DEDICADA cerebro_ativo ────────────────────────────────────────────
// Supabase falso que devolve cerebro_ativo e (na outra tabela) os números.
function fakeSupabaseComCerebroAtivo(opts: {
  cerebroAtivo?: string;
  numerosCsv?: string | null;
}) {
  return {
    from(tabela: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c: string, _v: unknown) {
              return {
                single() {
                  if (tabela === "consultants") {
                    return Promise.resolve({
                      data: { cerebro_ativo: opts.cerebroAtivo ?? "off" },
                      error: null,
                    });
                  }
                  // rollout_config
                  return Promise.resolve({
                    data: { cerebro_numeros_teste: opts.numerosCsv ?? null },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
}

Deno.test("deveResponderComCerebro: cerebro_ativo=on responde mesmo com flow_engine_v3 em dark", async () => {
  limparCacheNumerosTeste();
  // Importa o cache da flag dedicada para limpar entre testes.
  const { clearCerebroAtivoCache } = await import("../../feature-flag.ts");
  clearCerebroAtivoCache();
  const sb = fakeSupabaseComCerebroAtivo({ cerebroAtivo: "on", numerosCsv: null });
  const decisao = await deveResponderComCerebro(
    sb,
    "consultor-on",
    depsComFlag("dark"),
    "5511999990000",
  );
  assertEquals(decisao.responder, true);
  assertEquals(decisao.motivo, "cerebro_ativo");
});

Deno.test("deveResponderComCerebro: cerebro_ativo=off + flag dark → não responde", async () => {
  limparCacheNumerosTeste();
  const { clearCerebroAtivoCache } = await import("../../feature-flag.ts");
  clearCerebroAtivoCache();
  const sb = fakeSupabaseComCerebroAtivo({ cerebroAtivo: "off", numerosCsv: null });
  const decisao = await deveResponderComCerebro(
    sb,
    "consultor-off",
    depsComFlag("dark"),
    "5511999990000",
  );
  assertEquals(decisao.responder, false);
  assertEquals(decisao.motivo, "flag");
});
