/**
 * Migração de clientes que já estão em conversa (pt-BR).
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — seção
 * "Migração de clientes que já estão em conversa".
 * Tarefa 12.1 (Requisitos 5.4 e 14.1).
 *
 * CONTEXTO
 * --------
 * Ao virar a chave do rollout para `canary`/`on`, existem clientes no meio do
 * atendimento cujo estado foi gravado pela vendedora ANTIGA na coluna
 * `customers.fluxo_b_state.etapa` (tipo `Etapa` em `_shared/vendedora/types.ts`).
 * O fluxo NOVO (construtor visual) trabalha com passos de `bot_flow_steps`,
 * identificados por `stepKey`/`pipelineKind`.
 *
 * Esta peça é APENAS o MAPA + a função de tradução: "etapa antiga → passo
 * equivalente do fluxo". Ela NÃO aplica o passo nem decide handoff — isso é da
 * Tarefa 12.2 — e NÃO testa o não-reinício de cadastro — isso é da Tarefa 12.3.
 * Aqui só traduzimos e, quando não há equivalência clara, SINALIZAMOS
 * "sem equivalente" para a 12.2 tratar como handoff (postura conservadora do
 * design: nunca recomeçar o cadastro de quem já estava em andamento).
 *
 * REÚSO (sem duplicar): os `stepKey` do lado direito do mapa são EXATAMENTE os
 * declarados no registro de cadastro (`pipeline-cadastro/registry.ts`). Um teste
 * cruza o mapa com esse registro para garantir que nenhum `stepKey` foi inventado.
 */

import type { Etapa } from "./comum/types.ts";
import type { BotFlowStep } from "./tipos.ts";

/**
 * Passo do fluxo do construtor visual ao qual uma etapa antiga corresponde.
 * Identificado pelo `stepKey` (a chave estável do passo em `bot_flow_steps`) e
 * por um `pipelineKind` de referência (qual trilho de cadastro aquele passo
 * pertence, quando há um — OCR, portal, finalização).
 */
export interface PassoEquivalente {
  /** Chave do passo em `bot_flow_steps` (ver `pipeline-cadastro/registry.ts`). */
  stepKey: string;
  /** Trilho de cadastro do passo, quando aplicável; `null` para passos conversacionais. */
  pipelineKind: BotFlowStep["pipelineKind"];
}

/**
 * Resultado da tradução de uma etapa antiga:
 *   - `equivalente`     → há um passo do fluxo correspondente (a 12.2 fará o
 *                         cliente "entrar" nesse passo, sem reiniciar o cadastro);
 *   - `sem_equivalente` → não há passo claro; a 12.2 deve tratar como handoff.
 */
export type ResultadoMigracao =
  | { tipo: "equivalente"; passo: PassoEquivalente }
  | { tipo: "sem_equivalente"; etapa: string | null };

/**
 * Mapa de equivalência: etapa antiga (`fluxo_b_state.etapa`) → passo do fluxo.
 *
 * Cobre TODAS as etapas conhecidas do tipo `Etapa`. O valor `null` significa
 * "sem equivalente claro" — etapa puramente conversacional da vendedora antiga
 * que não tem um passo de cadastro estável no construtor visual. Nesses casos a
 * 12.2 fará handoff (em vez de recomeçar o cadastro), conforme o design.
 *
 * Decisões de mapeamento (todas as chaves do lado direito existem no registro
 * `CADASTRO_STEP_REGISTRY`):
 *   - `interesse`    → `ask_quero_cadastrar`  (porta de intenção de cadastrar);
 *   - `nome`         → `ask_name`             (coleta do nome);
 *   - `valor`        → `ask_bill_value`       (coleta do valor da conta);
 *   - `simulacao`    → sem equivalente        (etapa conversacional sem passo fixo);
 *   - `consideracao` → sem equivalente        (tratamento de objeção, sem passo fixo);
 *   - `foto_conta`   → `aguardando_conta`     (espera a foto da conta — OCR conta);
 *   - `doc`          → `ask_tipo_documento`   (início do envio de documento — OCR doc);
 *   - `email`        → `ask_email`            (coleta do e-mail);
 *   - `finalizando`  → `finalizando`          (finalização do cadastro);
 *   - `pos_cadastro` → `complete`             (cadastro concluído).
 */
export const MAPA_ETAPA_PARA_PASSO: Record<Etapa, PassoEquivalente | null> = {
  interesse: { stepKey: "ask_quero_cadastrar", pipelineKind: null },
  nome: { stepKey: "ask_name", pipelineKind: null },
  valor: { stepKey: "ask_bill_value", pipelineKind: null },
  // Conversacionais: a vendedora antiga apresentava simulação e tratava a
  // consideração/objeção. Não existe passo de cadastro estável para esses
  // momentos no construtor visual → sem equivalente (handoff na 12.2).
  simulacao: null,
  consideracao: null,
  foto_conta: { stepKey: "aguardando_conta", pipelineKind: "ocr_conta" },
  doc: { stepKey: "ask_tipo_documento", pipelineKind: "ocr_documento" },
  email: { stepKey: "ask_email", pipelineKind: null },
  finalizando: { stepKey: "finalizando", pipelineKind: "finalizar_cadastro" },
  pos_cadastro: { stepKey: "complete", pipelineKind: null },
};

/**
 * Conjunto de etapas conhecidas SEM passo equivalente claro (derivado do mapa).
 * Útil para diagnóstico/relatório e para a 12.2 saber, de antemão, quais
 * etapas levam a handoff. Calculado a partir do `MAPA_ETAPA_PARA_PASSO` para
 * nunca sair de sincronia com ele.
 */
export const ETAPAS_SEM_EQUIVALENTE: ReadonlySet<Etapa> = new Set(
  (Object.keys(MAPA_ETAPA_PARA_PASSO) as Etapa[]).filter(
    (etapa) => MAPA_ETAPA_PARA_PASSO[etapa] === null,
  ),
);

/**
 * Traduz a etapa antiga da vendedora (`fluxo_b_state.etapa`) para o passo
 * equivalente do fluxo do construtor visual.
 *
 * Comportamento:
 *   - etapa conhecida COM equivalente  → `{ tipo: "equivalente", passo }`;
 *   - etapa conhecida SEM equivalente  → `{ tipo: "sem_equivalente", etapa }`;
 *   - etapa desconhecida/ausente/`null`/`undefined` → `{ tipo: "sem_equivalente", etapa }`.
 *
 * Aceita `string | null | undefined` de propósito: o valor vem de
 * `fluxo_b_state` (JSON do banco) e pode estar ausente, corrompido ou conter um
 * rótulo de etapa que não existe mais. Em qualquer um desses casos, a resposta
 * conservadora é "sem equivalente" (a 12.2 fará handoff, sem reiniciar nada).
 *
 * Esta função é PURA: não lê banco, não envia mensagem, não decide handoff —
 * apenas traduz. A aplicação fica para a Tarefa 12.2.
 *
 * @param etapa Valor de `fluxo_b_state.etapa` (pode ser inválido/ausente).
 * @returns A equivalência encontrada ou a sinalização de "sem equivalente".
 */
export function traduzirEtapaAntiga(
  etapa: Etapa | string | null | undefined,
): ResultadoMigracao {
  // Sem valor utilizável → conservador (handoff na 12.2).
  if (typeof etapa !== "string" || etapa.length === 0) {
    return { tipo: "sem_equivalente", etapa: etapa ?? null };
  }

  // `etapa` desconhecida (não está no mapa) → conservador.
  if (!(etapa in MAPA_ETAPA_PARA_PASSO)) {
    return { tipo: "sem_equivalente", etapa };
  }

  const passo = MAPA_ETAPA_PARA_PASSO[etapa as Etapa];

  // Etapa conhecida, porém sem equivalente claro (valor `null` no mapa).
  if (passo === null) {
    return { tipo: "sem_equivalente", etapa };
  }

  return { tipo: "equivalente", passo };
}

// ─── Tarefa 12.2 — Aplicação da migração ─────────────────────────────────────
//
// A 12.1 só TRADUZ (etapa antiga → passo). Aqui APLICAMOS essa tradução para
// produzir a decisão de ponto de ENTRADA do cliente que já estava em conversa:
//   - há passo equivalente  → "entrar no passo" (sem reiniciar o cadastro);
//   - não há equivalente     → "handoff para humano" (Requisito 5.4).
//
// Postura conservadora do design: cliente no meio do cadastro NUNCA volta ao
// começo. Quando a etapa antiga não tem equivalente claro (ou o estado está
// ausente/corrompido), preferimos transferir para um atendente humano em vez de
// recomeçar o cadastro. Esta peça NÃO decide o passo definitivo — o `runEngine`
// é quem decide o passo a partir dos dados já presentes; aqui só fixamos o
// PONTO DE ENTRADA equivalente para que o motor não reinicie de trás.

import type { EstadoCerebro } from "./tipos.ts";

/**
 * Decisão de migração para um cliente que já estava em conversa:
 *   - `entrar_no_passo` → o cliente "entra" no passo equivalente do fluxo
 *     (identificado por `stepKey` em `bot_flow_steps`), sem reiniciar o cadastro;
 *   - `handoff`         → não há passo equivalente claro; transferir para um
 *     atendente humano (em vez de recomeçar), com o `motivo` para diagnóstico.
 */
export type DecisaoMigracao =
  | { acao: "entrar_no_passo"; stepKey: string }
  | { acao: "handoff"; motivo: string };

/**
 * Extrai a etapa antiga (`fluxo_b_state.etapa`) de diferentes formatos de
 * entrada, de forma defensiva (Requisito 5.4 — estado parcial/corrompido não
 * pode derrubar a migração). Aceita:
 *   - o `EstadoCerebro` lido pela N8 (etapa em `memoria.operacional.fluxoBState.etapa`);
 *   - um objeto `fluxo_b_state` cru (`{ etapa, info, ... }`);
 *   - `null`/`undefined`/valores inesperados → devolve `null`.
 *
 * Não lança: qualquer formato não reconhecido vira `null`, e a decisão
 * resultante será o handoff conservador.
 */
function extrairEtapaAntiga(
  entrada: EstadoCerebro | Record<string, unknown> | null | undefined,
): string | null {
  if (!entrada || typeof entrada !== "object") return null;

  const obj = entrada as Record<string, unknown>;

  // Caso 1: `EstadoCerebro` da N8 — a etapa antiga vive na camada operacional,
  // dentro do `fluxo_b_state` preservado cru por `montarMemoriaEmCamadas`.
  const memoria = obj.memoria as Record<string, unknown> | undefined;
  if (memoria && typeof memoria === "object") {
    const operacional = memoria.operacional as Record<string, unknown> | undefined;
    if (operacional && typeof operacional === "object") {
      const fluxoB = operacional.fluxoBState as Record<string, unknown> | undefined;
      if (fluxoB && typeof fluxoB === "object" && typeof fluxoB.etapa === "string") {
        return fluxoB.etapa;
      }
    }
  }

  // Caso 2: objeto `fluxo_b_state` cru, com a etapa no topo.
  if (typeof obj.etapa === "string") {
    return obj.etapa;
  }

  // Nada utilizável → handoff conservador adiante.
  return null;
}

/**
 * Define o PONTO DE ENTRADA do cliente que já estava em conversa, aplicando a
 * tradução de etapa da 12.1 (Requisito 5.4).
 *
 * Regra (conservadora, do design):
 *   - etapa antiga COM equivalente  → `{ acao: "entrar_no_passo", stepKey }`
 *     (o cliente entra no passo do fluxo correspondente, sem recomeçar; o
 *     `runEngine` ainda respeitará os dados já coletados a partir desse ponto);
 *   - etapa antiga SEM equivalente / desconhecida / ausente / corrompida
 *     → `{ acao: "handoff", motivo }` (transferir para humano em vez de
 *     reiniciar o cadastro).
 *
 * Esta função é PURA: não lê banco e não envia mensagem. Ela apenas decide o
 * ponto de entrada a partir do estado já lido pela N8 (ou de um `fluxo_b_state`
 * cru). NÃO reinicia cadastro em hipótese alguma.
 *
 * @param estado `EstadoCerebro` (saída da N8) ou um `fluxo_b_state` cru.
 * @returns A decisão de entrar no passo equivalente ou de fazer handoff.
 */
export function pontoDeEntradaMigracao(
  estado: EstadoCerebro | Record<string, unknown> | null | undefined,
): DecisaoMigracao {
  const etapa = extrairEtapaAntiga(estado);
  const traducao = traduzirEtapaAntiga(etapa);

  if (traducao.tipo === "equivalente") {
    return { acao: "entrar_no_passo", stepKey: traducao.passo.stepKey };
  }

  // Sem equivalente → handoff conservador (nunca reinicia o cadastro).
  const rotulo = traducao.etapa === null
    ? "ausente"
    : traducao.etapa === ""
    ? "vazia"
    : `"${traducao.etapa}"`;
  return {
    acao: "handoff",
    motivo:
      `Etapa antiga ${rotulo} não tem passo equivalente no fluxo; ` +
      "transferindo para atendente humano em vez de reiniciar o cadastro.",
  };
}

/**
 * Alias de `pontoDeEntradaMigracao` (mesmo comportamento). Mantido porque a
 * Tarefa 12.2 cita ambos os nomes como aceitáveis para a aplicação da migração.
 */
export const aplicarMigracao = pontoDeEntradaMigracao;
