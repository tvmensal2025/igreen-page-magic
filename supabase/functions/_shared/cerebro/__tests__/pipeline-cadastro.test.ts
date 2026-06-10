// Testes-guardião do PIPELINE DE CADASTRO do Cérebro IA (pt-BR) — Tarefa 11.1.
//
// Spec: `.kiro/specs/cerebro-ia/design.md` — seções "Pipeline de cadastro" e
// "Não quebrar o worker do portal".
//
// Valida: Requisitos 16.1 e 16.3.
//   - 16.1: o Cérebro opera sem alterar/contornar as integrações críticas;
//   - 16.3: o roteamento/worker do portal permanece intacto (reúso, não reescrita).
//
// O QUE ESTES TESTES PROVAM
// -------------------------
// 1) O Cérebro só REPASSA a ação de finalização: a peça N3 (`extrairAcaoCadastro`)
//    apenas EXPÕE a `DeferredAction` de cadastro, sem executar nada.
// 2) A finalização (`portal_submit`) SÓ pode acionar `dispatchPortalWorker` — e
//    apenas com `(supabase, customerId)`, NUNCA montando payload nem chamando o
//    worker direto. Este é o único elo de execução do Cérebro para o portal.
// 3) Ações que NÃO são portal (`ocr`, `otp_submit`) NUNCA tocam o worker do
//    portal (ficam com o dispatcher existente / interceptação de OTP).
// 4) Auditoria de fronteira: o módulo `cerebro/` não importa `portal-worker.ts`
//    em lugar nenhum a não ser pelo repassador único (`despacho-cadastro.ts`),
//    e não faz `fetch`/monta payload de portal por conta própria.
//
// São testes puros (sem rede): o `dispatchPortalWorker` real é substituído por
// um espião injetado, então nada sai para o worker de verdade.
//
// Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/pipeline-cadastro.test.ts --no-check

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { extrairAcaoCadastro } from "../decisor-passo.ts";
import { despacharAcaoCadastro } from "../despacho-cadastro.ts";
import type { DispatchResult } from "../portal-worker.ts";
import type { AcaoCadastroDeferida, DeferredAction } from "../tipos.ts";

// ─── Fixtures de DeferredAction (formato real do motor — engine/types.ts) ────

const PORTAL_SUBMIT: AcaoCadastroDeferida = {
  kind: "portal_submit",
  stepId: "passo-finalizar",
  flowId: "fluxo-1",
  pipeline: "finalizar_cadastro",
};

const PORTAL_SUBMIT_CADASTRO: AcaoCadastroDeferida = {
  kind: "portal_submit",
  stepId: "passo-cadastro",
  flowId: "fluxo-1",
  pipeline: "cadastro_portal",
};

const OCR: AcaoCadastroDeferida = {
  kind: "ocr",
  stepId: "passo-conta",
  flowId: "fluxo-1",
  pipeline: "ocr_conta",
  mediaRef: "msg-123",
};

const OTP: AcaoCadastroDeferida = {
  kind: "otp_submit",
  stepId: "passo-otp",
  flowId: "fluxo-1",
  otpCode: "123456",
};

// Espião do helper de portal: registra os argumentos com que foi chamado, sem
// tocar a rede. Assinatura idêntica a `dispatchPortalWorker(supabase, customerId)`.
function fazerEspiaoPortal(resultado?: DispatchResult) {
  const chamadas: Array<{ supabase: unknown; customerId: string; nargs: number }> = [];
  // deno-lint-ignore no-explicit-any
  const fn = (...args: any[]): Promise<DispatchResult> => {
    chamadas.push({ supabase: args[0], customerId: args[1], nargs: args.length });
    return Promise.resolve(
      resultado ?? { ok: true, mode: "dispatched", status: 200, worker: "digital" },
    );
  };
  return { fn, chamadas };
}

// ─── 1) N3 só REPASSA: extrairAcaoCadastro seleciona, não executa ────────────

Deno.test("11.1: extrairAcaoCadastro EXPÕE portal_submit sem executar (só repassa)", () => {
  const acao = extrairAcaoCadastro(PORTAL_SUBMIT as DeferredAction);
  assert(acao, "deveria expor a ação de finalização");
  assertEquals(acao?.kind, "portal_submit");
  // É a MESMA ação do motor, sem reescrever campos (repasse puro).
  assertEquals(acao, PORTAL_SUBMIT);
});

Deno.test("11.1: extrairAcaoCadastro ignora deferred de IA (não vira ação de cadastro)", () => {
  const aiAnswer = {
    kind: "ai_answer",
    stepId: "s1",
    flowId: "f1",
    question: "quanto economizo?",
  } as unknown as DeferredAction;
  assertEquals(extrairAcaoCadastro(aiAnswer), undefined);
  // Sem deferred nenhum → sem ação de cadastro.
  assertEquals(extrairAcaoCadastro(undefined), undefined);
});

// ─── 2) finalizar_cadastro → SOMENTE dispatchPortalWorker(supabase, customerId) ─

Deno.test("11.1: portal_submit (finalizar_cadastro) aciona SOMENTE dispatchPortalWorker", async () => {
  const espiao = fazerEspiaoPortal();
  const supabase = { _fake: true };

  const r = await despacharAcaoCadastro({
    supabase,
    customerId: "cliente-1",
    acaoCadastro: PORTAL_SUBMIT,
    deps: { dispatchPortalWorker: espiao.fn },
  });

  // Roteou para o worker do portal e o acionou — pelo único caminho permitido.
  assertEquals(r.destino, "portal_worker");
  assert(r.acionouPortalWorker, "deveria ter acionado o dispatchPortalWorker");

  // Acionou EXATAMENTE uma vez, com (supabase, customerId) — nada de payload.
  assertEquals(espiao.chamadas.length, 1);
  assertEquals(espiao.chamadas[0].supabase, supabase);
  assertEquals(espiao.chamadas[0].customerId, "cliente-1");
  // Só dois argumentos: o Cérebro não monta nem passa payload de portal.
  assertEquals(espiao.chamadas[0].nargs, 2);
});

Deno.test("11.1: portal_submit (cadastro_portal) também vai por dispatchPortalWorker", async () => {
  const espiao = fazerEspiaoPortal();

  const r = await despacharAcaoCadastro({
    supabase: {},
    customerId: "cliente-2",
    acaoCadastro: PORTAL_SUBMIT_CADASTRO,
    deps: { dispatchPortalWorker: espiao.fn },
  });

  assertEquals(r.destino, "portal_worker");
  assertEquals(espiao.chamadas.length, 1);
  assertEquals(espiao.chamadas[0].customerId, "cliente-2");
});

Deno.test("11.1: o roteamento (digital × autoconexao) é decidido pelo helper, não pelo Cérebro", async () => {
  // O Cérebro não escolhe worker: ele só repassa. Aqui o helper devolve
  // 'autoconexao' e o Cérebro apenas observa o resultado — sem interferir.
  const espiao = fazerEspiaoPortal({
    ok: true,
    mode: "dispatched",
    status: 200,
    worker: "autoconexao",
  });

  const r = await despacharAcaoCadastro({
    supabase: {},
    customerId: "cliente-3",
    acaoCadastro: PORTAL_SUBMIT,
    deps: { dispatchPortalWorker: espiao.fn },
  });

  assertEquals(r.resultadoPortal?.worker, "autoconexao");
  // O Cérebro não passou nenhum hint de worker: só (supabase, customerId).
  assertEquals(espiao.chamadas[0].nargs, 2);
});

Deno.test("11.1: falha do worker é fail-open e ainda assim só passou por dispatchPortalWorker", async () => {
  const espiaoQueFalha = {
    chamadas: [] as string[],
    // deno-lint-ignore no-explicit-any
    fn: (_supabase: any, customerId: string): Promise<DispatchResult> => {
      espiaoQueFalha.chamadas.push(customerId);
      return Promise.reject(new Error("worker offline"));
    },
  };

  // Não deve lançar (fail-open).
  const r = await despacharAcaoCadastro({
    supabase: {},
    customerId: "cliente-4",
    acaoCadastro: PORTAL_SUBMIT,
    deps: { dispatchPortalWorker: espiaoQueFalha.fn },
  });

  assertEquals(r.destino, "portal_worker");
  assert(r.acionouPortalWorker);
  assertEquals(espiaoQueFalha.chamadas, ["cliente-4"]);
});

// ─── 3) Ações que NÃO são portal nunca tocam o worker do portal ──────────────

Deno.test("11.1: ocr NÃO aciona o worker do portal (fica com o dispatcher existente)", async () => {
  const espiao = fazerEspiaoPortal();

  const r = await despacharAcaoCadastro({
    supabase: {},
    customerId: "cliente-5",
    acaoCadastro: OCR,
    deps: { dispatchPortalWorker: espiao.fn },
  });

  assertEquals(r.destino, "dispatcher_existente");
  assertEquals(r.acionouPortalWorker, false);
  assertEquals(espiao.chamadas.length, 0); // worker do portal intocado
});

Deno.test("11.1: otp_submit NÃO aciona o worker do portal (fica com otp-intercept)", async () => {
  const espiao = fazerEspiaoPortal();

  const r = await despacharAcaoCadastro({
    supabase: {},
    customerId: "cliente-6",
    acaoCadastro: OTP,
    deps: { dispatchPortalWorker: espiao.fn },
  });

  assertEquals(r.destino, "otp_intercept");
  assertEquals(r.acionouPortalWorker, false);
  assertEquals(espiao.chamadas.length, 0);
});

// ─── 4) Auditoria de fronteira (não-regressão estrutural) ────────────────────
//
// Garante por inspeção de código que o Cérebro só toca o worker do portal pelo
// repassador único. Se uma tarefa futura introduzir um atalho (import direto de
// portal-worker fora de `despacho-cadastro.ts`, `fetch` de worker ou montagem
// de payload), estes testes quebram — sinalizando regressão da invariante 16.1.

const RAIZ_CEREBRO = new URL("../", import.meta.url);

async function lerArquivosTs(): Promise<Array<{ nome: string; texto: string }>> {
  const arquivos: Array<{ nome: string; texto: string }> = [];
  for await (const entry of Deno.readDir(RAIZ_CEREBRO)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const texto = await Deno.readTextFile(new URL(entry.name, RAIZ_CEREBRO));
    arquivos.push({ nome: entry.name, texto });
  }
  return arquivos;
}

Deno.test("11.1: só despacho-cadastro.ts importa portal-worker.ts (ponto único)", async () => {
  const arquivos = await lerArquivosTs();
  const importam = arquivos.filter((a) => /portal-worker\.ts/.test(a.texto));
  const nomes = importam.map((a) => a.nome).sort();
  // O único arquivo do núcleo do Cérebro autorizado a referenciar o helper é o
  // repassador. (Os testes em __tests__/ não entram aqui — só a raiz do módulo.)
  assertEquals(nomes, ["despacho-cadastro.ts"]);
});

Deno.test("11.1: o Cérebro não chama o worker direto nem monta payload de portal", async () => {
  const arquivos = await lerArquivosTs();
  for (const a of arquivos) {
    // Nenhuma URL de worker / fetch a worker no núcleo do Cérebro.
    assert(
      !/WORKER_PORTAL_URL|PORTAL2_WORKER_URL|portal_worker_url|portal2_worker_url/.test(a.texto),
      `${a.nome} referenciou URL de worker de portal (deveria reusar o helper)`,
    );
    assert(
      !/submit-lead/.test(a.texto),
      `${a.nome} chamou o endpoint do worker direto (deveria reusar o helper)`,
    );
  }
});
