/**
 * N4 — Escritor (pt-BR).
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — peça N4.
 *
 * Escreve APENAS a mensagem final do passo recebido — não decide qual é o
 * próximo passo (Requisito 8.1, 8.2). REUSA o RAG, a memória e o gateway de IA
 * (`chatCascade`) já existentes. Saída sempre em português comercial
 * (Requisito 8.4).
 *
 * Estado da implementação:
 *   - Tarefa 5.1 (FEITA): compor a mensagem do passo reusando RAG, memória e o
 *     gateway `chatCascade` (Requisito 8.1, 8.2, 8.3). O Escritor recebe o
 *     `passoAtual` já decidido pelo Decisor (N3) e NUNCA escolhe outro passo.
 *   - Tarefa 5.2 (FEITA): tabela de tom por etapa de venda (ideia SalesGPT —
 *     ver design.md "Aproveitamento dos clones": o `stages.py` vira DADO/persona,
 *     nunca código importado). A `instrucaoDeTom()` agora escolhe o tom conforme
 *     a etapa de venda do passo atual, derivada do `passoAtual` (stepType/stepKey/
 *     pipelineKind) e do `sales_phase` que chega na memória — sem criar uma
 *     segunda fonte de etapa de fluxo (isto é só TOM, não decisão de passo).
 *   - Tarefa 5.3 (FEITA): saída SEMPRE em português do Brasil comercial
 *     (Requisito 8.4, 13.1). O prompt de sistema agora tem um bloco
 *     "Idioma e registro (OBRIGATÓRIO)" que força pt-BR comercial mesmo que o
 *     cliente escreva em outro idioma, misture idiomas ou use gírias. Aqui
 *     garantimos só o IDIOMA/REGISTRO; o filtro ESTRITO de glossário (termo
 *     técnico → Termo_Comercial) é responsabilidade da Guarda (N5, tarefa 6.3).
 *   - Tarefa 5.4 (pendente): testes de que o Escritor não decide passo.
 *
 * REÚSO (Requisito 1.3, 1.4, 8.3):
 *   - `chatCascade` (`vendedora/gateway.ts`): mesmo gateway/cascata de modelos
 *     da Vendedora_Atual. Não criamos cliente de IA novo.
 *   - RAG (`vendedora/rag.ts`): a RECUPERAÇÃO do conteúdo é feita a montante
 *     (N1/N8) e chega pronta em `entrada.ragText`, conforme o contrato de
 *     `EntradaEscritor`. O Escritor consome esse texto — não refaz a busca,
 *     evitando consulta duplicada e respeitando o controle de custo de IA
 *     (Requisito 16.5).
 *   - memória (`vendedora/memory.ts`): a LEITURA é feita pela peça N8 (estado),
 *     que entrega a memória já organizada em camadas (`MemoriaEmCamadas`). O
 *     Escritor só formata as camadas relevantes para o prompt, sem despejar
 *     tudo de uma vez (Requisito 20.4).
 */

import type {
  EntradaEscritor,
  MemoriaEmCamadas,
  ResultadoEscritor,
} from "./tipos.ts";

// REÚSO (Requisito 8.3): gateway de IA com cascata de modelos da Vendedora_Atual.
import { chatCascade, type ChatMsg } from "../vendedora/gateway.ts";

// Modelos baratos primeiro, com fallback — mesma família usada pela escrita da
// Vendedora_Atual (`vendedora/orchestrator.ts`). Manter a lista enxuta faz
// parte do controle de custo de IA (Requisito 16.5).
const MODELOS_ESCRITA = ["google/gemini-3-flash-preview", "openai/gpt-5-mini"];

// Temperatura moderada: texto comercial natural, sem alucinar. A não-invenção
// é garantida de forma dura pela Guarda (N5), não aqui.
const TEMPERATURA_ESCRITA = 0.6;

// Limites de tamanho do contexto injetado no prompt. Evitam estourar tokens
// (custo) e mantêm a mensagem focada (Requisito 16.5, 20.4).
const LIMITE_RAG = 1200;
const LIMITE_SESSAO = 600;

/**
 * Etapas de venda usadas SÓ para escolher o tom da mensagem (ideia: SalesGPT,
 * `stages.py`). NÃO é a etapa do fluxo: a etapa do fluxo (qual passo) é decidida
 * pelo Decisor (N3) via `runEngine`. Aqui é apenas uma leitura de "momento da
 * venda" para o Escritor falar no tom certo — uma única direção, sem virar
 * segunda fonte de decisão de passo.
 */
type EtapaDeVenda =
  | "abertura"
  | "qualificacao"
  | "apresentacao_valor"
  | "tratamento_objecao"
  | "fechamento"
  | "coleta_cadastro";

/**
 * TABELA DE TOM POR ETAPA (DADO, não código). Inspirada no `stages.py` do
 * SalesGPT, mas aqui é só um mapa editável: para ajustar como a consultora soa
 * em cada momento da venda, basta mudar o texto abaixo — nenhuma lógica muda.
 * Cada entrada é uma instrução curta de tom injetada no prompt do Escritor.
 */
const TOM_POR_ETAPA: Record<EtapaDeVenda, string> = {
  abertura: [
    "Tom: acolhedor e leve, de quem está iniciando a conversa.",
    "Desperte curiosidade sobre economizar na conta de luz, sem pressionar.",
  ].join(" "),
  qualificacao: [
    "Tom: curioso e consultivo, de quem quer entender a situação do cliente.",
    "Faça perguntas simples e mostre interesse genuíno, uma coisa de cada vez.",
  ].join(" "),
  apresentacao_valor: [
    "Tom: entusiasmado e claro, destacando o benefício de economizar.",
    "Fale dos ganhos em linguagem do dia a dia, sem prometer o que não pode cumprir.",
  ].join(" "),
  tratamento_objecao: [
    "Tom: paciente e seguro, acolhendo a dúvida sem rebater de forma agressiva.",
    "Reconheça a preocupação, esclareça com simplicidade e devolva a confiança.",
  ].join(" "),
  fechamento: [
    "Tom: objetivo e encorajador, conduzindo o cliente ao próximo passo.",
    "Deixe claro o que falta para concluir, com leveza e sem pressa excessiva.",
  ].join(" "),
  coleta_cadastro: [
    "Tom: prestativo e tranquilizador, guiando o envio de dados/documentos.",
    "Explique o porquê de cada pedido e passe segurança sobre o uso das informações.",
  ].join(" "),
};

/**
 * Lê o `sales_phase` (quando existir) das camadas de memória, sem assumir um
 * formato rígido. O `sales_phase` é gravado em `customers` pela vendedora atual
 * e chega ao Cérebro pela memória (perfil/operacional). É só uma PISTA de tom —
 * não a fonte da etapa do fluxo.
 */
function lerSalesPhase(memoria: MemoriaEmCamadas): string | null {
  const candidatos = [
    memoria.operacional?.["sales_phase"],
    memoria.perfil?.["sales_phase"],
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.trim()) return c.trim().toLowerCase();
  }
  return null;
}

/**
 * Deriva a etapa de venda (para TOM) a partir do passo atual e do `sales_phase`.
 *
 * Ordem de prioridade:
 *   1. Objeção em curso (vinda do Entendimento/N2) → sempre `tratamento_objecao`.
 *   2. Natureza do passo atual (pipeline de cadastro / pedir mídia / pergunta).
 *   3. `sales_phase` da memória como pista complementar.
 *   4. Padrão conservador: `abertura`.
 *
 * Importante: NÃO decide passo nem grava etapa em lugar nenhum — só escolhe o
 * tom. A decisão de passo continua exclusivamente no Decisor (N3).
 */
function derivarEtapaDeVenda(entrada: EntradaEscritor): EtapaDeVenda {
  // 1. Objeção tem prioridade: o cliente levantou uma resistência agora.
  if (entrada.entendimento?.objecao) return "tratamento_objecao";

  const passo = entrada.passoAtual;

  // 2. Pistas fortes vindas do próprio passo do fluxo.
  if (passo) {
    // Passos do pipeline de cadastro (OCR, portal, finalização) → coleta.
    if (passo.pipelineKind) return "coleta_cadastro";
    // Pedir foto/documento é sempre coleta de cadastro.
    if (passo.stepType === "ask_media") return "coleta_cadastro";

    // Pistas pela chave do passo (nomes usados no construtor), sem virar
    // sequência fixa: é só casamento de palavra-chave para tom.
    const chave = (passo.stepKey ?? "").toLowerCase();
    if (chave) {
      if (/(conta|documento|cadastro|cpf|email|e-mail|dados|foto|rg)/.test(chave)) {
        return "coleta_cadastro";
      }
      if (/(objec|duvida|dúvida)/.test(chave)) return "tratamento_objecao";
      if (/(fecha|finaliz|confirma)/.test(chave)) return "fechamento";
      if (/(valor|simula|economia|beneficio|benefício|proposta)/.test(chave)) {
        return "apresentacao_valor";
      }
      if (/(qualifica|interesse|perfil)/.test(chave)) return "qualificacao";
      if (/(abertura|saudacao|saudação|boas_vindas|inicio|início)/.test(chave)) {
        return "abertura";
      }
    }

    // Pista pelo tipo do passo: perguntar geralmente é qualificação.
    if (passo.stepType === "ask_text" || passo.stepType === "ask_choice") {
      return "qualificacao";
    }
  }

  // 3. sales_phase da memória como pista complementar.
  const fase = lerSalesPhase(entrada.estado?.memoria ?? ({} as MemoriaEmCamadas));
  switch (fase) {
    case "abertura":
      return "abertura";
    case "qualificacao":
    case "qualificação":
      return "qualificacao";
    case "apresentacao":
    case "apresentação":
    case "valor":
      return "apresentacao_valor";
    case "objecao":
    case "objeção":
      return "tratamento_objecao";
    case "fechamento":
      return "fechamento";
    case "cadastro":
      return "coleta_cadastro";
  }

  // 4. Padrão conservador.
  return "abertura";
}

/**
 * Instrução de tom da mensagem.
 *
 * Tarefa 5.2 (tom por etapa de venda — ideia SalesGPT): escolhe o tom conforme
 * a etapa de venda derivada do passo atual e do `sales_phase` (ver
 * `derivarEtapaDeVenda`). O tom vem da tabela `TOM_POR_ETAPA` (DADO editável).
 * Continua sem decidir passo — apenas ajusta como a mensagem soa.
 */
function instrucaoDeTom(entrada: EntradaEscritor): string {
  const etapa = derivarEtapaDeVenda(entrada);
  return TOM_POR_ETAPA[etapa];
}

/**
 * Descreve, em texto curto, o objetivo do passo atual para o modelo escrever a
 * mensagem CORRESPONDENTE a ele (Requisito 8.2). O Escritor NÃO decide o passo:
 * apenas verbaliza o passo que o Decisor (N3) já escolheu.
 *
 * Quando o passo traz um texto base (`persuasiveText`/`messageText`), ele é
 * oferecido como REFERÊNCIA do que comunicar — o modelo o reescreve no tom e
 * com os dados do cliente, sem inventar um assunto novo.
 */
function descreverPasso(entrada: EntradaEscritor): string {
  const passo = entrada.passoAtual;
  if (!passo) {
    // Sem passo definido (ex.: dúvida fora de hora reancorada pelo Decisor):
    // o Escritor responde de forma útil e breve, sem avançar o cadastro.
    return [
      "Não há um passo específico do fluxo para este turno.",
      "Responda de forma breve e útil ao que o cliente acabou de dizer,",
      "sem pedir dados novos nem avançar etapas.",
    ].join(" ");
  }

  const partes: string[] = [];
  partes.push(`Passo atual do fluxo: "${passo.stepKey ?? passo.stepType}".`);

  const base = (passo.persuasiveText ?? passo.messageText ?? "").trim();
  if (base) {
    partes.push(
      `Referência do que comunicar neste passo (reescreva no tom, não copie literal): "${base}".`,
    );
  }

  // Pista de objetivo conforme o tipo do passo, sem decidir transição.
  switch (passo.stepType) {
    case "ask_text":
      partes.push("Objetivo: fazer UMA pergunta clara para coletar a informação deste passo.");
      break;
    case "ask_choice":
      partes.push("Objetivo: apresentar as opções deste passo e pedir a escolha do cliente.");
      break;
    case "ask_media":
      partes.push("Objetivo: pedir, com gentileza, o envio do documento/foto deste passo.");
      break;
    case "text_message":
    case "media_message":
    case "audio_slot":
      partes.push("Objetivo: comunicar a mensagem deste passo de forma natural.");
      break;
    case "system_capture":
    case "branch":
      partes.push("Objetivo: dar um retorno curto ao cliente enquanto o sistema processa este passo.");
      break;
  }

  return partes.join(" ");
}

/**
 * Formata as camadas de memória relevantes para o prompt, SEM despejar tudo de
 * uma vez (Requisito 20.4). Traz: o resumo da sessão, os dados de perfil já
 * confirmados e o que estiver pendente na camada operacional. Campos vazios são
 * omitidos para não poluir o contexto.
 */
function formatarMemoria(memoria: MemoriaEmCamadas): string {
  const linhas: string[] = [];

  if (memoria.sessao && memoria.sessao.trim()) {
    linhas.push(`Resumo da conversa até aqui: ${memoria.sessao.trim().slice(0, LIMITE_SESSAO)}`);
  }

  const perfil = formatarRegistro(memoria.perfil);
  if (perfil) linhas.push(`Dados confirmados do cliente: ${perfil}`);

  if (!linhas.length) return "";
  return "# Histórico útil\n" + linhas.join("\n");
}

/** Serializa um registro de memória ignorando valores vazios/nulos. */
function formatarRegistro(reg: Record<string, unknown>): string {
  const itens: string[] = [];
  for (const [chave, valor] of Object.entries(reg)) {
    if (valor === null || valor === undefined || valor === "") continue;
    if (typeof valor === "object") continue; // não despeja sub-objetos crus
    itens.push(`${chave}=${String(valor)}`);
  }
  return itens.join(", ");
}

/**
 * Monta o prompt de sistema com o passo, o tom, os dados confirmados, o RAG e a
 * memória em camadas. A regra de fluxo (qual passo) já veio decidida; aqui só
 * verbalizamos (Requisito 8.1).
 */
function montarPromptSistema(entrada: EntradaEscritor): string {
  const persona = (entrada.persona ?? "").trim();
  const blocos: string[] = [];

  blocos.push(
    persona
      ? persona
      : "Você é uma consultora da iGreen Energy conversando com o cliente no WhatsApp.",
  );

  blocos.push(`# Tom\n${instrucaoDeTom(entrada)}`);
  blocos.push(`# O que escrever agora\n${descreverPasso(entrada)}`);

  const memoriaTexto = formatarMemoria(entrada.memoria);
  if (memoriaTexto) blocos.push(memoriaTexto);

  const rag = (entrada.ragText ?? "").trim();
  if (rag) blocos.push(`# Conteúdo de apoio (use só o que for verdadeiro)\n${rag.slice(0, LIMITE_RAG)}`);

  blocos.push(
    [
      "# Idioma e registro (OBRIGATÓRIO)",
      "- Escreva SEMPRE em português do Brasil, em registro comercial e cordial.",
      "- Escreva em pt-BR MESMO QUE o cliente escreva em outro idioma, misture idiomas,",
      "  use gírias, abreviações ou erros de digitação. Nunca responda em outro idioma.",
      "- Não traduza literalmente: produza um texto comercial natural, como uma",
      "  consultora brasileira falaria no WhatsApp.",
      "- Linguagem simples e acessível: sem jargão técnico, sem termos em inglês,",
      "  sem siglas internas. Fale como o cliente fala no dia a dia.",
    ].join("\n"),
  );

  blocos.push(
    [
      "# Regras da escrita",
      "- Escreva APENAS a mensagem que vai ao cliente, em português do Brasil comercial.",
      "- Curto: no máximo 3 linhas. Use *negrito assim* quando precisar (nunca **assim**).",
      "- Não invente dados, valores, prazos nem promessas. Se não souber, não afirme.",
      "- Não escolha nem anuncie próximos passos do cadastro: só trate o passo atual.",
      "- Não exponha termos técnicos, códigos, erros ou nada de bastidor.",
    ].join("\n"),
  );

  return blocos.join("\n\n");
}

/**
 * Texto seguro de fallback quando o gateway de IA falha (Requisito 16.5,
 * Error Handling do design). Reusa o texto determinístico do próprio passo
 * (`persuasiveText`/`messageText`) — sem chamar IA. Devolve string vazia
 * quando não há base; nesse caso o Orquestrador (N1) decide handoff. A Guarda
 * (N5) ainda valida esse texto antes de qualquer envio.
 */
function textoSeguroDoPasso(entrada: EntradaEscritor): string {
  const passo = entrada.passoAtual;
  if (!passo) return "";
  return (passo.persuasiveText ?? passo.messageText ?? "").trim();
}

/**
 * Escreve a mensagem correspondente ao passo definido pelo Decisor (N3).
 *
 * O Escritor NÃO decide o passo (Requisito 8.1): recebe `entrada.passoAtual`
 * já escolhido e gera a mensagem correspondente a ele (Requisito 8.2),
 * reusando RAG, memória e o gateway `chatCascade` (Requisito 8.3). Saída em
 * português do Brasil comercial (Requisito 8.4).
 *
 * Fail-open (Requisito 16.5): se o gateway falhar ou vier vazio, cai para o
 * texto seguro do próprio passo, sem lançar — o atendimento nunca trava por
 * causa da escrita.
 *
 * @param entrada Passo atual, entendimento, estado, RAG, memória e persona.
 * @returns Texto final em português comercial.
 */
export async function escreverMensagem(
  entrada: EntradaEscritor,
): Promise<ResultadoEscritor> {
  const system = montarPromptSistema(entrada);

  // O contrato `EntradaEscritor` não inclui a fala crua do cliente (ela é
  // tratada por N2/N8 e chega resumida na memória de sessão). O turno de
  // usuário, portanto, é a instrução de produzir a mensagem do passo decidido —
  // o contexto necessário já está no prompt de sistema (passo + memória + RAG).
  const messages: ChatMsg[] = [
    { role: "system", content: system },
    { role: "user", content: "Escreva a mensagem deste passo agora." },
  ];

  try {
    const r = await chatCascade({
      models: MODELOS_ESCRITA,
      messages,
      temperature: TEMPERATURA_ESCRITA,
    });
    const texto = (r.text ?? "").trim();
    if (texto) return { texto };
    // Resposta vazia do gateway: cai para o texto seguro do passo.
    return { texto: textoSeguroDoPasso(entrada) };
  } catch (e) {
    console.warn("[cerebro/escritor] chatCascade falhou:", (e as { message?: string })?.message);
    // Fail-open: texto seguro determinístico do passo (Requisito 16.5).
    return { texto: textoSeguroDoPasso(entrada) };
  }
}
