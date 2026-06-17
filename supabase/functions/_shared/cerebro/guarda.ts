/**
 * N5 — Guarda de Segurança (pt-BR). Ponto ÚNICO de verificação.
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — peça N5.
 *
 * Valida TODA mensagem antes do envio, num único ponto (Requisito 9.7):
 * não inventar informação, não vazar chave/token/erro técnico, não pedir dado
 * antes do passo previsto e aplicar o glossário único (termo técnico →
 * comercial). REUSA `vendedora/critico.ts` e as travas determinísticas
 * existentes. Pode bloquear o envio ou ajustar o texto.
 *
 * Estado da implementação:
 *   - Tarefa 6.1 (FEITA — esta): CONSOLIDAÇÃO. Esta função passa a ser o PONTO
 *     ÚNICO antes do envio (Requisito 9.7), reunindo num só lugar:
 *       1. a normalização determinística de texto (consolida a limpeza que a
 *          Vendedora_Atual fazia espalhada no orquestrador),
 *       2. a TRAVA estrutural determinística existente (`validarResposta` de
 *          `vendedora/templates.ts`),
 *       3. o CRÍTICO de qualidade por IA existente (`criticar` de
 *          `vendedora/critico.ts`) — reúso obrigatório, não reimplementado.
 *     Ficam preparados os PONTOS DE ENCAIXE das próximas tarefas (ver abaixo).
 *   - Tarefa 6.2 (FEITA): bloqueios detalhados determinísticos —
 *     inventar info (9.1, BLOQUEIA), vazar chave/token/erro técnico (9.2,
 *     REMOVE/sanitiza e segue), pedir dado antes do passo previsto (9.3,
 *     BLOQUEIA e reancora), alterar dado sem regra no fluxo (9.5, BLOQUEIA) e
 *     mensagem fora das regras do fluxo (9.6, IMPEDE). Implementado em
 *     `aplicarBloqueiosDetalhados`, sem IA.
 *   - Tarefa 6.3 (FEITA): glossário único (termo técnico → comercial) na
 *     saída (Requisito 9.4, 13, 19). Aplicado em `aplicarGlossario`, que reusa
 *     a FONTE ÚNICA do glossário em `cerebro/glossario.ts`.
 *   - Tarefa 6.4 (FEITA): teste de que nenhuma mensagem sai sem passar aqui
 *     (Property 5 — "Guarda sempre roda", Requisitos 9.1, 9.7). Em
 *     `__tests__/guarda-property5.test.ts`: `validarMensagem` é função total
 *     (sempre aprova com texto ou bloqueia, nunca lança), texto vazio nunca é
 *     aprovado e toda saída passou por este ponto único. Inclui teste-guardião
 *     do contrato que a N1 (Tarefa 7) deve respeitar.
 *
 * REÚSO (Requisito 1.3, 1.4, 9.7):
 *   - `criticar` (`vendedora/critico.ts`): MESMO crítico de qualidade por IA da
 *     Vendedora_Atual. Não recriamos a crítica — só a chamamos a partir deste
 *     ponto único. Por custo (Requisito 16.5), o crítico de IA só roda nas
 *     etapas "ricas" (simulação/consideração/finalização), igual à
 *     Vendedora_Atual; a trava determinística roda SEMPRE.
 *   - `validarResposta` / `TRAVA_POR_ETAPA` (`vendedora/templates.ts`): travas
 *     estruturais determinísticas já existentes (tamanho, nº de linhas,
 *     promessas proibidas, tema por etapa). Reaproveitadas sem reescrever.
 */

import type { BotFlowStep, EntradaGuarda, ResultadoGuarda } from "./tipos.ts";
import type { CustomerSnapshot } from "../engine/types.ts";

// FONTE ÚNICA do glossário (Requisito 19.1): termo técnico → Termo_Comercial.
import { traduzirComGlossario } from "./glossario.ts";

// REÚSO (Requisito 9.7): crítico de qualidade por IA da Vendedora_Atual.
import { criticar } from "./comum/critico.ts";
// REÚSO (Requisito 9.7): travas estruturais determinísticas já existentes.
import { TRAVA_POR_ETAPA, validarResposta } from "./comum/templates.ts";
import type { Etapa, PerfilOutput, PlannerOutput } from "./comum/types.ts";

// Etapas "ricas" onde a Vendedora_Atual roda o crítico de IA. Mantido idêntico
// para preservar o comportamento e o controle de custo (Requisito 16.5): a
// trava determinística roda sempre; o crítico de IA só nestas etapas.
const ETAPAS_RICAS = new Set<Etapa>(["simulacao", "consideracao", "finalizando"]);

// Limite duro de tamanho da mensagem ao cliente. Reduzido de 600 → 450 para
// direcionar a IA a respostas mais OBJETIVAS e curtas (sem proibir — é só um
// teto de segurança; o tom/objetividade vêm do prompt do Escritor).
const LIMITE_CARACTERES = 450;
// Limite duro de linhas não-vazias. Reduzido de 4 → 3 pela mesma razão.
const LIMITE_LINHAS = 3;

/**
 * Perfil neutro usado quando o Guarda não recebe um `PerfilOutput` rico.
 *
 * O contrato `EntradaGuarda` (fixado na Tarefa 1) carrega só
 * `{ textoProposto, passoAtual, estado }`. O crítico de IA (`criticar`) pede um
 * `PerfilOutput`; aqui passamos um perfil neutro para que a checagem de tom não
 * derrube mensagens por falta de dado. O enriquecimento desse perfil (vindo do
 * Entendimento/N2 via Orquestrador/N1) pode ser ligado numa fase posterior sem
 * mudar este ponto único.
 */
const PERFIL_NEUTRO: PerfilOutput = {
  perfil: "interessado",
  sentimento: "neutro",
  urgencia: "media",
  temperatura: 50,
  sinais_compra: [],
  sinais_perda: [],
};

/**
 * Traduz o passo do fluxo (`BotFlowStep`, dado do Construtor_Visual via Engine
 * v3) para a `Etapa` da Vendedora_Atual, que é o vocabulário das travas
 * determinísticas existentes (`validarResposta`, `TRAVA_POR_ETAPA`).
 *
 * É uma PONTE de melhor-esforço: a fonte única da etapa continua sendo o fluxo
 * (Requisito 6.4) — aqui não decidimos passo nenhum, só escolhemos QUAL trava
 * de tema aplicar à mensagem já escrita. Quando não dá pra mapear com
 * segurança, devolvemos `null` e o Guarda aplica só as travas genéricas
 * (tamanho, linhas, promessas), deixando o resto para o crítico de IA e para os
 * bloqueios detalhados da Tarefa 6.2.
 */
function mapearEtapa(passo: BotFlowStep | null): Etapa | null {
  if (!passo) return null;

  // 1) Pipeline de cadastro é o sinal mais forte e confiável.
  switch (passo.pipelineKind) {
    case "ocr_conta":
      return "foto_conta";
    case "ocr_documento":
      return "doc";
    case "finalizar_cadastro":
    case "cadastro_portal":
      return "finalizando";
  }

  // 2) Heurística por `stepKey` (rótulo do passo no Construtor_Visual).
  const chave = (passo.stepKey || "").toLowerCase();
  if (!chave) return null;
  if (/(interesse|abertura|boas[_\s-]?vindas|saudacao|sauda[çc][ãa]o)/.test(chave)) return "interesse";
  if (/nome/.test(chave)) return "nome";
  if (/(simula|desconto|economia)/.test(chave)) return "simulacao";
  if (/(valor|conta.*valor|fatura.*valor)/.test(chave)) return "valor";
  if (/(foto.*conta|conta.*foto|foto_conta)/.test(chave)) return "foto_conta";
  if (/(\bdoc\b|documento|rg|cnh)/.test(chave)) return "doc";
  if (/(email|e[_\s-]?mail)/.test(chave)) return "email";
  if (/(considera|objec|d[úu]vida)/.test(chave)) return "consideracao";
  if (/(finaliz|conclu|cadastro)/.test(chave)) return "finalizando";

  return null;
}

/**
 * Indica, de forma conservadora, se já houve conversa antes deste turno. O
 * crítico usa isso para não repetir saudação. Sem o histórico no contrato do
 * Guarda, derivamos do estado: cliente que não é "new" ou que já teve mensagem
 * recebida já está em conversa.
 */
function jaTemHistorico(estado: CustomerSnapshot): boolean {
  return estado.status !== "new" || estado.lastInboundAt !== null;
}

/**
 * Normalização determinística de texto — CONSOLIDA a limpeza que a
 * Vendedora_Atual fazia dentro do orquestrador (negrito `**` → `*`, remoção de
 * marcadores de lista, colapso de linhas em branco, corte no limite de
 * tamanho/linhas). É o primeiro passo do ponto único: garante um texto enxuto
 * e padronizado antes de qualquer checagem.
 */
function normalizarTexto(bruto: string): string {
  let s = String(bruto || "").trim();
  if (!s) return s;

  // Negrito do estilo Markdown (**x**) vira negrito do WhatsApp (*x*).
  s = s.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // Remove marcadores de lista no início da linha.
  s = s.replace(/^[ \t]*[-*][ \t]+/gm, "");
  // Colapsa 3+ quebras de linha em no máximo uma linha em branco.
  s = s.replace(/\n{3,}/g, "\n\n");

  // Mantém no máximo `LIMITE_LINHAS` linhas não-vazias.
  const linhas = s.split("\n");
  const mantidas: string[] = [];
  let naoVazias = 0;
  for (const linha of linhas) {
    if (linha.trim()) {
      if (naoVazias >= LIMITE_LINHAS) continue;
      naoVazias++;
    }
    mantidas.push(linha);
  }
  s = mantidas.join("\n").trim();

  // Corte de tamanho: NUNCA corta no meio de uma frase. Se o texto passar do
  // limite, recuamos até o fim da última frase completa (. ? ! …) que couber.
  // Se nenhuma frase inteira couber dentro do limite, mantemos a PRIMEIRA frase
  // completa inteira (mesmo que ela passe um pouco do limite) — é melhor enviar
  // uma frase ligeiramente maior do que entregar texto cortado pela metade.
  // Sem nenhuma pontuação de fim de frase, preserva o texto como está.
  if (s.length > LIMITE_CARACTERES) {
    s = cortarEmFraseCompleta(s, LIMITE_CARACTERES);
  }

  return s.trim();
}

/**
 * Corta `texto` respeitando fronteiras de frase: o resultado SEMPRE termina numa
 * frase completa (pontuação final `.`/`?`/`!`/`…`) ou no próprio texto inteiro.
 * Nunca devolve uma frase pela metade.
 *
 * Estratégia:
 *   1. Procura a última pontuação de fim de frase ANTES do limite → corta ali.
 *   2. Se não houver nenhuma antes do limite, pega a PRIMEIRA frase completa do
 *      texto (mesmo que ultrapasse o limite) — frase inteira é melhor que cortada.
 *   3. Sem nenhuma pontuação de fim de frase, devolve o texto original intacto.
 */
function cortarEmFraseCompleta(texto: string, limite: number): string {
  const s = String(texto || "");
  if (s.length <= limite) return s;

  // Regex de fim de frase: pontuação seguida de espaço/quebra ou fim do texto.
  // Inclui reticências unicode (…) e a sequência "...".
  const RE_FIM_FRASE = /([.!?…]|\.\.\.)(?=\s|$)/g;
  const cortes: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE_FIM_FRASE.exec(s)) !== null) {
    // índice do último caractere da pontuação (inclusivo).
    cortes.push(m.index + m[0].length);
  }
  if (cortes.length === 0) {
    // Sem pontuação de fim de frase: não há como cortar sem partir a frase.
    return s;
  }

  // 1) Última fronteira de frase que cabe dentro do limite.
  let melhor = -1;
  for (const c of cortes) {
    if (c <= limite) melhor = c;
    else break;
  }
  if (melhor > 0) return s.slice(0, melhor).trim();

  // 2) Nenhuma frase cabe no limite "macio" → mantém a primeira frase inteira,
  //    desde que ela não estoure o TETO ESTRUTURAL da Vendedora_Atual (600),
  //    que rejeitaria a mensagem como "longa" e a impediria de sair. Frase
  //    completa é melhor que cortada, mas nunca a ponto de bloquear o envio.
  const TETO_ESTRUTURAL = 600;
  if (cortes[0] <= TETO_ESTRUTURAL) return s.slice(0, cortes[0]).trim();

  // 3) Caso extremo: primeira "frase" maior que o teto estrutural (texto sem
  //    pontuação natural). Corta no último espaço antes do limite para ao menos
  //    não partir uma PALAVRA no meio; se não houver espaço, corta no limite.
  const ate = s.slice(0, limite);
  const ultimoEspaco = ate.lastIndexOf(" ");
  return (ultimoEspaco > 0 ? ate.slice(0, ultimoEspaco) : ate).trim();
}

// ─── Tarefa 6.2 — Bloqueios detalhados (Requisito 9.1, 9.2, 9.3, 9.5, 9.6) ───
//
// São REGRAS determinísticas em TS (sem IA), enxutas e conservadoras. A IGEIA
// só PRECISA chegar aqui se passou pelas travas estruturais; este bloco é a
// rede fina de segurança. Cada detector cobre um requisito:
//
//   - 9.2 (vazar chave/token/erro técnico): a regra é REMOVER (sanitizar) o
//     conteúdo técnico e SEGUIR — não bloqueia, limpa.
//   - 9.1 (inventar info não confirmada): BLOQUEIA e aciona resposta segura.
//   - 9.3 (pedir dado antes do passo previsto): BLOQUEIA e reancora no passo.
//   - 9.5 (alterar dado do cliente sem regra no fluxo): BLOQUEIA a alteração.
//   - 9.6 (mensagem fora das regras do fluxo): IMPEDE o envio.
//
// Não duplicamos o glossário (termo técnico → comercial), que é da Tarefa 6.3.

/** Resultado de um passo de bloqueio: pode aprovar, ajustar texto ou barrar. */
interface ResultadoBloqueio {
  aprovado: boolean;
  texto: string;
  motivoBloqueio?: string;
}

// ── 9.2 — Remoção (sanitização) de vazamento técnico ─────────────────────────
//
// Padrões determinísticos de conteúdo que NUNCA pode chegar ao cliente: chaves
// de integração, tokens, JWT, URLs internas, stack traces e caminhos de
// arquivo com linha. A regra do Requisito 9.2 é REMOVER esse conteúdo (e não
// bloquear a mensagem inteira), então cada padrão é trocado por vazio.
const PADROES_VAZAMENTO_TECNICO: RegExp[] = [
  // Chave estilo OpenAI (sk-..., sk-proj-...).
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g,
  // Cabeçalho Authorization: Bearer <token>.
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  // JWT (três blocos base64url separados por ponto).
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
  // Par chave=valor / chave: valor (api key, secret, token, chave de integração).
  /\b(?:api[_-]?key|apikey|secret|access[_-]?token|token|chave(?:\s+de\s+integra[çc][ãa]o)?)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{6,}["']?/gi,
  // URLs internas/de infraestrutura (Supabase, localhost, endpoints de função).
  /\bhttps?:\/\/[^\s]*(?:supabase\.(?:co|in)|localhost|127\.0\.0\.1|\.internal|\/functions\/v\d)[^\s]*/gi,
  // Linha de stack trace: "at algo (arquivo.ts:12:3)".
  /\bat\s+[^\s]+\s*\(?[^\s()]+\.(?:ts|js|tsx|jsx):\d+:\d+\)?/gi,
  // Nome de erro técnico seguido de mensagem ("TypeError: ...", "Error: ...").
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|Error)\s*:\s*[^\n]+/g,
  // Caminho de arquivo de código com número de linha (ex.: guarda.ts:42:7).
  /\b[\w./-]+\.(?:ts|js|tsx|jsx):\d+(?::\d+)?\b/g,
];

/**
 * Remove (sanitiza) qualquer conteúdo técnico sensível do texto (Requisito
 * 9.2). Devolve o texto limpo e um sinalizador indicando se algo foi removido.
 * Colapsa os espaços/quebras que sobrarem para não deixar buracos visíveis.
 */
export function sanitizarVazamentoTecnico(
  texto: string,
): { texto: string; removeu: boolean } {
  let s = String(texto || "");
  const original = s;
  for (const padrao of PADROES_VAZAMENTO_TECNICO) {
    s = s.replace(padrao, "");
  }
  if (s === original) return { texto: original, removeu: false };

  // Limpa resíduos da remoção: espaços duplos, espaço antes de pontuação,
  // pontuação/parênteses órfãos e linhas que ficaram vazias.
  s = s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { texto: s, removeu: true };
}

// ── Auxiliares de leitura do passo do fluxo ──────────────────────────────────

/** Junta `stepKey` + nomes dos campos capturados para casar com uma regex. */
function rotuloDoPasso(passo: BotFlowStep | null): string {
  if (!passo) return "";
  const campos = (passo.captures || []).map((c) => c?.field || "").join(" ");
  return `${passo.stepKey || ""} ${campos}`.toLowerCase();
}

/** O passo atual coleta foto/conta/documento? (autoriza pedir mídia.) */
function passoColetaMidia(passo: BotFlowStep | null): boolean {
  if (!passo) return false;
  if (passo.pipelineKind === "ocr_conta" || passo.pipelineKind === "ocr_documento") {
    return true;
  }
  return /(foto|conta|fatura|documento|\bdoc\b|\brg\b|\bcnh\b|identidade|midia|m[íi]dia)/
    .test(rotuloDoPasso(passo));
}

/** O passo atual coleta e-mail? (autoriza pedir e-mail.) */
function passoColetaEmail(passo: BotFlowStep | null): boolean {
  if (!passo) return false;
  const temValidadorEmail = (passo.captures || []).some((c) => c?.validator === "email");
  return temValidadorEmail || /(e-?mail)/.test(rotuloDoPasso(passo));
}

/** O passo atual finaliza o cadastro? (autoriza falar em "concluído/ativado".) */
function passoEhFinalizacao(passo: BotFlowStep | null): boolean {
  if (!passo) return false;
  if (passo.pipelineKind === "finalizar_cadastro" || passo.pipelineKind === "cadastro_portal") {
    return true;
  }
  return /(finaliz|conclu|ativa|cadastro)/.test(rotuloDoPasso(passo));
}

/** O passo atual tem regra para capturar/alterar o campo indicado pela regex. */
function passoCapturaCampo(passo: BotFlowStep | null, regexCampo: RegExp): boolean {
  if (!passo) return false;
  for (const c of passo.captures || []) {
    if (c?.field && regexCampo.test(c.field.toLowerCase())) return true;
  }
  return regexCampo.test((passo.stepKey || "").toLowerCase());
}

/** Remove asteriscos de negrito do WhatsApp e espaços das pontas. */
function limpo(s: string): string {
  return s.replace(/[*_]/g, "").trim();
}

// ── 9.1 — Inventar informação não confirmada ─────────────────────────────────
//
// Bloqueia quando o texto AFIRMA um dado do cliente que não está confirmado no
// estado (nome ou valor da conta). É conservador: só dispara em afirmações
// diretas ("seu nome é X", "sua conta é R$ N"), evitando falso positivo em
// perguntas ("qual seu nome?").

/** Detecta afirmação de dado não confirmado (Req 9.1). Devolve motivo ou null. */
export function detectaInfoInventada(
  texto: string,
  estado: CustomerSnapshot,
): string | null {
  const t = String(texto || "");

  // Afirma o nome do cliente?
  const mNome = t.match(/\b(?:seu nome (?:é|e|eh)|voc[eê] se chama)\s+\*?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{1,})\*?/i);
  if (mNome) {
    const nomeDito = limpo(mNome[1]).toLowerCase();
    const nomeConfirmado = (estado.customer?.name || "").toLowerCase();
    if (!nomeConfirmado) return "info_inventada:nome_nao_confirmado";
    // O nome dito precisa fazer parte do nome confirmado (ou vice-versa).
    const casa = nomeConfirmado.includes(nomeDito) || nomeDito.includes(nomeConfirmado.split(/\s+/)[0]);
    if (!casa) return "info_inventada:nome_divergente";
  }

  // Afirma um valor concreto da conta/economia sem valor confirmado?
  const afirmaValor = /\b(sua conta(?:\s+de\s+luz)?|sua fatura|sua economia|voc[eê] paga)\b[^.\n]{0,40}R\$\s?\d/i
    .test(t);
  if (afirmaValor && estado.customer?.electricityBillValue == null) {
    return "info_inventada:valor_nao_confirmado";
  }

  return null;
}

// ── 9.3 — Pedir um dado antes do passo previsto ──────────────────────────────
//
// Reaproveita a heurística da TRAVA anti-pedido-precoce da Vendedora_Atual
// (`orchestrator.ts`): se a mensagem pede mídia (foto/conta/documento) ou
// e-mail e o passo atual do fluxo NÃO é o de coleta desse dado, bloqueia e
// reancora (Req 9.3).

/** Detecta pedido de dado fora do passo previsto (Req 9.3). Motivo ou null. */
export function detectaPedidoDeDadoCedo(
  texto: string,
  passo: BotFlowStep | null,
): string | null {
  const t = String(texto || "");

  const pedeMidia = /\b(foto|fotografia|print|imagem)\b/i.test(t) ||
    /\b(conta de luz|fatura)\b[^.\n]{0,40}(envi|mand|manda|me\s+pass)/i.test(t) ||
    /\b(rg|cnh|documento|identidade)\b/i.test(t) ||
    /📷|📄/.test(t);
  if (pedeMidia && !passoColetaMidia(passo)) {
    return "pediu_dado_cedo:midia";
  }

  const pedeEmail = /\be-?mail\b/i.test(t) || /📧/.test(t);
  if (pedeEmail && !passoColetaEmail(passo)) {
    return "pediu_dado_cedo:email";
  }

  return null;
}

// ── 9.5 — Alterar um dado do cliente sem regra no fluxo ───────────────────────
//
// Bloqueia quando o texto anuncia ALTERAR um dado do cliente (nome, e-mail,
// valor) e o passo atual NÃO tem regra que autorize capturar/alterar esse
// campo (Req 9.5). Diferente do 9.1 (afirmar dado não confirmado): aqui o bot
// tenta MUDAR um dado sem que o fluxo preveja.

/** Detecta alteração de dado sem regra no fluxo (Req 9.5). Motivo ou null. */
export function detectaAlteracaoSemRegra(
  texto: string,
  passo: BotFlowStep | null,
): string | null {
  const t = String(texto || "");

  const verboAltera = /\b(alterei|alterar|alterando|mudei|mudar|mudando|troquei|trocar|atualizei|atualizar|corrigi|corrigir)\b/i;
  // Sem `\b` após o valor: em JS o `\b` é ASCII e falha logo após "é"/"á".
  const agoraE = /\bseu (?:nome|e-?mail|email|valor|conta) agora (?:é|passou a ser|ficou|virou)/i;

  const anunciaAlteracao = (verboAltera.test(t) && /\b(seu nome|seu e-?mail|seu email|sua conta|seu valor|seus dados|seu cadastro)\b/i.test(t)) ||
    agoraE.test(t);
  if (!anunciaAlteracao) return null;

  // Qual campo está sendo alterado? Verifica se o passo autoriza.
  if (/\bnome\b/i.test(t) && !passoCapturaCampo(passo, /nome/)) {
    return "alteracao_sem_regra:nome";
  }
  if (/\be-?mail\b/i.test(t) && !passoCapturaCampo(passo, /email|e-?mail/)) {
    return "alteracao_sem_regra:email";
  }
  if (/\b(valor|conta|fatura)\b/i.test(t) && !passoCapturaCampo(passo, /valor|conta|fatura/)) {
    return "alteracao_sem_regra:valor";
  }
  // Anunciou alteração genérica ("seus dados/seu cadastro") sem passo de captura.
  if ((passo?.captures?.length ?? 0) === 0) {
    return "alteracao_sem_regra:generica";
  }
  return null;
}

// ── 9.6 — Mensagem fora das regras do fluxo ──────────────────────────────────
//
// Rede final (umbrella): impede o envio de mensagem que afirma um desfecho do
// fluxo que o passo atual não autoriza — ex.: dizer que o cadastro está
// concluído/ativado quando o passo atual não é o de finalização (Req 9.6).

/** Detecta afirmação de desfecho fora do passo previsto (Req 9.6). Motivo ou null. */
export function detectaForaDoFluxo(
  texto: string,
  passo: BotFlowStep | null,
): string | null {
  const t = String(texto || "");

  // Permite palavras intermediárias ("já está", "agora") entre o sujeito e o
  // particípio de conclusão.
  const meio = "(?:\\s+\\S+){0,3}\\s+";
  const afirmaConclusao = new RegExp(
    "\\b(?:" +
      "cadastro" + meio + "(?:finalizado|conclu[íi]do|feito|realizado)" +
      "|conta" + meio + "(?:ativada|ativa)" +
      "|migra[çc][ãa]o" + meio + "(?:conclu[íi]da|feita|realizada)" +
      "|j[áa] est[áa] tudo (?:certo|pronto|ativo)" +
      ")\\b",
    "i",
  ).test(t);
  if (afirmaConclusao && !passoEhFinalizacao(passo)) {
    return "fora_do_fluxo:conclusao_indevida";
  }

  return null;
}

/**
 * Tarefa 6.2 — bloqueios detalhados, num único passo determinístico.
 *
 * Ordem: primeiro SANITIZA vazamento técnico (Req 9.2, que apenas remove e
 * segue); depois aplica os BLOQUEIOS na ordem 9.1 → 9.3 → 9.5 → 9.6. O
 * primeiro bloqueio encontrado encerra a verificação e devolve `aprovado:
 * false` com o motivo (o ponto único aciona a resposta segura/reancoragem).
 *
 * @returns Texto possivelmente sanitizado; quando bloqueia, traz `motivoBloqueio`.
 */
export function aplicarBloqueiosDetalhados(
  texto: string,
  passo: BotFlowStep | null,
  estado: CustomerSnapshot,
): ResultadoBloqueio {
  // 9.2 — Remove conteúdo técnico ANTES de qualquer envio (não bloqueia).
  const { texto: textoLimpo } = sanitizarVazamentoTecnico(texto);
  if (!textoLimpo.trim()) {
    // Sobrou nada útil após remover o conteúdo técnico → resposta segura.
    return { aprovado: false, texto: "", motivoBloqueio: "vazio_apos_sanitizar" };
  }

  // 9.1 — Inventar informação não confirmada → bloqueia (resposta segura).
  const inventada = detectaInfoInventada(textoLimpo, estado);
  if (inventada) return { aprovado: false, texto: textoLimpo, motivoBloqueio: inventada };

  // 9.3 — Pedir dado antes do passo previsto → bloqueia (reancora).
  const cedo = detectaPedidoDeDadoCedo(textoLimpo, passo);
  if (cedo) return { aprovado: false, texto: textoLimpo, motivoBloqueio: cedo };

  // 9.5 — Alterar dado do cliente sem regra no fluxo → bloqueia.
  const alteracao = detectaAlteracaoSemRegra(textoLimpo, passo);
  if (alteracao) return { aprovado: false, texto: textoLimpo, motivoBloqueio: alteracao };

  // 9.6 — Mensagem fora das regras do fluxo → impede o envio.
  const foraDoFluxo = detectaForaDoFluxo(textoLimpo, passo);
  if (foraDoFluxo) return { aprovado: false, texto: textoLimpo, motivoBloqueio: foraDoFluxo };

  return { aprovado: true, texto: textoLimpo };
}

/**
 * Glossário único (Tarefa 6.3) — troca termo técnico pelo Termo_Comercial
 * correspondente na SAÍDA ao cliente (Requisitos 9.4, 13.1, 13.2, 19.1, 19.2,
 * 19.3), antes do envio.
 *
 * O mapa vive em `cerebro/glossario.ts` como FONTE ÚNICA (Requisito 19.1): o
 * Guarda só aplica o filtro de texto aqui. A substituição é case-insensitive,
 * respeita fronteira de palavra (não quebra palavra dentro de outra) e preserva
 * o restante do texto.
 */
function aplicarGlossario(texto: string): string {
  return traduzirComGlossario(texto);
}

/**
 * Valida e, se preciso, ajusta o texto proposto antes do envio ao cliente.
 *
 * PONTO ÚNICO (Requisito 9.7): toda mensagem do Cérebro passa por aqui. A
 * ordem é determinística primeiro (barato e seguro), IA depois (só nas etapas
 * ricas), e por fim o glossário sobre o texto aprovado:
 *
 *   1. Normaliza o texto (consolida a limpeza da Vendedora_Atual).
 *   2. Trava genérica: mensagem vazia → bloqueia.
 *   3. Trava estrutural determinística por etapa (`validarResposta`).
 *   4. Bloqueios detalhados (encaixe da Tarefa 6.2).
 *   5. Crítico de qualidade por IA (`criticar`) — só nas etapas ricas.
 *   6. Glossário único (encaixe da Tarefa 6.3) sobre o texto aprovado.
 *
 * @param entrada Texto proposto, passo atual e estado do cliente.
 * @returns Aprovação, texto final ajustado e motivo do bloqueio (se houver).
 */
export async function validarMensagem(
  entrada: EntradaGuarda,
): Promise<ResultadoGuarda> {
  const { passoAtual, estado } = entrada;
  const etapa = mapearEtapa(passoAtual);
  const nomeLead = estado.customer?.name ?? null;

  // 1) Normalização determinística (consolida a limpeza da Vendedora_Atual).
  const texto = normalizarTexto(entrada.textoProposto);

  // 2) Trava genérica: nada vazio sai.
  if (!texto) {
    return { aprovado: false, textoFinal: "", motivoBloqueio: "texto_vazio" };
  }

  // 3) Trava estrutural determinística existente. Quando a etapa do fluxo é
  //    mapeável, usamos a checagem por tema/etapa; senão, a etapa neutra
  //    ("interesse") cobre só as regras genéricas (tamanho, linhas, promessas).
  const etapaParaTrava: Etapa = etapa ?? "interesse";
  const estrutural = validarResposta(texto, etapaParaTrava, nomeLead);
  if (!estrutural.ok) {
    return {
      aprovado: false,
      textoFinal: texto,
      motivoBloqueio: `trava_estrutural:${estrutural.motivo ?? "desconhecido"}`,
    };
  }

  // 4) Bloqueios detalhados (encaixe da Tarefa 6.2).
  const bloqueio = aplicarBloqueiosDetalhados(texto, passoAtual, estado);
  if (!bloqueio.aprovado) {
    return {
      aprovado: false,
      textoFinal: bloqueio.texto,
      motivoBloqueio: bloqueio.motivoBloqueio ?? "bloqueio_detalhado",
    };
  }
  let textoFinal = bloqueio.texto;

  // 5) Crítico de qualidade por IA (reúso). Só nas etapas ricas, para preservar
  //    o controle de custo de IA (Requisito 16.5).
  if (etapa && ETAPAS_RICAS.has(etapa)) {
    const plano: PlannerOutput = {
      etapa_atual: etapa,
      proxima_jogada: TRAVA_POR_ETAPA[etapa],
      tom: "consultivo_seguro",
      info_a_capturar: [],
      objecao_a_tratar: null,
      deve_pedir_humano: false,
      deve_agendar_followup: false,
      razao_da_jogada: "guarda_n5",
    };
    const critica = await criticar({
      texto: textoFinal,
      perfil: PERFIL_NEUTRO,
      jaTemHistorico: jaTemHistorico(estado),
      plano,
      nomeLead,
    });
    if (!critica.aprovado) {
      return {
        aprovado: false,
        textoFinal,
        motivoBloqueio: `critico:${critica.problemas.join("|").slice(0, 200) || "reprovado"}`,
      };
    }
  }

  // 6) Glossário único (encaixe da Tarefa 6.3) sobre o texto já aprovado.
  textoFinal = aplicarGlossario(textoFinal);

  return { aprovado: true, textoFinal };
}
