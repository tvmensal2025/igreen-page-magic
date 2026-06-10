// Testes unitários da peça N3 — Decisor de Passo (pt-BR).
//
// Spec: `.kiro/specs/cerebro-ia/` — Tarefa 4.2.
//   - 4.2: uma única fonte de etapa (a do fluxo); sem detector de etapa por IA.
//
// Valida: Requisito 6.4 (o Decisor usa uma ÚNICA fonte para a etapa atual,
// derivada do fluxo determinístico, sem manter um detector de etapa por IA em
// paralelo).
//
// Estes testes exercitam a FONTE ÚNICA DE ETAPA (`derivarEtapas`), que é a
// única função do Cérebro autorizada a dizer em que passo o cliente está e para
// qual ele vai. A invariante verificada aqui: a etapa nasce SOMENTE de
// `flow.steps` cruzado com os ids do fluxo determinístico — nenhuma entrada de
// IA (intenção/dados/objeção da peça N2) participa.
//
// São puros (sem rede nem mocks). Rodar:
//   deno test supabase/functions/_shared/cerebro/__tests__/decisor-passo.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { derivarEtapas, detectarReparo, extrairAcaoCadastro } from "../decisor-passo.ts";
import type {
  BotFlowStep,
  DeferredAction,
  InboundEvent,
  ResultadoEntendimento,
} from "../tipos.ts";

// Fixture mínimo de passo do fluxo (apenas os campos relevantes ao teste; o
// resto é preenchido com valores neutros para satisfazer o tipo). A ORDEM é
// dada por `position`, como em `bot_flow_steps` — nunca por sequência fixa.
function passo(id: string, position: number): BotFlowStep {
  return {
    id,
    flowId: "fluxo-1",
    stepKey: id,
    stepType: "text_message",
    position,
    messageText: `mensagem ${id}`,
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
  };
}

const STEPS: BotFlowStep[] = [
  passo("passo-a", 0),
  passo("passo-b", 1),
  passo("passo-c", 2),
];

Deno.test("derivarEtapas: passo atual e próximo vêm do fluxo (ids do motor)", () => {
  // Cliente estava em 'passo-a'; o motor decidiu avançar para 'passo-b'.
  const { passoAtual, proximoPasso } = derivarEtapas(STEPS, "passo-a", "passo-b");
  assertEquals(passoAtual?.id, "passo-a");
  assertEquals(proximoPasso?.id, "passo-b");
});

Deno.test("derivarEtapas: sem próximo do motor, a etapa permanece a atual (do fluxo)", () => {
  // O motor não trocou de passo neste turno (idProximo = null) → mantém o atual.
  const { passoAtual, proximoPasso } = derivarEtapas(STEPS, "passo-b", null);
  assertEquals(passoAtual?.id, "passo-b");
  assertEquals(proximoPasso?.id, "passo-b");
});

Deno.test("derivarEtapas: cliente novo (sem passo atual) → passoAtual null", () => {
  // Lead recém-chegado: `state.currentStepId` é null. O motor manda começar.
  const { passoAtual, proximoPasso } = derivarEtapas(STEPS, null, "passo-a");
  assertEquals(passoAtual, null);
  assertEquals(proximoPasso?.id, "passo-a");
});

Deno.test("derivarEtapas: id que não existe mais no fluxo resolve para null", () => {
  // Passo removido no construtor visual: o id antigo não está em `flow.steps`.
  const { passoAtual, proximoPasso } = derivarEtapas(STEPS, "passo-removido", "passo-c");
  assertEquals(passoAtual, null);
  assertEquals(proximoPasso?.id, "passo-c");
});

Deno.test("derivarEtapas: a ORDEM dos passos vem dos dados, não de sequência fixa", () => {
  // Reordenar os passos (como faria o consultor no construtor) muda a etapa
  // resolvida sem qualquer alteração de código — Requisito 6.2/6.3 reforçando
  // que a fonte é o fluxo, não o código.
  const reordenado = [passo("passo-c", 0), passo("passo-a", 1), passo("passo-b", 2)];
  const { proximoPasso } = derivarEtapas(reordenado, "passo-a", "passo-c");
  assertEquals(proximoPasso?.id, "passo-c");
  assertEquals(proximoPasso?.position, 0);
});

Deno.test("INVARIANTE 6.4: derivarEtapas só depende de (steps, idAtual, idProximo)", () => {
  // A FONTE ÚNICA DE ETAPA não recebe — e não pode receber — nenhum sinal de
  // IA (intenção, dados ou objeção da peça N2). A assinatura da função, com
  // exatamente três parâmetros vindos do fluxo determinístico, é a garantia
  // estática dessa invariante. Confirmamos aqui que ela é puramente função
  // desses três argumentos: mesma entrada → mesma saída.
  assertEquals(derivarEtapas.length, 3);

  const primeira = derivarEtapas(STEPS, "passo-a", "passo-b");
  const segunda = derivarEtapas(STEPS, "passo-a", "passo-b");
  assertEquals(primeira.passoAtual?.id, segunda.passoAtual?.id);
  assertEquals(primeira.proximoPasso?.id, segunda.proximoPasso?.id);

  // E que o resultado aponta para objetos pertencentes à lista de passos do
  // fluxo (mesma referência) — ou seja, a etapa É um passo do fluxo, não algo
  // fabricado por outra fonte.
  assert(STEPS.includes(primeira.passoAtual as BotFlowStep));
  assert(STEPS.includes(primeira.proximoPasso as BotFlowStep));
});

// ─── Padrões de reparo (Tarefa 4.3) ─────────────────────────────────────────
//
// Valida: Requisitos 6.5 (correção de dado), 6.6 (dúvida fora de hora) e 6.7
// (cancelamento). Os reparos são REGRA em TS (inspirados no `patterns.yml` do
// CALM) e SÓ anotam o tipo + reancoram usando os passos do fluxo — nunca criam
// uma segunda fonte de etapa. Por isso a reancoragem aqui sempre aponta para um
// passo presente em `flow.steps`.

// Passo com captura de um campo (para o reparo de correção achar o passo certo).
function passoComCaptura(id: string, position: number, field: string): BotFlowStep {
  const p = passo(id, position);
  p.stepType = "ask_text";
  p.captures = [{ field, enabled: true } as unknown as BotFlowStep["captures"][number]];
  return p;
}

// Entendimento neutro (turno normal). Cada teste sobrescreve o que precisa.
function entendimento(
  over: Partial<ResultadoEntendimento> = {},
): ResultadoEntendimento {
  return { intencao: "indefinido", dados: {}, ...over };
}

const txt = (text: string): InboundEvent => ({ kind: "text", text });

Deno.test("reparo 6.7: cliente pede cancelar → reparo 'cancelamento' + reancora no passo do fluxo", () => {
  const steps = [passo("intro", 0), passo("cancelar_fluxo", 1), passo("coleta", 2)];
  const atual = steps[2];
  const { reparo, passoReancoragem } = detectarReparo(
    entendimento({ intencao: "desistir" }),
    txt("quero cancelar isso"),
    atual,
    steps[2],
    steps,
  );
  assertEquals(reparo, "cancelamento");
  // Reancora no passo de cancelamento modelado no fluxo (stepKey casa /cancel/).
  assertEquals(passoReancoragem?.id, "cancelar_fluxo");
  assert(steps.includes(passoReancoragem as BotFlowStep));
});

Deno.test("reparo 6.7: cancelamento por marcador no texto mesmo sem intenção 'desistir'", () => {
  const steps = [passo("intro", 0), passo("coleta", 1)];
  const { reparo } = detectarReparo(
    entendimento(),
    txt("pode parar, chega"),
    steps[1],
    steps[1],
    steps,
  );
  assertEquals(reparo, "cancelamento");
});

Deno.test("reparo 6.5: cliente corrige um dado → reparo 'correcao_dado' + retoma o passo que captura o dado", () => {
  const steps = [
    passo("intro", 0),
    passoComCaptura("pede_nome", 1, "nome"),
    passoComCaptura("pede_valor", 2, "valor_conta"),
    passo("confirma", 3),
  ];
  const atual = steps[3]; // cliente já estava confirmando
  const { reparo, passoReancoragem } = detectarReparo(
    entendimento({ dados: { nome: "Larissa" } }),
    txt("na verdade meu nome é Larissa"),
    atual,
    atual,
    steps,
  );
  assertEquals(reparo, "correcao_dado");
  // Retoma o passo apropriado do fluxo (o que captura 'nome'), não inventa etapa.
  assertEquals(passoReancoragem?.id, "pede_nome");
  assert(steps.includes(passoReancoragem as BotFlowStep));
});

Deno.test("reparo 6.5: correção sem passo de captura correspondente mantém a etapa atual (sem inventar destino)", () => {
  const steps = [passo("intro", 0), passo("confirma", 1)]; // nenhum passo captura 'nome'
  const atual = steps[1];
  const { reparo, passoReancoragem } = detectarReparo(
    entendimento({ dados: { nome: "Larissa" } }),
    txt("errei, na verdade é Larissa"),
    atual,
    atual,
    steps,
  );
  assertEquals(reparo, "correcao_dado");
  assertEquals(passoReancoragem?.id, "confirma"); // permanece na etapa atual do fluxo
});

Deno.test("reparo 6.6: pergunta fora de hora → reparo 'duvida_fora_de_hora' + reancora no passo atual", () => {
  const steps = [passo("intro", 0), passo("pede_valor", 1)];
  const atual = steps[1];
  const { reparo, passoReancoragem } = detectarReparo(
    entendimento({ intencao: "indefinido" }),
    txt("isso funciona em apartamento?"),
    atual,
    atual,
    steps,
  );
  assertEquals(reparo, "duvida_fora_de_hora");
  assertEquals(passoReancoragem?.id, "pede_valor"); // reancora na etapa atual do fluxo
});

Deno.test("reparo: turno normal (sem marcador, sem pergunta) → sem reparo, sem reancoragem", () => {
  const steps = [passo("intro", 0), passo("pede_valor", 1)];
  const { reparo, passoReancoragem } = detectarReparo(
    entendimento({ intencao: "demonstrar_interesse" }),
    txt("quero economizar na conta de luz"),
    steps[1],
    steps[1],
    steps,
  );
  assertEquals(reparo, undefined);
  assertEquals(passoReancoragem, undefined); // segue o próximo passo do motor
});

Deno.test("reparo: cancelamento tem prioridade sobre correção quando ambos aparecem", () => {
  const steps = [passo("cancelar", 0), passoComCaptura("pede_nome", 1, "nome")];
  const { reparo } = detectarReparo(
    entendimento({ dados: { nome: "Ana" } }),
    txt("na verdade quero cancelar"),
    steps[1],
    steps[1],
    steps,
  );
  assertEquals(reparo, "cancelamento");
});

// ─── Repasse de DeferredAction ao dispatcher (Tarefa 4.4) ───────────────────
//
// Valida: Requisito 6.1 (o Cérebro REPASSA a `DeferredAction` de cadastro —
// `ocr`/`portal_submit`/`otp_submit` — produzida pelo `runEngine` ao dispatcher
// existente, sem executar OCR/portal/OTP por conta própria). A função
// `extrairAcaoCadastro` é a FRONTEIRA pura: só SELECIONA o que despachar; quem
// EXECUTA é o dispatcher acionado pela N1.

Deno.test("4.4: deferred 'ocr' é exposta para repasse ao dispatcher", () => {
  const deferred: DeferredAction = {
    kind: "ocr",
    stepId: "s1",
    flowId: "f1",
    pipeline: "ocr_conta",
    mediaRef: "media-123",
  };
  const acao = extrairAcaoCadastro(deferred);
  // Repassada SEM reescrever: mesmo objeto, mesmo formato do motor.
  assertEquals(acao, deferred);
});

Deno.test("4.4: deferred 'portal_submit' é exposta para repasse ao dispatcher", () => {
  const deferred: DeferredAction = {
    kind: "portal_submit",
    stepId: "s2",
    flowId: "f1",
    pipeline: "finalizar_cadastro",
  };
  const acao = extrairAcaoCadastro(deferred);
  assertEquals(acao?.kind, "portal_submit");
  assertEquals(acao, deferred);
});

Deno.test("4.4: deferred 'otp_submit' é exposta para repasse ao dispatcher", () => {
  const deferred: DeferredAction = {
    kind: "otp_submit",
    stepId: "s3",
    flowId: "f1",
    otpCode: "123456",
  };
  const acao = extrairAcaoCadastro(deferred);
  assertEquals(acao?.kind, "otp_submit");
  assertEquals(acao, deferred);
});

Deno.test("4.4: deferred de IA ('ai_answer'/'ai_decide') NÃO vira ação de cadastro", () => {
  // A escrita da resposta é da peça N4 — o repasse de cadastro ignora IA.
  const aiAnswer: DeferredAction = {
    kind: "ai_answer",
    question: "tem desconto?",
    stepId: "s1",
    flowId: "f1",
  };
  const aiDecide: DeferredAction = {
    kind: "ai_decide",
    stepId: "s1",
    flowId: "f1",
    candidates: ["a", "b"],
    inboundText: "talvez",
  };
  assertEquals(extrairAcaoCadastro(aiAnswer), undefined);
  assertEquals(extrairAcaoCadastro(aiDecide), undefined);
});

Deno.test("4.4: turno sem deferred → nenhuma ação de cadastro a repassar", () => {
  assertEquals(extrairAcaoCadastro(undefined), undefined);
});
