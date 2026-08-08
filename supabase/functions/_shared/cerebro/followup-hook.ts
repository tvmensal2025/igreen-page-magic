/**
 * Hook de FOLLOW-UP / REATIVAÇÃO do Cérebro IA (pt-BR) — Tarefa 13.
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — seção "Automação (follow-up /
 * reativação) religada ao Cérebro". Requisitos 14.1 e 14.2.
 *
 * O QUE FAZ
 * ---------
 * Espelha o papel de `cerebro/sombra-hook.ts`, mas para os CRONS de follow-up.
 * Hoje os crons (`process-followups`, `ai-followup-cron`) acionam a
 * Vendedora_Atual com um "nudge" (`runFluxoBAI` / `ai-sales-agent`). Quando a
 * Chave_Ativacao (`flow_engine_v3`) do consultor está em `on`, este hook passa
 * a chamar o **N1 (Orquestrador)** com um inbound sintético `no_input`/nudge
 * (o `runEngine` já trata `no_input`), deixando o Cérebro decidir a ação de
 * reaquecimento lendo o fluxo, igual a um turno normal.
 *
 * Enquanto a chave NÃO está em `on` (`off`/`dark`/`canary`), o hook devolve
 * `usouCerebro=false` e o cron continua chamando a Vendedora_Atual, SEM
 * qualquer mudança de comportamento (Requisito 14.2).
 *
 * POSTURA FAIL-OPEN (igual a `runEngineV3IfEnabled` / `executarCerebroSombra`)
 * --------------------------------------------------------------------------
 * Qualquer erro em qualquer etapa é ENGOLIDO: a função NUNCA lança e devolve
 * `usouCerebro=false`. Assim, uma falha do Cérebro JAMAIS impede o follow-up —
 * o cron simplesmente cai no caminho atual (Vendedora_Atual) ou no no-op. A
 * leitura da flag também é fail-open (default `off` → Vendedora_Atual).
 *
 * POR QUE SÓ `on` (e não `canary`)
 * --------------------------------
 * Os crons não carregam a lista de consultores do canário no ponto de chamada;
 * o gate por consultor já vem embutido na própria flag lida (cada consultor tem
 * a sua). Em `canary` o Cérebro responde no webhook para o subconjunto, mas a
 * automação de reaquecimento só vira para o Cérebro quando o consultor está
 * totalmente em `on` — o ponto em que a Vendedora_Atual é aposentada
 * (Requisito 14.1). Antes disso, o follow-up segue pela Vendedora_Atual.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFlowEngineV3, type FlowEngineV3Flag } from "../feature-flag.ts";
import { processarTurno as processarTurnoReal } from "./index.ts";
import type { ChannelCapabilities, ResultadoCerebro } from "./tipos.ts";

// deno-lint-ignore no-explicit-any
type AnySupabase = any;

/**
 * Canal de origem do follow-up (parametriza só as capacidades do motor).
 * Inclui o piloto `wame` porque os crons repassam `ResolvedChannel.kind`
 * direto; o valor só alimenta `capabilitiesPadrao`.
 */
export type CanalFollowup = "evolution" | "whapi" | "wame";

/** Para onde o nudge deve ir neste turno de follow-up. */
export type DestinoFollowup = "cerebro" | "vendedora";

/** Dependências injetáveis (para teste isolado, sem rede). */
export interface DependenciasFollowup {
  lerFlag?: (supabase: AnySupabase, consultantId: string) => Promise<FlowEngineV3Flag>;
  processarTurno?: typeof processarTurnoReal;
}

/** Entrada do hook de follow-up. */
export interface EntradaFollowupHook {
  supabase: SupabaseClient | AnySupabase;
  customerId: string;
  consultantId: string;
  /** Canal que enviará a resposta (default `evolution`). */
  channel?: CanalFollowup;
  /** Capacidades do canal; ausente → default permissivo por canal. */
  capabilities?: ChannelCapabilities;
  deps?: DependenciasFollowup;
}

/** Resultado observável do hook de follow-up. */
export interface ResultadoFollowupHook {
  /** `true` somente quando o Cérebro produziu o nudge (flag = `on`). */
  usouCerebro: boolean;
  /** Estágio lido da Chave_Ativacao (`off`/`dark`/`canary`/`on`). */
  flag: FlowEngineV3Flag;
  /**
   * Texto de reaquecimento gerado pelo Cérebro (já aprovado pela Guarda N5).
   * `null` quando o Cérebro não rodou (caminho da Vendedora_Atual) ou quando o
   * turno terminou em handoff/sem texto. O cron só envia quando há texto.
   */
  reply: string | null;
  /** `true` quando o Cérebro decidiu mandar para humano (sem texto a enviar). */
  shouldHandoff: boolean;
  /** Resultado completo do Cérebro, quando rodou (para auditoria/estado). */
  resultado: ResultadoCerebro | null;
}

/**
 * Capacidades padrão por canal quando o chamador não as informa. Espelha
 * `capabilitiesPadrao` de `sombra-hook.ts` (postura permissiva — o motor decide
 * o que cabe no canal).
 */
function capabilitiesPadrao(channel: CanalFollowup): ChannelCapabilities {
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

/** Resultado neutro: o Cérebro NÃO rodou (cron segue pela Vendedora_Atual). */
function neutro(flag: FlowEngineV3Flag): ResultadoFollowupHook {
  return { usouCerebro: false, flag, reply: null, shouldHandoff: false, resultado: null };
}

/**
 * Decide, pela Chave_Ativacao do consultor, por onde o nudge de follow-up deve
 * ir: `cerebro` quando `flow_engine_v3 = on`; `vendedora` em qualquer outro
 * estágio (`off`/`dark`/`canary`) e em qualquer erro (fail-open).
 *
 * Nunca lança. É a peça pequena e testável que os crons consultam.
 */
export async function decidirCanalFollowup(
  supabase: AnySupabase,
  consultantId: string,
  deps: DependenciasFollowup = {},
): Promise<{ destino: DestinoFollowup; flag: FlowEngineV3Flag }> {
  const lerFlag = deps.lerFlag ?? getFlowEngineV3;
  let flag: FlowEngineV3Flag = "off";
  try {
    flag = await lerFlag(supabase, consultantId);
  } catch (e) {
    console.warn(
      "[cerebro/followup-hook] leitura de flag falhou (fail-open → vendedora):",
      (e as { message?: string })?.message,
    );
    return { destino: "vendedora", flag: "off" };
  }
  return { destino: flag === "on" ? "cerebro" : "vendedora", flag };
}

/**
 * Executa o nudge de follow-up pelo Cérebro QUANDO `flow_engine_v3 = on`.
 *
 * Monta um inbound sintético `no_input` (o "nudge" que o `runEngine` já trata)
 * e chama o N1 (`processarTurno`, que já é fail-open e tem teto de 25s). Em
 * qualquer estágio que não seja `on`, devolve resultado neutro
 * (`usouCerebro=false`) para o cron seguir chamando a Vendedora_Atual.
 *
 * Fail-open total: nunca lança; qualquer erro vira resultado neutro. Assim, uma
 * falha do Cérebro nunca impede o follow-up (Requisito 14.2).
 *
 * @returns se usou o Cérebro, o texto gerado (ou `null`) e o resultado completo.
 */
export async function executarFollowupCerebro(
  entrada: EntradaFollowupHook,
): Promise<ResultadoFollowupHook> {
  const { supabase, customerId, consultantId } = entrada;
  const deps = entrada.deps ?? {};
  const processarTurno = deps.processarTurno ?? processarTurnoReal;

  let flag: FlowEngineV3Flag = "off";
  try {
    const decisao = await decidirCanalFollowup(supabase, consultantId, deps);
    flag = decisao.flag;

    // GATE: só vira para o Cérebro em `on`. Demais estágios → Vendedora_Atual.
    if (decisao.destino !== "cerebro") {
      return neutro(flag);
    }

    const capabilities = entrada.capabilities ??
      capabilitiesPadrao(entrada.channel ?? "evolution");

    // Inbound sintético de reaquecimento: `no_input` é o "nudge" que o motor já
    // entende (mesma porta de um turno normal — o Cérebro lê o fluxo e decide).
    const resultado: ResultadoCerebro = await processarTurno({
      supabase,
      customerId,
      consultantId,
      inbound: { kind: "no_input" },
      canalCapabilities: capabilities,
    });

    const reply = (resultado.reply ?? "").trim();
    return {
      usouCerebro: true,
      flag,
      reply: reply.length > 0 ? reply : null,
      shouldHandoff: !!resultado.shouldHandoff || reply.length === 0,
      resultado,
    };
  } catch (e) {
    // Fail-open: erro no Cérebro NUNCA impede o follow-up. O cron cai na
    // Vendedora_Atual (ou no-op), preservando o comportamento atual.
    console.warn(
      "[cerebro/followup-hook] erro engolido (fail-open → vendedora):",
      (e as { message?: string })?.message,
    );
    return neutro(flag);
  }
}
