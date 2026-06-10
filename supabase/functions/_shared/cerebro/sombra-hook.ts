/**
 * Hook de SOMBRA do Cérebro IA (pt-BR) — Tarefa 9.1.
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — seções "Fluxo de um turno",
 * "Ativação segura" e "Error Handling".
 * Requisitos: 2.1 (lê a Chave_Ativacao `flow_engine_v3`), 2.3 (em `dark`
 * calcula e registra SEM enviar), 3.1 (grava 1 registro por turno), 3.3
 * (impede o envio de qualquer mensagem ao cliente).
 *
 * O QUE FAZ
 * ---------
 * Espelha o papel de `_shared/engine/webhook-hook.ts` (`runEngineV3IfEnabled`):
 * roda EM PARALELO ao caminho atual, observando, e NUNCA bloqueia/afeta o
 * atendimento. A diferença é o que ele observa — aqui é o CÉREBRO (N1,
 * `processarTurno`), não o engine v3.
 *
 * Quando `flow_engine_v3 = 'dark'` para o consultor:
 *   1. monta o `InboundEvent` e as `ChannelCapabilities` a partir do inbound
 *      bruto do webhook (mesma forma que `runEngineV3IfEnabled` reconstrói);
 *   2. chama `processarTurno` do Cérebro (que já é fail-open e tem teto de 25s);
 *   3. grava a comparação Cérebro × sistema atual via `registrarDecisaoSombra`
 *      em `ai_decisions` (reúso de tabela — Requisito 17.3);
 *   4. NÃO envia NADA ao cliente — o `ResultadoCerebro` é apenas observado.
 *
 * POSTURA FAIL-OPEN (igual a `runEngineV3IfEnabled`)
 * --------------------------------------------------
 * Qualquer erro em qualquer etapa é ENGOLIDO: a função nunca lança e devolve um
 * resultado neutro. O caminho atual (vendedora/engine) jamais é afetado por uma
 * falha do Cérebro. A leitura da flag também é fail-open (default `off`).
 *
 * GATE DE ESTÁGIO
 * ---------------
 * Esta peça roda SOMENTE em `dark` (Requisito 2.3). Em `off` o Cérebro fica
 * inativo (Requisito 2.2); em `canary`/`on` o Cérebro PASSA A RESPONDER de
 * verdade — caminho de envio que NÃO é responsabilidade deste hook de sombra
 * (tarefas 14/15). Aqui, por definição, nada é enviado.
 *
 * INTEGRAÇÃO (Tarefa 9.2)
 * -----------------------
 * Esta função é ISOLADA de propósito: a tarefa 9.1 só a cria. Os DOIS webhooks
 * (evolution + whapi) a chamarão EM PAR na tarefa 9.2, no MESMO ponto onde hoje
 * chamam `runEngineV3IfEnabled`. A assinatura de entrada espelha
 * `RunEngineV3Input` para que ligar nos dois webhooks seja simétrico.
 *
 * DECISÃO DO SISTEMA ATUAL (normalização conservadora)
 * ----------------------------------------------------
 * A comparação de N10 é passo/ação × passo/ação (NUNCA texto). O lado "sistema
 * atual" precisa virar um `ResumoDecisaoTurno`. Como no ponto de chamada (antes
 * de o caminho legado decidir) nem sempre há o resultado pronto, aceitamos a
 * `decisaoSistemaAtual` já normalizada por quem chama (preferencial) e, na
 * ausência dela, DERIVAMOS de forma conservadora a partir do que está
 * disponível no ponto de chamada (`legacyStep` + tipo do inbound) — ver
 * `derivarDecisaoSistemaAtual`. Conservador = não inventar ação forte (handoff,
 * portal): assume-se que o legado "responde" no passo em que está.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFlowEngineV3, type FlowEngineV3Flag } from "../feature-flag.ts";
import { processarTurno as processarTurnoReal } from "./index.ts";
import {
  registrarDecisaoSombra as registrarDecisaoSombraReal,
  type AcaoTurno,
  type ResumoDecisaoTurno,
} from "./registro-decisao.ts";
import type {
  ChannelCapabilities,
  InboundEvent,
  ResultadoCerebro,
} from "./tipos.ts";

// deno-lint-ignore no-explicit-any
type AnySupabase = any;

/** Canal de origem do turno (espelha os dois webhooks). */
export type CanalWebhook = "evolution" | "whapi";

/**
 * Entrada do hook de sombra. Os campos de inbound ESPELHAM `RunEngineV3Input`
 * (de `engine/webhook-hook.ts`) para que ligar nos dois webhooks seja idêntico
 * ao que já se faz com `runEngineV3IfEnabled`.
 */
export interface EntradaSombraHook {
  supabase: SupabaseClient | AnySupabase;
  customerId: string;
  consultantId: string;
  /** Passo do caminho legado ANTES do turno (para derivar o lado "sistema atual"). */
  legacyStep?: string | null;
  inboundKind?: "text" | "button_click" | "media" | "timer_expired" | "no_input";
  inboundText?: string | null;
  inboundButtonId?: string | null;
  inboundMediaKind?: "image" | "audio" | "video" | "document" | null;
  inboundMessageId?: string | null;
  /** Canal do webhook que originou o turno (auditoria no registro). */
  channel?: CanalWebhook;
  /**
   * Decisão do sistema atual já normalizada (preferencial). Quem chama (webhook,
   * tarefa 9.2) pode normalizar a saída do caminho legado para este formato.
   * Ausente → derivamos de forma conservadora de `legacyStep` + inbound.
   */
  decisaoSistemaAtual?: ResumoDecisaoTurno;
  /**
   * Capacidades do canal. Ausente → default permissivo por canal (em sombra
   * nada é enviado, então as capacidades só parametrizam a decisão do motor).
   */
  capabilities?: ChannelCapabilities;
  /**
   * Dependências injetáveis (para teste isolado, sem rede). Em produção usam-se
   * as implementações reais (Cérebro + registrador + leitura de flag).
   */
  deps?: DependenciasSombra;
}

/** Dependências do hook, com defaults reais. Permitem teste sem rede. */
export interface DependenciasSombra {
  lerFlag?: (supabase: AnySupabase, consultantId: string) => Promise<FlowEngineV3Flag>;
  processarTurno?: typeof processarTurnoReal;
  registrarDecisaoSombra?: typeof registrarDecisaoSombraReal;
}

/** Resultado observável do hook (nunca contém envio — invariante de sombra). */
export interface ResultadoSombraHook {
  /** `true` apenas quando o Cérebro rodou em sombra (flag = `dark`). */
  executou: boolean;
  /** Estágio lido da Chave_Ativacao (`off`/`dark`/`canary`/`on`). */
  flag: FlowEngineV3Flag;
  /** `true` se a comparação foi gravada em `ai_decisions`. */
  registrou: boolean;
  /** Flag de coincidência calculada (ou `null` quando não rodou). */
  coincide: boolean | null;
  /** Invariante de SOMBRA: este hook JAMAIS envia ao cliente (Requisito 3.3). */
  enviouAoCliente: false;
}

/** Resultado neutro (não rodou): usado em `off`/`canary`/`on`/erro. */
function neutro(flag: FlowEngineV3Flag): ResultadoSombraHook {
  return {
    executou: false,
    flag,
    registrou: false,
    coincide: null,
    enviouAoCliente: false,
  };
}

/**
 * Capacidades padrão por canal quando o chamador não as informa. Em modo sombra
 * NADA é enviado, então estas capacidades só dizem ao motor o que o canal
 * suportaria (postura permissiva, igual ao default de `runEngineV3IfEnabled`).
 */
function capabilitiesPadrao(channel: CanalWebhook): ChannelCapabilities {
  return {
    channel,
    supportsButtons: true,
    maxButtons: 3,
    supportsList: true,
    supportsAudio: true,
    supportsVideo: true,
    supportsTypingPresence: true,
    supportsReactions: false,
    inboundIdField: channel === "whapi" ? "wa_id" : "messageId",
  };
}

/**
 * Reconstrói o `InboundEvent` a partir do inbound bruto do webhook — MESMA
 * lógica de `runEngineV3IfEnabled` (botão → `button_click`; mídia → `media`;
 * texto só com dígitos → `number_reply`; texto → `text`; vazio → `no_input`).
 */
export function montarInbound(entrada: EntradaSombraHook): InboundEvent {
  const txt = (entrada.inboundText ?? "").trim();
  if (entrada.inboundButtonId) {
    return {
      kind: "button_click",
      buttonId: String(entrada.inboundButtonId),
      rawText: entrada.inboundText || undefined,
    };
  }
  if (entrada.inboundMediaKind) {
    return {
      kind: "media",
      mediaKind: entrada.inboundMediaKind,
      mediaRef: String(entrada.inboundMessageId ?? ""),
    };
  }
  if (txt && /^\d{1,2}$/.test(txt)) {
    return { kind: "number_reply", raw: txt };
  }
  if (txt) {
    return { kind: "text", text: entrada.inboundText ?? "" };
  }
  return { kind: "no_input" };
}

/**
 * Deriva, de forma CONSERVADORA, o resumo passo/ação do sistema atual a partir
 * do que está disponível no ponto de chamada (`legacyStep` + tipo do inbound).
 *
 * Conservador significa NÃO assumir ações fortes (handoff, portal, otp) que não
 * dá para inferir com segurança no ponto de chamada:
 *   - `passo` = o passo legado em que o cliente está (`legacyStep`), pois é o
 *     ponto de onde o caminho atual decidirá;
 *   - `acao` = `ocr` quando o inbound é mídia (o legado encaminha a foto/doc ao
 *     pipeline existente), senão `responder` (o legado responde em texto/botão).
 *
 * Esta derivação é o FALLBACK: quando o chamador tem o resultado real do caminho
 * atual, ele deve passar `decisaoSistemaAtual` normalizada e mais precisa.
 */
export function derivarDecisaoSistemaAtual(
  entrada: EntradaSombraHook,
  inbound: InboundEvent,
): ResumoDecisaoTurno {
  const passo = (entrada.legacyStep ?? "").trim() || null;
  const acao: AcaoTurno = inbound.kind === "media" ? "ocr" : "responder";
  return { passo, acao };
}

/**
 * Executa o Cérebro em SOMBRA quando `flow_engine_v3 = 'dark'`, registrando a
 * comparação com o sistema atual e SEM enviar nada ao cliente.
 *
 * Fail-open total: nunca lança; qualquer erro vira resultado neutro. O caminho
 * atual do webhook não é afetado (o chamador ignora o retorno em produção).
 *
 * @returns resultado observável (estágio, se rodou, se gravou e a coincidência).
 */
export async function executarCerebroSombra(
  entrada: EntradaSombraHook,
): Promise<ResultadoSombraHook> {
  const { supabase, customerId, consultantId } = entrada;
  const deps = entrada.deps ?? {};
  const lerFlag = deps.lerFlag ?? getFlowEngineV3;
  const processarTurno = deps.processarTurno ?? processarTurnoReal;
  const registrarDecisaoSombra = deps.registrarDecisaoSombra ?? registrarDecisaoSombraReal;

  let flag: FlowEngineV3Flag = "off";
  try {
    flag = await lerFlag(supabase, consultantId);

    // GATE: o hook de sombra roda SOMENTE em `dark` (Requisito 2.3). Em `off`
    // o Cérebro fica inativo; em `canary`/`on` o envio é tratado por outra peça.
    if (flag !== "dark") {
      return neutro(flag);
    }

    const inicio = Date.now();
    const inbound = montarInbound(entrada);
    const capabilities = entrada.capabilities ?? capabilitiesPadrao(entrada.channel ?? "evolution");

    // Cérebro roda EM PARALELO ao caminho atual. `processarTurno` já é fail-open
    // (nunca lança) e tem teto de 25s; ainda assim fica dentro do try geral.
    const resultado: ResultadoCerebro = await processarTurno({
      supabase,
      customerId,
      consultantId,
      inbound,
      canalCapabilities: capabilities,
    });

    // Lado "sistema atual": preferimos o que o chamador normalizou; senão,
    // derivação conservadora a partir do ponto de chamada.
    const decisaoSistemaAtual = entrada.decisaoSistemaAtual ??
      derivarDecisaoSistemaAtual(entrada, inbound);

    const reg = await registrarDecisaoSombra({
      supabase,
      consultantId,
      customerId,
      decisaoCerebro: resultado,
      decisaoSistemaAtual,
      inboundText: entrada.inboundText ?? null,
      channel: entrada.channel ?? null,
      latencyMs: Date.now() - inicio,
    });

    // INVARIANTE (Requisito 3.3): nada do `resultado` é enviado ao cliente.
    return {
      executou: true,
      flag,
      registrou: reg.ok,
      coincide: reg.coincide,
      enviouAoCliente: false,
    };
  } catch (e) {
    // Fail-open: erro no Cérebro NUNCA propaga nem afeta o caminho atual.
    console.warn(
      "[cerebro/sombra-hook] erro engolido (fail-open):",
      (e as { message?: string })?.message,
    );
    return neutro(flag);
  }
}
