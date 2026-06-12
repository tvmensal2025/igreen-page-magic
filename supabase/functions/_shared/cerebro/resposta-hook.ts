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
import { getFlowEngineV3, isV2Active, isCerebroAtivo, type FlowEngineV3Flag } from "../feature-flag.ts";
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
 * Lista de NÚMEROS DE TESTE (modo de validação controlada).
 * --------------------------------------------------------
 * Quando o número que escreveu está nesta lista, o Cérebro RESPONDE de verdade
 * mesmo que o consultor esteja em `off`/`dark`. Serve para validar o Cérebro ao
 * vivo com um aparelho de teste SEM ligar o consultor inteiro (sem tocar nos
 * clientes reais). Qualquer outro número segue a regra normal da flag (em
 * `dark` quem responde é a vendedora antiga).
 *
 * FONTE: coluna `rollout_config.cerebro_numeros_teste` (texto CSV de números).
 * Trocar a lista NÃO exige deploy — só um `UPDATE` na tabela (vale na hora,
 * respeitando o cache de 30s). Em produção, manter VAZIA quando não estiver
 * testando. Comparação por dígitos, ignorando `+`, espaços e traços.
 *
 * Cache GLOBAL de 30s (a lista é única, não por consultor): no máximo 1 leitura
 * a cada 30s por instância de Edge Function. Nunca lança: erro → lista vazia
 * (nenhum número de teste, fail-safe).
 */
export function soDigitos(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\D/g, "");
}

const TTL_NUMEROS_TESTE_MS = 30_000;
let _cacheNumerosTeste: { valor: Set<string>; expiraEm: number } | null = null;

/** Limpa o cache da lista de números de teste (para testes). */
export function limparCacheNumerosTeste(): void {
  _cacheNumerosTeste = null;
}

/** Converte um CSV de números em Set de dígitos (descarta vazios/curtos). */
function parseNumeros(csv: string | null | undefined): Set<string> {
  const numeros = String(csv ?? "")
    .split(",")
    .map((n) => soDigitos(n))
    .filter((n) => n.length >= 8);
  return new Set(numeros);
}

/**
 * Lê a lista de números de teste do banco (`rollout_config`), com cache global
 * de 30s. Fail-safe: qualquer erro → lista vazia. Se `supabase` não for
 * fornecido, usa só o cache (ou vazio) — assim funções puras de teste podem
 * injetar a lista sem rede.
 */
export async function lerNumerosTeste(
  supabase?: AnySupabase,
): Promise<Set<string>> {
  const agora = Date.now();
  if (_cacheNumerosTeste && _cacheNumerosTeste.expiraEm > agora) {
    return _cacheNumerosTeste.valor;
  }
  let valor = new Set<string>();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("rollout_config")
        .select("cerebro_numeros_teste")
        .eq("id", true)
        .single();
      if (!error && data) {
        valor = parseNumeros((data as { cerebro_numeros_teste?: string }).cerebro_numeros_teste);
      }
    } catch {
      valor = new Set();
    }
  }
  _cacheNumerosTeste = { valor, expiraEm: agora + TTL_NUMEROS_TESTE_MS };
  return valor;
}

/**
 * Diz se um número está na lista de teste. Compara por sufixo de dígitos para
 * tolerar variações de DDI/9º dígito (ex.: `5511971254913` casa com
 * `11971254913`). Fail-safe: lista vazia → sempre `false`.
 */
export function ehNumeroDeTeste(
  telefone: string | null | undefined,
  numerosTeste: Set<string>,
): boolean {
  const alvo = soDigitos(telefone);
  if (!alvo || !numerosTeste || numerosTeste.size === 0) return false;
  for (const n of numerosTeste) {
    if (n === alvo || alvo.endsWith(n) || n.endsWith(alvo)) return true;
  }
  return false;
}

/**
 * Versão de conveniência que lê a lista do banco (cacheada) e checa o número.
 * É o que os webhooks chamam. Nunca lança.
 */
export async function ehNumeroDeTesteAsync(
  telefone: string | null | undefined,
  supabase?: AnySupabase,
): Promise<boolean> {
  try {
    const lista = await lerNumerosTeste(supabase);
    return ehNumeroDeTeste(telefone, lista);
  } catch {
    return false;
  }
}

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
  inboundKind?:
    | "text"
    | "button_click"
    | "media"
    | "timer_expired"
    | "no_input"
    | "nudge_interno";
  inboundText?: string | null;
  inboundButtonId?: string | null;
  inboundMediaKind?: "image" | "audio" | "video" | "document" | null;
  inboundMessageId?: string | null;
  /** Canal do webhook que originou o turno. */
  channel?: CanalWebhook;
  /**
   * Telefone do cliente (dígitos ou formato livre). Usado SÓ para o modo de
   * número de teste: se este número estiver em `CEREBRO_NUMEROS_TESTE`, o
   * Cérebro responde mesmo com o consultor em `off`/`dark`. Ausente → modo
   * normal (decide só pela flag).
   */
  telefone?: string | null;
  /** Capacidades do canal; ausente → default permissivo por canal. */
  capabilities?: ChannelCapabilities;
  /**
   * Sender do canal (anti-ban + trio de proteção intactos). Ausente → a função
   * não envia, só devolve `reply`/`outbound` para o chamador enviar.
   */
  enviarTexto?: EnviarTexto;
  /**
   * NUDGE INTERNO (Fase 2 da migração Vendedora→Cérebro): contexto textual do
   * gatilho de reaquecimento disparado pelo cron `process-followups`. Só faz
   * sentido com `inboundKind === "nudge_interno"`. Para o Cérebro o turno é
   * tratado como `no_input` (a porta de reaquecimento que o motor já entende —
   * ver `followup-hook.ts`); o `nudgeHook` fica registrado em `ai_decisions`
   * para auditoria. Ausente → nudge genérico.
   */
  nudgeHook?: string | null;
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
 * EXCEÇÃO — NÚMERO DE TESTE: se `telefone` estiver na lista
 * `CEREBRO_NUMEROS_TESTE`, responde MESMO em `off`/`dark`. Isso permite validar
 * o Cérebro ao vivo com um aparelho de teste sem ligar o consultor inteiro
 * (clientes reais seguem na vendedora antiga).
 *
 * Nunca lança. É a peça pequena e testável que os webhooks consultam.
 */
export async function deveResponderComCerebro(
  supabase: AnySupabase,
  consultantId: string,
  deps: DependenciasResposta = {},
  telefone?: string | null,
): Promise<{ responder: boolean; flag: FlowEngineV3Flag; motivo: "flag" | "numero_teste" | "cerebro_ativo" }> {
  const lerFlag = deps.lerFlag ?? getFlowEngineV3;
  let flag: FlowEngineV3Flag = "off";
  try {
    flag = await lerFlag(supabase, consultantId);
  } catch (e) {
    console.warn(
      "[cerebro/resposta-hook] leitura de flag falhou (fail-open → caminho atual):",
      (e as { message?: string })?.message,
    );
    flag = "off";
  }
  // Número de teste tem prioridade: libera o Cérebro mesmo em off/dark, sem
  // afetar nenhum cliente real (que não está na lista). Lê do banco (cacheado).
  if (await ehNumeroDeTesteAsync(telefone, supabase)) {
    return { responder: true, flag, motivo: "numero_teste" };
  }
  // FLAG DEDICADA do Cérebro (`cerebro_ativo='on'`): é a chave para o Cérebro
  // ser a fonte de verdade de TODOS os clientes do consultor SEM acionar o gate
  // do engine v3 (que reage a `flow_engine_v3='on'`). Fail-safe: erro → false.
  try {
    if (await isCerebroAtivo(supabase, consultantId)) {
      return { responder: true, flag, motivo: "cerebro_ativo" };
    }
  } catch {
    // ignora — segue para o critério da flag de rollout
  }
  // `isV2Active` é o MESMO critério do engine v3: canary OU on = fonte de
  // verdade. Em canary, a pertinência ao subconjunto já está embutida na flag
  // do consultor (gravada pelo cron de rollout).
  return { responder: isV2Active(flag), flag, motivo: "flag" };
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
    const decisao = await deveResponderComCerebro(supabase, consultantId, deps, entrada.telefone);
    flag = decisao.flag;

    // OBSERVABILIDADE (diagnóstico de ativação): registra, best-effort, o
    // resultado do GATE deste hook em `ai_decisions` (phase `cerebro_resposta`).
    // Nunca lança nem afeta o turno. Permite auditar por que o Cérebro
    // respondeu ou não (gate/flag/numero de teste) sem depender de logs.
    try {
      await supabase.from("ai_decisions").insert({
        customer_id: customerId,
        consultant_id: consultantId,
        phase: "cerebro_resposta",
        source: "cerebro_gate",
        suppressed: !decisao.responder,
        channel: entrada.channel ?? null,
        user_input: entrada.inboundText ?? null,
        ai_output: {
          gate: {
            responder: decisao.responder,
            motivo: decisao.motivo,
            flag: decisao.flag,
            telefone: entrada.telefone ?? null,
          },
        },
      });
    } catch (_) { /* best-effort: nunca derruba o turno */ }

    // GATE: só responde quando o Cérebro é fonte de verdade (canary/on).
    // Em `off`/`dark` o envio NÃO é responsabilidade deste hook (o sombra-hook
    // cuida do `dark`; em `off` o Cérebro fica inativo).
    if (!decisao.responder) {
      return neutro(flag);
    }

    // NUDGE INTERNO (Fase 2): o cron `process-followups` chama este hook com
    // `inboundKind="nudge_interno"` para reaquecer um lead silente. Para o
    // motor, equivale a um turno `no_input` (mesma porta de reaquecimento do
    // `followup-hook`); o `nudgeHook` textual fica registrado em
    // `ai_decisions` para auditoria — o Cérebro NÃO precisa do texto do hook
    // como inbound, ele já lê o estado/fluxo e decide.
    const ehNudgeInterno = entrada.inboundKind === "nudge_interno";
    const inbound = ehNudgeInterno
      ? ({ kind: "no_input" } as const)
      : montarInbound(entrada);
    if (ehNudgeInterno) {
      try {
        await supabase.from("ai_decisions").insert({
          customer_id: customerId,
          consultant_id: consultantId,
          phase: "cerebro_resposta_nudge",
          source: "cerebro_nudge_interno",
          channel: entrada.channel ?? null,
          ai_output: { nudgeHook: (entrada.nudgeHook ?? "").slice(0, 500) || null },
        });
      } catch (_) { /* best-effort */ }
    }
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

    // OBSERVABILIDADE: registra o RESULTADO do turno respondido pelo Cérebro
    // (best-effort). Mostra se houve texto, se enviou e se foi handoff.
    try {
      await supabase.from("ai_decisions").insert({
        customer_id: customerId,
        consultant_id: consultantId,
        phase: "cerebro_resposta_envio",
        source: "cerebro_on",
        suppressed: !temTexto,
        reply_sent: temTexto ? reply : null,
        channel: entrada.channel ?? null,
        user_input: entrada.inboundText ?? null,
        ai_output: {
          enviou,
          temTexto,
          shouldHandoff: !!resultado.shouldHandoff,
          flag,
        },
      });
    } catch (_) { /* best-effort */ }

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
