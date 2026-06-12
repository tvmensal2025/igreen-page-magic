/**
 * N1 — Orquestrador do Cérebro IA (pt-BR).
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — seção "Components and Interfaces",
 * peça N1, e "Fluxo de um turno".
 *
 * Porta de entrada ÚNICA do Cérebro. Coordena as peças na ordem
 * N8 (lê estado) → N2 (entendimento) → N3 (decisor) → N4 (escritor) →
 * N5 (guarda) → N8 (grava estado), e devolve o `ResultadoCerebro`. NÃO tem
 * regra de negócio própria — só liga as peças. Substitui o papel de
 * `vendedora/orchestrator.ts`. (Tarefa 7 — ainda SEM webhook.)
 *
 * GARANTIAS (Error Handling do design + Requisitos 1.3, 16.5):
 *   - Fail-open geral: qualquer erro em qualquer peça → retorno vazio/handoff;
 *     `processarTurno` NUNCA lança (igual ao padrão de `runEngineV3IfEnabled`).
 *   - Teto de 25s (C3): se o turno estourar o tempo, devolve handoff em vez de
 *     travar o atendimento.
 *   - A mensagem só "sai" se a Guarda (N5) aprovar. Guarda bloqueou ou Escritor
 *     veio vazio → `shouldHandoff = true` e `reply` vazio (sem outbound).
 *   - Repasse do pipeline de cadastro: a `DeferredAction` de cadastro
 *     (`ocr`/`portal_submit`/`otp_submit`) é apenas COMPOSTA no resultado
 *     (`acaoCadastro`) para que quem chamar o Cérebro (webhook futuro) acione o
 *     dispatcher EXISTENTE. O Orquestrador NÃO executa OCR/portal/OTP aqui.
 *
 * REÚSO (não recria nada fora desta pasta): N8/N2/N3/N4/N5 já implementadas e a
 * recuperação de conteúdo via `vendedora/rag.ts` (fail-open).
 */

import type {
  DecisaoCerebro,
  EntradaCerebro,
  EntradaEscritor,
  EstadoCerebro,
  InboundEvent,
  IntencaoComercial,
  MemoriaEmCamadas,
  ResultadoCerebro,
  ResultadoDecisor,
  ResultadoEntendimento,
} from "./tipos.ts";

// Peças do núcleo (já implementadas e testadas isoladamente).
import { lerEstado, atualizarEstado } from "./estado.ts"; // N8
import { entenderMensagem } from "./entendimento.ts"; // N2
import { decidirPasso } from "./decisor-passo.ts"; // N3
import { escreverMensagem } from "./escritor.ts"; // N4
import { validarMensagem } from "./guarda.ts"; // N5

// REÚSO (Requisito 8.3): recuperação de conteúdo via RAG da Vendedora_Atual. A
// própria `buscarContexto` já é fail-open (devolve [] em erro); ainda assim a
// envolvemos em try/catch para o turno nunca travar por causa do RAG.
import { buscarContexto, formatChunks } from "./comum/rag.ts";
import type { Etapa } from "./comum/types.ts";

/** Teto de tempo de um turno (C3 do design). Estourou → handoff. */
const TETO_TURNO_MS = 25_000;

/**
 * Processa um turno de conversa coordenando as peças do núcleo.
 *
 * Ordem (design — "Fluxo de um turno"): N8 lê estado → N2 entende → N3 decide o
 * passo (via `runEngine`) → N4 escreve → N5 guarda valida → N8 grava estado.
 *
 * Fail-open total: envolve o turno num teto de 25s e captura qualquer erro,
 * devolvendo sempre um `ResultadoCerebro` seguro (handoff) em vez de lançar.
 *
 * @param entrada Estado da conversa, mensagem recebida e capacidades do canal.
 * @returns Resposta, comandos de envio, atualização de estado e a decisão do turno.
 */
export function processarTurno(
  entrada: EntradaCerebro,
): Promise<ResultadoCerebro> {
  // O teto de 25s e o fail-open ficam aqui, na fronteira: a coordenação interna
  // (`executarTurno`) pode falhar à vontade que o atendimento nunca trava.
  return comTeto(
    executarTurno(entrada),
    TETO_TURNO_MS,
    () => handoff("indefinido"),
  );
}

/**
 * Coordena as peças do núcleo na ordem do design. Pode lançar/rejeitar: a
 * fronteira `processarTurno` converte qualquer falha em handoff (fail-open).
 */
async function executarTurno(
  entrada: EntradaCerebro,
): Promise<ResultadoCerebro> {
  const { supabase, customerId, consultantId, inbound, canalCapabilities } = entrada;

  // ─── N8 — lê o estado (onde o cliente parou) ────────────────────────────
  const estado: EstadoCerebro = await lerEstado({ supabase, customerId });

  // ─── N2 — Entendimento (intenção + dados + objeção) ─────────────────────
  const entendimento: ResultadoEntendimento = await entenderMensagem({
    inboundText: textoDoInbound(inbound),
    historico: [],
    estado: estado.snapshot,
  });

  // ─── N3 — Decisor de Passo (lê bot_flow_steps via runEngine) ────────────
  const decisor: ResultadoDecisor = await decidirPasso({
    supabase,
    customerId,
    inbound,
    entendimento,
    capabilities: canalCapabilities,
  });

  // A decisão do turno (passo/ação/intenção) é montada cedo: ela é registrada
  // em sombra (N10) e devolvida mesmo quando o turno termina em handoff.
  const decisao: DecisaoCerebro = montarDecisao(entendimento.intencao, decisor);

  // O estado a persistir/devolver é SEMPRE o que o motor determinístico decidiu
  // (fonte única de etapa, Requisito 6.4). O Cérebro não inventa estado.
  const stateUpdate = decisor.acaoDeterministica.stateUpdate;

  // O motor sinalizou handoff (ex.: variante não suportada, lead pediu humano,
  // fluxo vazio)? Nesse caso nem escrevemos: o turno vai para humano.
  if (motorPediuHandoff(decisor)) {
    await gravarEstado(supabase, customerId, stateUpdate);
    return {
      reply: "",
      outbound: [],
      stateUpdate,
      shouldHandoff: true,
      decisao,
      ...(decisor.acaoCadastro ? { acaoCadastro: decisor.acaoCadastro } : {}),
    };
  }

  // ─── N4 — Escritor (usa RAG + memória + gateway) ────────────────────────
  // O passo cuja mensagem é APRESENTADA neste turno é o que o motor decidiu
  // entregar: ao avançar, `proximoPasso`; ao permanecer, `passoAtual`
  // (`proximoPasso === passoAtual`). Para cliente novo, `passoAtual` é null e o
  // motor entra no passo de entrada (`proximoPasso`). A mesma referência é
  // usada pela Guarda, para validar o texto contra o passo a que ele pertence.
  const passoApresentado = decisor.proximoPasso ?? decisor.passoAtual;

  // RAG e persona montados a partir do estado/memória (fail-open).
  const { ragText, persona } = await montarRagEPersona(
    supabase,
    consultantId,
    estado,
    entendimento,
    inbound,
  );

  const entradaEscritor: EntradaEscritor = {
    passoAtual: passoApresentado,
    entendimento,
    estado,
    ragText,
    memoria: estado.memoria,
    persona,
  };
  const escrito = await escreverMensagem(entradaEscritor);

  // ─── N5 — Guarda valida o texto (ponto ÚNICO antes de qualquer envio) ───
  const guarda = await validarMensagem({
    textoProposto: escrito.texto,
    passoAtual: passoApresentado,
    estado: estado.snapshot,
  });

  // A mensagem só "sai" se a Guarda aprovar E houver texto. Caso contrário,
  // handoff com reply vazio (nada é enviado).
  const textoFinal = guarda.aprovado ? guarda.textoFinal.trim() : "";
  const enviar = textoFinal.length > 0;

  // ─── N8 — grava o estado atualizado (campo a campo) ─────────────────────
  await gravarEstado(supabase, customerId, stateUpdate);

  return {
    reply: enviar ? textoFinal : "",
    outbound: enviar ? [montarOutboundTexto(textoFinal)] : [],
    stateUpdate,
    shouldHandoff: !enviar,
    decisao,
    // Repasse do pipeline de cadastro: apenas COMPÕE o resultado para o
    // dispatcher existente ser acionado por quem chamar (webhook futuro).
    ...(decisor.acaoCadastro ? { acaoCadastro: decisor.acaoCadastro } : {}),
  };
}

// ─── Auxiliares (sem regra de negócio — só coordenação) ──────────────────────

/**
 * Resultado seguro de handoff: nada sai ao cliente. Usado em fail-open (erro
 * ou estouro de 25s) e quando o motor/Guarda impedem o envio. `stateUpdate`
 * vazio = não altera estado nenhum (postura conservadora).
 */
function handoff(intencao: IntencaoComercial): ResultadoCerebro {
  return {
    reply: "",
    outbound: [],
    stateUpdate: {},
    shouldHandoff: true,
    decisao: {
      passoAtualId: null,
      proximoPassoId: null,
      intencao,
      // sem reparo
    },
  };
}

/** Monta a decisão do turno (registrada em sombra por N10 — Requisito 3.1). */
function montarDecisao(
  intencao: IntencaoComercial,
  decisor: ResultadoDecisor,
): DecisaoCerebro {
  return {
    passoAtualId: decisor.passoAtual?.id ?? null,
    proximoPassoId: decisor.proximoPasso?.id ?? null,
    intencao,
    ...(decisor.reparo ? { reparo: decisor.reparo } : {}),
  };
}

/**
 * O motor determinístico sinalizou que este turno vai para humano? O
 * `runEngine` marca `status: "paused_system"` e emite `engine_handoff` nesses
 * casos (variante não suportada, fluxo vazio, lead pediu humano, etc.).
 */
function motorPediuHandoff(decisor: ResultadoDecisor): boolean {
  const saida = decisor.acaoDeterministica;
  if (saida.stateUpdate?.status === "paused_system") return true;
  return saida.logs?.some((l) => l.kind === "engine_handoff") ?? false;
}

/** Constrói o outbound de texto do reply. `idempotencyContent` nunca vazio. */
function montarOutboundTexto(texto: string): ResultadoCerebro["outbound"][number] {
  return { kind: "text", text: texto, idempotencyContent: texto };
}

/**
 * Grava o estado atualizado pela N8 (campo a campo), best-effort: uma falha de
 * escrita não derruba o turno nem o envio já decidido (fail-open). Não grava
 * quando não há nada a alterar.
 */
async function gravarEstado(
  supabase: EntradaCerebro["supabase"],
  customerId: string,
  patch: ResultadoCerebro["stateUpdate"],
): Promise<void> {
  if (!patch || Object.keys(patch).length === 0) return;
  try {
    await atualizarEstado({ supabase, customerId, patch });
  } catch (e) {
    console.warn(
      "[cerebro/index] gravarEstado falhou (segue mesmo assim):",
      (e as { message?: string })?.message,
    );
  }
}

/**
 * Monta o `ragText` e a `persona` que o Escritor (N4) consome, a partir do
 * estado/memória, reusando o RAG da Vendedora_Atual de forma FAIL-OPEN.
 *
 * - persona: lida da memória em camadas (perfil/operacional), quando o consultor
 *   tiver uma configurada; senão `null` (o Escritor usa a persona padrão).
 * - ragText: só consultamos o RAG quando há texto do cliente para buscar
 *   (controle de custo de IA — Requisito 16.5). Qualquer erro → `""`.
 */
async function montarRagEPersona(
  supabase: EntradaCerebro["supabase"],
  consultantId: string,
  estado: EstadoCerebro,
  entendimento: ResultadoEntendimento,
  inbound: InboundEvent,
): Promise<{ ragText: string; persona: string | null }> {
  const persona = lerPersona(estado.memoria);

  const query = textoDoInbound(inbound).trim();
  if (!query) return { ragText: "", persona };

  try {
    const chunks = await buscarContexto({
      supabase,
      consultantId: consultantId || null,
      etapa: etapaParaRag(entendimento),
      query,
    });
    return { ragText: formatChunks(chunks), persona };
  } catch (e) {
    console.warn(
      "[cerebro/index] RAG falhou (fail-open, segue sem contexto):",
      (e as { message?: string })?.message,
    );
    return { ragText: "", persona };
  }
}

/**
 * Lê a persona da memória em camadas, se existir. É só uma PISTA para o
 * Escritor: ausente → `null` (persona padrão). Não há regra de negócio aqui.
 */
function lerPersona(memoria: MemoriaEmCamadas): string | null {
  const candidatos = [
    memoria.operacional?.["persona"],
    memoria.perfil?.["persona"],
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/**
 * Escolhe uma `Etapa` (vocabulário da Vendedora_Atual) só para parametrizar a
 * busca de exemplos vencedores do RAG. NÃO é fonte de etapa do fluxo
 * (Requisito 6.4) — é apenas um filtro de recuperação, derivado da intenção.
 */
function etapaParaRag(entendimento: ResultadoEntendimento): Etapa {
  if (entendimento.objecao || entendimento.intencao === "levantar_objecao") {
    return "consideracao";
  }
  if (entendimento.intencao === "pedir_simulacao") return "simulacao";
  return "interesse";
}

/** Texto cru do inbound (texto ou rótulo de botão/número). Vazio para mídia/etc. */
function textoDoInbound(inbound: InboundEvent): string {
  if (inbound.kind === "text") return inbound.text;
  if (inbound.kind === "button_click") return inbound.rawText ?? "";
  if (inbound.kind === "number_reply") return inbound.raw;
  return "";
}

/**
 * Envolve uma promessa num teto de tempo. Se `p` resolver antes do teto, devolve
 * seu valor; se rejeitar OU estourar o teto, devolve o valor seguro de
 * `aoFalhar()` (fail-open). Nunca rejeita.
 */
function comTeto<T>(
  p: Promise<T>,
  ms: number,
  aoFalhar: () => T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let resolvido = false;
    const finalizar = (valor: T) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timer);
      resolve(valor);
    };
    const timer = setTimeout(() => {
      console.warn("[cerebro/index] turno estourou o teto de 25s → handoff");
      finalizar(aoFalhar());
    }, ms);
    p.then(finalizar).catch((e) => {
      console.warn(
        "[cerebro/index] erro no turno (fail-open → handoff):",
        (e as { message?: string })?.message,
      );
      finalizar(aoFalhar());
    });
  });
}
