/**
 * Hook de RESPOSTA real do Cérebro IA (pt-BR) — Tarefa 14.1.
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — seções "Ativação segura",
 * "Fluxo de um turno", "Pipeline de cadastro" e "Error Handling".
 * Requisitos: 2.4 (em `canary` responde só para o subconjunto de consultores
 * do rollout) e 14.2 (mantém a vendedora para os demais; monitoramento vem
 * depois).
 *
 * O QUE FAZ
 * ---------
 * É o PAR de envio do `cerebro/sombra-hook.ts`. Enquanto o hook de sombra só
 * observa em `dark`, este hook RESPONDE DE VERDADE quando o Cérebro é a fonte
 * de verdade do turno:
 *
 *   - `canary` → o Cérebro responde APENAS para o subconjunto de consultores do
 *     rollout;
 *   - `on`     → o Cérebro responde para todos os clientes do consultor.
 *
 * Em `off`/`dark`, este hook NÃO responde: devolve resultado neutro e o caminho
 * atual (vendedora/engine) segue como hoje.
 *
 * CRITÉRIO DE CANÁRIO — REÚSO EXATO (Requisito 2.4)
 * -------------------------------------------------
 * O subconjunto de consultores do canário NÃO é decidido aqui por percentual ou
 * lista própria. A pertinência ao canário é gravada POR CONSULTOR na coluna
 * `consultants.flow_engine_v3 = 'canary'` (o cron `flow-engine-rollout-cron`
 * usa `rollout_config.canary_percent` apenas para decidir QUANTOS consultores
 * promover; quem está dentro fica marcado na própria flag). No ponto de
 * execução, o critério é EXATAMENTE o mesmo do engine v3: ler a flag do
 * consultor (`getFlowEngineV3`) e checar `isV2Active` — verdadeiro quando a
 * flag é `canary` OU `on`. Ou seja, um consultor "no subconjunto do canário" é
 * aquele cuja flag vale `canary`; um consultor "fora" tem `off`/`dark` e o
 * Cérebro não responde para ele (cai no caminho atual). Mesmo helper, mesma
 * semântica de `runEngineV3IfEnabled` (que usa `isV2Enabled` para OBSERVAR e
 * trata `canary`/`on` como fonte de verdade).
 *
 * POSTURA FAIL-OPEN (igual a `runEngineV3IfEnabled` / `executarCerebroSombra`)
 * --------------------------------------------------------------------------
 * Qualquer erro em qualquer etapa é ENGOLIDO: a função NUNCA lança e devolve
 * `respondeu=false`. Assim, uma falha do Cérebro JAMAIS bloqueia o atendimento
 * — o webhook simplesmente cai no caminho atual. A leitura da flag também é
 * fail-open (default `off` → caminho atual).
 *
 * TRIO DE PROTEÇÃO / ANTI-BAN INTACTOS (Requisito 16.1, 16.2)
 * ----------------------------------------------------------
 * Este hook NÃO toca em deduplicação, trava, lock, rate limit nem no anti-ban:
 * ele só decide o CONTEÚDO do turno (reply/outbound já aprovados pela Guarda N5
 * dentro de `processarTurno`) e despacha a ação de cadastro pelo REPASSADOR
 * existente (`despacho-cadastro.ts`). O ENVIO em si é delegado a um sender
 * injetável (`enviarTexto`), que no webhook é o canal já protegido — preservando
 * o trio de proteção e o anti-ban exatamente como estão.
 *
 * INTEGRAÇÃO (Tarefas 14.2 / 14.3)
 * --------------------------------
 * A função fica PRONTA e testada para o webhook chamar (espelhando o ponto do
 * sombra-hook, nos DOIS webhooks em par). A amarração de monitoramento (14.2) e
 * o rollback (14.3) vêm depois. Quando ligada, o webhook passa o sender do canal
 * em `enviarTexto`; sem sender, a função apenas DEVOLVE `reply`/`outbound` para
 * quem chamou enviar (como o `ai-followup-cron` já faz com o follow-up).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getFlowEngineV3, isV2Active, type FlowEngineV3Flag } from "../feature-flag.ts";
import { processarTurno as processarTurnoReal } from "./index.ts";
import { montarInbound } from "./sombra-hook.ts";
import {
  despacharAcaoCadastro as despacharAcaoCadastroReal,
  type ResultadoDespachoCadastro,
} from "./despacho-cadastro.ts";
import type {
  AcaoCadastroDeferida,
  ChannelCapabilities,
  OutboundMessage,
  ResultadoCerebro,
} from "./tipos.ts";

// deno-lint-ignore no-explicit-any
type AnySupabase = any;

/** Canal de origem do turno (espelha os dois webhooks). */
export type CanalWebhook = "evolution" | "whapi";

/**
 * Sender injetável de texto. No webhook é o canal já protegido (anti-ban + trio
 * de proteção). Ausente → a função não envia, apenas devolve `reply`/`outbound`
 * para o chamador enviar. Deve devolver `false` quando o envio falhou.
 */
export type EnviarTexto = (texto: string) => Promise<boolean> | boolean;

/** Dependências injetáveis (para teste isolado, sem rede), com defaults reais. */
export interface DependenciasResposta {
  lerFlag?: (supabase: AnySupabase, consultantId: string) => Promise<FlowEngineV3Flag>;
  processarTurno?: typeof processarTurnoReal;
  despacharAcaoCadastro?: typeof despacharAcaoCadastroReal;
}

/**
 * Entrada do hook de resposta. Os campos de inbound ESPELHAM `EntradaSombraHook`
 * (e, por tabela, `RunEngineV3Input`) para que ligar nos dois webhooks seja
 * idêntico ao que já se faz com o hook de sombra.
 */
export interface EntradaRespostaHook {
  supabase: SupabaseClient | AnySupabase;
  customerId: string;
  consultantId: string;
  inboundKind?: "text" | "button_click" | "media" | "timer_expired" | "no_input";
  inboundText?: string | null;
  inboundButtonId?: string | null;
  inboundMediaKind?: "image" | "audio" | "video" | "document" | null;
  inboundMessageId?: string | null;
  /** Canal do webhook que originou o turno. */
  channel?: CanalWebhook;
  /** Capacidades do canal; ausente → default permissivo por canal. */
  capabilities?: ChannelCapabilities;
  /**
   * Sender do canal (anti-ban + trio de proteção intactos). Ausente → a função
   * não envia, só devolve `reply`/`outbound` para o chamador enviar.
   */
  enviarTexto?: EnviarTexto;
  /** Dependências injetáveis (para teste isolado, sem rede). */
  deps?: DependenciasResposta;
}

/** Resultado observável do hook de resposta. */
export interface ResultadoRespostaHook {
  /**
   * `true` somente quando o Cérebro é a fonte de verdade (flag `canary`/`on`) e
   * de fato rodou. Em `off`/`dark` ou erro → `false` (cai no caminho atual).
   */
  respondeu: boolean;
  /** Estágio lido da Chave_Ativacao (`off`/`dark`/`canary`/`on`). */
  flag: FlowEngineV3Flag;
  /**
   * Texto final aprovado pela Guarda (N5). `null` quando o Cérebro não rodou ou
   * quando o turno terminou em handoff/sem texto.
   */
  reply: string | null;
  /** Comandos de envio do turno (texto/botão/mídia) para o chamador tratar. */
  outbound: OutboundMessage[];
  /** `true` quando o Cérebro decidiu mandar para humano (sem texto a enviar). */
  shouldHandoff: boolean;
  /** `true` quando o sender injetável enviou o `reply` de fato. */
  enviou: boolean;
  /** Ação de cadastro repassada ao dispatcher existente, se houve. */
  acaoCadastro?: AcaoCadastroDeferida;
  /** Resultado do repasse da ação de cadastro (via `despacho-cadastro.ts`). */
  despachoCadastro?: ResultadoDespachoCadastro;
  /** Resultado completo do Cérebro, quando rodou (para auditoria/estado). */
  resultado: ResultadoCerebro | null;
}

/**
 * Capacidades padrão por canal quando o chamador não as informa. Espelha
 * `capabilitiesPadrao` de `sombra-hook.ts`/`followup-hook.ts` (postura
 * permissiva — o motor decide o que cabe no canal).
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

/** Resultado neutro: o Cérebro NÃO respondeu (cai no caminho atual). */
function neutro(flag: FlowEngineV3Flag): ResultadoRespostaHook {
  return {
    respondeu: false,
    flag,
    reply: null,
    outbound: [],
    shouldHandoff: false,
    enviou: false,
    resultado: null,
  };
}

/**
 * Decide, pela Chave_Ativacao do consultor, se o Cérebro deve RESPONDER de
 * verdade neste turno. Reúso EXATO do critério do engine v3: `isV2Active(flag)`
 * — verdadeiro em `canary` (consultor no subconjunto do rollout) e em `on`
 * (todos). Em `off`/`dark` e em qualquer erro (fail-open) → não responde.
 *
 * Nunca lança. É a peça pequena e testável que os webhooks consultam.
 */
export async function deveResponderComCerebro(
  supabase: AnySupabase,
  consultantId: string,
  deps: DependenciasResposta = {},
): Promise<{ responder: boolean; flag: FlowEngineV3Flag }> {
  const lerFlag = deps.lerFlag ?? getFlowEngineV3;
  let flag: FlowEngineV3Flag = "off";
  try {
    flag = await lerFlag(supabase, consultantId);
  } catch (e) {
    console.warn(
      "[cerebro/resposta-hook] leitura de flag falhou (fail-open → caminho atual):",
      (e as { message?: string })?.message,
    );
    return { responder: false, flag: "off" };
  }
  // `isV2Active` é o MESMO critério do engine v3: canary OU on = fonte de
  // verdade. Em canary, a pertinência ao subconjunto já está embutida na flag
  // do consultor (gravada pelo cron de rollout).
  return { responder: isV2Active(flag), flag };
}

/**
 * Executa o Cérebro como FONTE DE VERDADE quando o consultor está em `canary`
 * (no subconjunto do rollout) ou `on`, ENVIANDO a resposta ao cliente e
 * despachando a ação de cadastro pelo repassador existente.
 *
 * Passos quando o Cérebro responde:
 *   1. monta o `InboundEvent` (reúso de `montarInbound` do sombra-hook);
 *   2. chama `processarTurno` (N1) — já fail-open e com teto de 25s; o texto já
 *      sai APROVADO pela Guarda (N5);
 *   3. se o turno produziu `acaoCadastro` (`ocr`/`portal_submit`/`otp_submit`),
 *      repassa ao dispatcher existente via `despacharAcaoCadastro` (o Cérebro
 *      nunca monta payload nem chama o worker direto);
 *   4. se houver `enviarTexto` (sender do canal) e `reply` não vazio, ENVIA o
 *      texto pelo canal protegido (anti-ban + trio de proteção intactos).
 *
 * Fail-open total: nunca lança; qualquer erro vira resultado neutro
 * (`respondeu=false`), e o webhook segue pelo caminho atual.
 *
 * @returns se respondeu, o texto/outbound, se enviou e o resultado completo.
 */
export async function responderComCerebro(
  entrada: EntradaRespostaHook,
): Promise<ResultadoRespostaHook> {
  const { supabase, customerId, consultantId } = entrada;
  const deps = entrada.deps ?? {};
  const processarTurno = deps.processarTurno ?? processarTurnoReal;
  const despacharAcaoCadastro = deps.despacharAcaoCadastro ?? despacharAcaoCadastroReal;

  let flag: FlowEngineV3Flag = "off";
  try {
    const decisao = await deveResponderComCerebro(supabase, consultantId, deps);
    flag = decisao.flag;

    // GATE: só responde quando o Cérebro é fonte de verdade (canary/on).
    // Em `off`/`dark` o envio NÃO é responsabilidade deste hook (o sombra-hook
    // cuida do `dark`; em `off` o Cérebro fica inativo).
    if (!decisao.responder) {
      return neutro(flag);
    }

    const inbound = montarInbound(entrada);
    const capabilities = entrada.capabilities ??
      capabilitiesPadrao(entrada.channel ?? "evolution");

    // Cérebro decide o turno. `processarTurno` já é fail-open e tem teto de 25s;
    // o `reply` já vem APROVADO pela Guarda (N5) ou vazio (handoff).
    const resultado: ResultadoCerebro = await processarTurno({
      supabase,
      customerId,
      consultantId,
      inbound,
      canalCapabilities: capabilities,
    });

    // Repasse do pipeline de cadastro ao dispatcher EXISTENTE (não reescreve o
    // worker do portal). Best-effort: nunca derruba o turno.
    let despachoCadastro: ResultadoDespachoCadastro | undefined;
    if (resultado.acaoCadastro) {
      despachoCadastro = await despacharAcaoCadastro({
        supabase,
        customerId,
        acaoCadastro: resultado.acaoCadastro,
      });
    }

    const reply = (resultado.reply ?? "").trim();
    const temTexto = reply.length > 0;

    // Envio real pelo sender do canal (anti-ban + trio de proteção intactos).
    // Sem sender, apenas devolvemos o reply/outbound para o chamador enviar.
    let enviou = false;
    if (temTexto && entrada.enviarTexto) {
      try {
        const r = await entrada.enviarTexto(reply);
        enviou = r !== false;
      } catch (e) {
        // Falha de envio não derruba o turno; o chamador vê `enviou=false`.
        console.warn(
          "[cerebro/resposta-hook] envio pelo canal falhou (não-bloqueante):",
          (e as { message?: string })?.message,
        );
        enviou = false;
      }
    }

    return {
      respondeu: true,
      flag,
      reply: temTexto ? reply : null,
      outbound: resultado.outbound ?? [],
      shouldHandoff: !!resultado.shouldHandoff || !temTexto,
      enviou,
      ...(resultado.acaoCadastro ? { acaoCadastro: resultado.acaoCadastro } : {}),
      ...(despachoCadastro ? { despachoCadastro } : {}),
      resultado,
    };
  } catch (e) {
    // Fail-open: erro no Cérebro NUNCA bloqueia o atendimento. O webhook cai no
    // caminho atual (vendedora/engine), preservando o comportamento.
    console.warn(
      "[cerebro/resposta-hook] erro engolido (fail-open → caminho atual):",
      (e as { message?: string })?.message,
    );
    return neutro(flag);
  }
}
