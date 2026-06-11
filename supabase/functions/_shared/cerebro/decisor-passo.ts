/**
 * N3 — Decisor de Passo (pt-BR). Peça central — o conserto.
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — peça N3 e seção
 * "Ligação N3 ↔ runEngine".
 *
 * Decide o próximo passo LENDO os passos montados no construtor visual
 * (`bot_flow_steps`) por meio do motor determinístico. O Cérebro fica SEMPRE
 * por fora do `runEngine` (que é função pura): N3 chama `loadContext` e
 * `runEngine`, repassa `DeferredAction` (OCR/portal/OTP) ao dispatcher
 * existente e aplica padrões de reparo. NÃO usa sequência fixa no código
 * (Requisito 6.2).
 *
 * Estado desta tarefa:
 *   - Tarefa 4.1 (FEITA): a BASE de decisão — `loadContext` + montagem do
 *     `InboundEvent` + `runEngine`, derivando `passoAtual`/`proximoPasso`/
 *     `acaoDeterministica` a partir de `bot_flow_steps` SEM sequência fixa
 *     (Requisito 6.1, 6.2, 6.3).
 *   - Tarefa 4.2 (FEITA): FONTE ÚNICA DE ETAPA (Requisito 6.4). A leitura da
 *     etapa atual/próxima foi centralizada na função pura `derivarEtapas`, que
 *     deriva ambos os passos SOMENTE do fluxo determinístico (`flow.steps` +
 *     `state.currentStepId`/`stateUpdate.currentStepId`). NÃO existe — em parte
 *     alguma do Cérebro — um detector/classificador de etapa por IA rodando em
 *     paralelo. A peça N2 (Entendimento) entende intenção/dados/objeção, JAMAIS
 *     etapa. A invariante é verificada em `__tests__/decisor-passo.test.ts`.
 *   - Tarefa 4.3 (FEITA): PADRÕES DE REPARO (Requisito 6.5, 6.6, 6.7). A função
 *     pura `detectarReparo` anota o TIPO de reparo (correção de dado, dúvida
 *     fora de hora, cancelamento) a partir do entendimento (N2) e do passo
 *     atual, e ajusta a reancoragem REUSANDO os passos do fluxo. Inspirada no
 *     `patterns.yml` do CALM, vira REGRA em TS — não código importado (ver
 *     design.md, "Aproveitamento dos clones"). NÃO cria uma segunda fonte de
 *     etapa: o passo de reancoragem é sempre um passo de `flow.steps`.
 *   - Tarefa 4.4 (FEITA): REPASSE DE `DeferredAction` AO DISPATCHER (Requisito
 *     6.1). A função pura `extrairAcaoCadastro` SELECIONA, da saída do motor, a
 *     `DeferredAction` de cadastro (`ocr`/`portal_submit`/`otp_submit`) e a
 *     EXPÕE em `ResultadoDecisor.acaoCadastro` para a N1 (Orquestrador, Tarefa
 *     7) encaminhar ao dispatcher EXISTENTE (`_shared/dispatcher/` + hooks de
 *     OCR/portal/OTP) — exatamente o caminho do engine v3. O Cérebro só
 *     REPASSA: NÃO executa OCR, worker do portal nem interceptação de OTP aqui.
 *     A peça N3 permanece pura quanto a I/O; o despacho é efeito colateral do
 *     orquestrador.
 */

import type {
  AcaoCadastroDeferida,
  BotFlowStep,
  DadosExtraidos,
  DeferredAction,
  EntradaDecisor,
  InboundEvent,
  ResultadoDecisor,
  ResultadoEntendimento,
  TipoReparo,
} from "./tipos.ts";

// REÚSO (Requisito 1.3, 1.4): a ligação com o motor determinístico passa pelas
// peças REAIS já testadas do engine v3. O Cérebro NÃO reimplementa ordenação de
// passos nem decisão — tudo isso vive no `runEngine`.
//   - `loadContext` (impuro: lê `bot_flow_steps`/`customer_flow_state`);
//   - `runEngine` (PURO: decide o passo a partir dos dados carregados);
//   - `defaultHooks` (contratos declarativos de OCR/OTP/portal/IA).
import { loadContext } from "../engine/loader.ts";
import { runEngine } from "../engine/runner.ts";
import { defaultHooks } from "../engine/hooks.ts";
import type { EngineConfig } from "../engine/types.ts";

/**
 * Decide o passo atual e o próximo a partir do fluxo do construtor visual.
 *
 * Fluxo (conforme design — "Ligação N3 ↔ runEngine"):
 *   1. `loadContext({ supabase, customerId, capabilities })` → `{ state, flow,
 *      capabilities }` (lê `bot_flow_steps` montados no construtor visual);
 *   2. monta o `InboundEvent` do turno (já chega tipado em `entrada.inbound`);
 *   3. `runEngine({ state, inbound, flow, capabilities, hooks, config })` →
 *      `{ outbound, stateUpdate, logs, deferred }`.
 *
 * A decisão de PASSO sai SEMPRE do `runEngine` (a partir de `bot_flow_steps`),
 * sem nenhuma sequência fixa escrita aqui (Requisito 6.1, 6.2). Quando o
 * consultor muda os passos no construtor visual, a decisão muda sozinha, sem
 * alteração de código (Requisito 6.3).
 *
 * @param entrada Cliente, mensagem recebida, entendimento e capacidades do canal.
 * @returns Passo atual/próximo, a ação determinística do motor e o reparo aplicado.
 */
export async function decidirPasso(
  entrada: EntradaDecisor,
): Promise<ResultadoDecisor> {
  const { supabase, customerId, inbound, capabilities } = entrada;

  // ─── 1. Carrega o contexto do motor (estado + fluxo + capacidades) ──────
  // `loadContext` é a ÚNICA fonte de `bot_flow_steps` — a ordem dos passos vem
  // daqui, nunca do código (Requisito 6.2).
  //
  // `permitirVariantB: true` — o Cérebro SUBSTITUI a Vendedora_Atual do Fluxo B
  // (Regra de Ouro do design): para ele, o fluxo B é comandado por
  // `bot_flow_steps` igual a A/D. Sem esta flag, o loader lançaria para B
  // (~99% dos clientes), derrubando o turno em handoff.
  const ctx = await loadContext({ supabase, customerId, capabilities, permitirVariantB: true });

  // ─── 2. Monta a configuração pura + hooks declarativos do motor ─────────
  // O `runEngine` é PURO: tempo, aleatoriedade e limites entram como dados via
  // `EngineConfig`. O Cérebro NUNCA injeta IA dentro do motor — a escrita da
  // mensagem fica com N4 (Escritor). Os hooks só DECLARAM as ações assíncronas
  // (OCR/OTP/portal/IA); quem as executa é o dispatcher existente.
  const config = montarConfig();
  const hooks = defaultHooks();

  // ─── 3. Decide o passo chamando o motor determinístico ──────────────────
  // O `InboundEvent` já chega tipado em `entrada.inbound` (montado pela porta
  // de entrada do Cérebro). Repassamos sem reescrever.
  const acaoDeterministica = runEngine({
    state: ctx.state,
    inbound,
    flow: ctx.flow,
    capabilities: ctx.capabilities,
    hooks,
    config,
  });

  // ─── 4. Deriva passoAtual / proximoPasso de bot_flow_steps ──────────────
  // Toda a leitura de etapa passa por `derivarEtapas` — a FONTE ÚNICA de etapa
  // (Requisito 6.4). Não existe segunda fonte: a etapa nasce de `flow.steps`
  // (montado no construtor visual) cruzado com os ids do fluxo determinístico
  // (`state.currentStepId` e `stateUpdate.currentStepId` do `runEngine`).
  const { passoAtual, proximoPasso } = derivarEtapas(
    ctx.flow.steps,
    ctx.state.currentStepId,
    acaoDeterministica.stateUpdate.currentStepId ?? null,
  );

  // ─── 5. Padrões de reparo (Tarefa 4.3 — Requisito 6.5, 6.6, 6.7) ────────
  // A partir do entendimento (N2) e do passo atual, anotamos o TIPO de reparo
  // e calculamos o passo de REANCORAGEM. Tudo derivado de `flow.steps` (a fonte
  // única de etapa) — o reparo NUNCA fabrica um passo novo nem cria uma segunda
  // fonte de etapa. Quando não há reparo, `proximoPasso` segue o do motor.
  const { reparo, passoReancoragem } = detectarReparo(
    entrada.entendimento,
    inbound,
    passoAtual,
    proximoPasso,
    ctx.flow.steps,
  );

  // ─── 6. Repasse do pipeline de cadastro (Tarefa 4.4 — Requisito 6.1) ────
  // Se o motor produziu uma `DeferredAction` de cadastro (`ocr`,
  // `portal_submit`, `otp_submit`), apenas a EXTRAÍMOS para a N1 (Orquestrador)
  // encaminhar ao dispatcher EXISTENTE (`_shared/dispatcher/` + hooks de
  // OCR/portal/OTP) — o mesmo caminho do engine v3. A peça N3 NÃO executa OCR,
  // portal nem OTP por conta própria; o despacho é efeito colateral que
  // pertence ao orquestrador/caminho existente (mantém N3 pura quanto a I/O).
  const acaoCadastro = extrairAcaoCadastro(acaoDeterministica.deferred);

  return {
    passoAtual,
    // A reancoragem do reparo só REDIRECIONA para um passo já existente do
    // fluxo. Sem reparo, mantém o próximo passo decidido pelo motor.
    proximoPasso: passoReancoragem ?? proximoPasso,
    acaoDeterministica,
    ...(acaoCadastro ? { acaoCadastro } : {}),
    ...(reparo ? { reparo } : {}),
  };
}

/**
 * Conjunto FECHADO dos tipos de `DeferredAction` que pertencem ao PIPELINE DE
 * CADASTRO (Requisito 6.1) e que o dispatcher existente sabe executar. As
 * deferred de IA (`ai_answer`/`ai_decide`) NÃO entram aqui: a escrita da
 * resposta é da peça N4, não do repasse ao dispatcher de cadastro.
 */
const TIPOS_ACAO_CADASTRO = new Set(["ocr", "portal_submit", "otp_submit"]);

/**
 * REPASSE DE `DeferredAction` AO DISPATCHER (Tarefa 4.4 — Requisito 6.1).
 *
 * Função PURA que apenas SELECIONA, da saída do motor, a `DeferredAction` de
 * cadastro a ser despachada — sem executá-la. Devolve a própria ação (mesmo
 * formato do motor, sem reescrever) quando for `ocr`/`portal_submit`/
 * `otp_submit`; caso contrário (sem deferred, ou deferred de IA) devolve
 * `undefined`.
 *
 * Quem EXECUTA é o dispatcher existente, acionado pela N1 (Tarefa 7). Esta
 * função é a fronteira que mantém a peça N3 sem efeito colateral: ela só expõe
 * "o que" deve ser despachado, nunca "como".
 *
 * @param deferred A `DeferredAction` opcional vinda de `runEngine`.
 * @returns A ação de cadastro a repassar, ou `undefined` quando não há.
 */
export function extrairAcaoCadastro(
  deferred: DeferredAction | undefined,
): AcaoCadastroDeferida | undefined {
  if (!deferred) return undefined;
  if (!TIPOS_ACAO_CADASTRO.has(deferred.kind)) return undefined;
  // O `kind` pertence ao conjunto de cadastro: estreitamento seguro de tipo.
  return deferred as AcaoCadastroDeferida;
}

/**
 * FONTE ÚNICA DE ETAPA (Requisito 6.4).
 *
 * Esta é a ÚNICA função do Cérebro autorizada a dizer "em que passo o cliente
 * está" e "para qual passo ele vai". Ela deriva ambos os passos SOMENTE do
 * fluxo determinístico:
 *
 *   - `passoAtual`   ← `state.currentStepId` (posição registrada em
 *     `customer_flow_state`, escrita pelo motor em turnos anteriores);
 *   - `proximoPasso` ← `stateUpdate.currentStepId` do `runEngine`; se o motor
 *     não troca de passo neste turno, mantém-se em `passoAtual`.
 *
 * INVARIANTE: nenhum dos parâmetros vem de IA. O entendimento da peça N2
 * (intenção/dados/objeção) NÃO entra aqui — de propósito. Não há, em parte
 * alguma do Cérebro, um detector/classificador de etapa por IA rodando em
 * paralelo a esta função. Centralizar a leitura aqui torna essa invariante
 * verificável (ver `__tests__/decisor-passo.test.ts`) e impede que uma segunda
 * fonte de etapa surja por descuido em futuras tarefas (4.3/4.4).
 *
 * Função pura: mesma entrada → mesma saída, sem relógio, rede ou aleatoriedade.
 *
 * @param steps Passos do fluxo carregados de `bot_flow_steps` (única fonte).
 * @param idAtual Id do passo atual vindo do estado determinístico (ou `null`).
 * @param idProximo Id do próximo passo decidido pelo `runEngine` (ou `null`).
 */
export function derivarEtapas(
  steps: BotFlowStep[],
  idAtual: string | null,
  idProximo: string | null,
): { passoAtual: BotFlowStep | null; proximoPasso: BotFlowStep | null } {
  const passoAtual = resolverPasso(steps, idAtual);
  // Quando o motor não devolve um próximo passo, a etapa permanece a atual —
  // ainda assim derivada do fluxo, nunca de outra fonte.
  const proximoPasso = resolverPasso(steps, idProximo ?? idAtual);
  return { passoAtual, proximoPasso };
}

/**
 * Resolve um id de passo contra a lista de passos do fluxo carregado.
 * Retorna `null` para id ausente (cliente novo) ou id que não existe mais no
 * fluxo (passo removido no construtor visual).
 */
function resolverPasso(
  steps: BotFlowStep[],
  stepId: string | null,
): BotFlowStep | null {
  if (!stepId) return null;
  return steps.find((s) => s.id === stepId) ?? null;
}

// ─── Padrões de reparo (Tarefa 4.3 — Requisito 6.5, 6.6, 6.7) ────────────────
//
// Inspirados no `patterns.yml` do CALM (ver design.md, "Aproveitamento dos
// clones"): viram REGRA em TypeScript, não código importado. São padrões
// determinísticos e enxutos — não há lógica equivalente reutilizável na
// vendedora antiga (a detecção de cancelar/corrigir lá vive espalhada por
// `bot-flow.ts`, acoplada a steps fixos; aqui é uma regra pura e isolada).
//
// O reparo APENAS anota o tipo e ajusta a reancoragem usando os passos do
// fluxo. NÃO cria uma segunda fonte de etapa: o passo de reancoragem é sempre
// um passo já presente em `flow.steps` (ou o próprio passo atual).

/**
 * Marcadores de CANCELAMENTO (Requisito 6.7). Conjunto fechado e enxuto;
 * ajustável conforme padrões observados em sombra.
 */
const RE_CANCELAMENTO =
  /\b(cancelar|cancela|desistir|desisto|parar|chega|n[aã]o quero mais|esquece|esque[çc]a)\b|\bn[aã]o quero\b/i;

/**
 * Marcadores de CORREÇÃO de dado já informado (Requisito 6.5). Sinalizam que o
 * cliente está retificando algo que já disse ("na verdade…", "errei…").
 */
const RE_CORRECAO =
  /\b(na verdade|errei|me enganei|corrigir|corrige|corre[çc][ãa]o|troca|trocar|mudar|digo|quis dizer|n[aã]o (?:[ée]|era))\b/i;

/**
 * Padrão de reparo detectado e o passo de reancoragem derivado do fluxo.
 * `reparo` indefinido = turno normal (sem reparo). `passoReancoragem`
 * indefinido = mantém o próximo passo decidido pelo motor.
 */
interface ResultadoReparo {
  reparo?: TipoReparo;
  passoReancoragem?: BotFlowStep | null;
}

/**
 * Detecta o padrão de reparo do turno e calcula a reancoragem (Requisito 6.5,
 * 6.6, 6.7). Função PURA: depende só do entendimento (N2), do inbound e dos
 * passos do fluxo.
 *
 * Prioridade (do mais forte ao mais fraco):
 *   1. `cancelamento`         — cliente pede para parar/cancelar (Req 6.7);
 *   2. `correcao_dado`        — cliente corrige um dado já informado (Req 6.5);
 *   3. `duvida_fora_de_hora`  — cliente pergunta fora do momento (Req 6.6).
 *
 * @param entendimento Intenção/dados/objeção da peça N2.
 * @param inbound Evento de entrada do turno (para ler o texto cru).
 * @param passoAtual Passo atual derivado do fluxo (fonte única de etapa).
 * @param proximoPasso Próximo passo decidido pelo motor (do fluxo).
 * @param steps Passos do fluxo (`bot_flow_steps`) — única fonte de etapa.
 */
export function detectarReparo(
  entendimento: ResultadoEntendimento,
  inbound: InboundEvent,
  passoAtual: BotFlowStep | null,
  proximoPasso: BotFlowStep | null,
  steps: BotFlowStep[],
): ResultadoReparo {
  const texto = textoDoInbound(inbound);

  // 1. CANCELAMENTO (Req 6.7) — intenção de desistir OU marcador no texto.
  //    Reancora no passo de cancelamento do fluxo, se existir; senão só anota.
  if (entendimento.intencao === "desistir" || RE_CANCELAMENTO.test(texto)) {
    return {
      reparo: "cancelamento",
      passoReancoragem: acharPassoCancelamento(steps),
    };
  }

  // 2. CORREÇÃO DE DADO (Req 6.5) — o cliente retifica um dado já informado.
  //    Exige um marcador de correção E pelo menos um dado extraído (N2).
  //    Retoma o passo que CAPTURA aquele dado (passo apropriado do fluxo).
  if (RE_CORRECAO.test(texto) && temDadoExtraido(entendimento.dados)) {
    const passoDoDado = acharPassoDoDado(steps, entendimento.dados);
    return {
      reparo: "correcao_dado",
      // Sem passo de captura correspondente no fluxo, mantém a etapa atual em
      // vez de inventar destino (continua sendo etapa do fluxo).
      passoReancoragem: passoDoDado ?? passoAtual,
    };
  }

  // 3. DÚVIDA FORA DE HORA (Req 6.6) — pergunta inesperada (intenção indefinida
  //    + interrogação). Trata a dúvida e REANCORA no passo atual do fluxo.
  if (entendimento.intencao === "indefinido" && texto.includes("?")) {
    return {
      reparo: "duvida_fora_de_hora",
      passoReancoragem: passoAtual,
    };
  }

  // Sem reparo: segue o próximo passo decidido pelo motor.
  void proximoPasso;
  return {};
}

/** Lê o texto cru do inbound (texto ou rótulo de botão). Vazio para mídia/etc. */
function textoDoInbound(inbound: InboundEvent): string {
  if (inbound.kind === "text") return inbound.text;
  if (inbound.kind === "button_click") return inbound.rawText ?? "";
  if (inbound.kind === "number_reply") return inbound.raw;
  return "";
}

/** Há algum dado de cadastro extraído pela N2? */
function temDadoExtraido(dados: DadosExtraidos): boolean {
  if (dados.nome != null || dados.valorConta != null || dados.email != null) {
    return true;
  }
  return dados.outros != null && Object.keys(dados.outros).length > 0;
}

/**
 * Acha o passo que CAPTURA o dado corrigido, cruzando os campos extraídos com
 * `step.captures[].field`. Retorna o primeiro passo correspondente na ordem do
 * fluxo, ou `null` quando nenhum passo captura aquele campo.
 */
function acharPassoDoDado(
  steps: BotFlowStep[],
  dados: DadosExtraidos,
): BotFlowStep | null {
  const campos = camposCorrigidos(dados);
  if (campos.length === 0) return null;
  for (const step of steps) {
    for (const cap of step.captures) {
      if (cap.enabled !== false && campoCasa(cap.field, campos)) {
        return step;
      }
    }
  }
  return null;
}

/** Lista os "apelidos" dos campos que o cliente corrigiu, para casar com captures. */
function camposCorrigidos(dados: DadosExtraidos): string[] {
  const campos: string[] = [];
  if (dados.nome != null) campos.push("nome", "name");
  if (dados.valorConta != null) campos.push("valor", "conta", "bill", "value");
  if (dados.email != null) campos.push("email", "e-mail");
  if (dados.outros) campos.push(...Object.keys(dados.outros));
  return campos.map((c) => c.toLowerCase());
}

/** O `field` de uma captura casa com algum apelido de campo corrigido? */
function campoCasa(field: string, apelidos: string[]): boolean {
  const f = field.toLowerCase();
  return apelidos.some((a) => f === a || f.includes(a) || a.includes(f));
}

/**
 * Acha o passo de cancelamento previsto no fluxo (Requisito 6.7). Procura por
 * pistas em `stepKey`/`slotKey` (ex.: "cancel", "desistencia", "saida"). O
 * fluxo é a única fonte: se o consultor não modelou um passo de cancelamento,
 * retorna `null` e o reparo só anota o tipo (sem inventar destino).
 */
function acharPassoCancelamento(steps: BotFlowStep[]): BotFlowStep | null {
  const RE = /(cancel|desist|saida|sa[íi]da|encerr|abandon)/i;
  return steps.find(
    (s) => RE.test(s.stepKey ?? "") || RE.test(s.slotKey ?? ""),
  ) ?? null;
}

/**
 * Monta a `EngineConfig` pura do turno. Espelha os valores já usados no caminho
 * de sombra (`engine/webhook-hook.ts`) para manter PARIDADE de decisão com o
 * motor v3 enquanto o Cérebro roda em sombra (Requisito 3.2). `now`,
 * `minuteBucket` e as funções determinísticas entram como dados — o motor
 * nunca lê relógio nem gera aleatoriedade por conta própria.
 */
function montarConfig(): EngineConfig {
  const nowMs = Date.now();
  return {
    now: new Date(nowMs).toISOString(),
    minuteBucket: Math.floor(nowMs / 60_000),
    // O Cérebro decide o passo; o ENVIO é controlado pela porta de entrada (N1)
    // conforme o modo da chave de ativação. Mantemos `isDarkMode` ligado aqui
    // por segurança: a decisão de enviar nunca nasce dentro do motor.
    isDarkMode: true,
    allowedDomains: ["igreen.energy"],
    idempotencyKeyFn: (parts) => `${parts.stepId}:${parts.content}:${parts.minuteBucket}`,
    humanDelayFn: (charLen) => Math.min(12_000, Math.max(2_000, charLen * 60)),
    limits: { maxOutboundsPerTurn: 6, maxRetriesBeforeHandoff: 3, maxAiQuestionsPerStep: 3 },
  };
}
