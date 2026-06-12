/**
 * N2 — Entendimento (pt-BR).
 *
 * Spec: `.kiro/specs/cerebro-ia/design.md` — peça N2.
 *
 * Lê a mensagem do cliente e identifica: a intenção comercial (conjunto
 * pequeno e fechado), os dados de cadastro citados e a objeção. REUSA os
 * extratores e classificadores existentes da Vendedora_Atual — nunca
 * reimplementa essa lógica (Requisito 1.3, 1.4, 4.2).
 *
 * Estado da implementação:
 *   - Tarefa 3.1 (FEITA): identificação da intenção comercial em conjunto
 *     pequeno e fechado (Requisito 4.1, 4.4, 4.5).
 *   - Tarefa 3.2 (FEITA): extrair dados (nome, valor da conta, e-mail) REUSANDO
 *     os extratores existentes (Requisito 4.2).
 *   - Tarefa 3.3 (FEITA): classificar o tipo da objeção REUSANDO o
 *     `classificarObjecao` da Vendedora_Atual e mapeando para o conjunto
 *     `TipoObjecao` do Cérebro (Requisito 4.3).
 */

import type {
  DadosExtraidos,
  EntradaEntendimento,
  IntencaoComercial,
  ResultadoEntendimento,
  TipoObjecao,
} from "./tipos.ts";

// REÚSO (Requisito 4.2 / 1.3): o classificador determinístico de objeções/
// dúvidas da Vendedora_Atual já reconhece pedido de humano, desistência e os
// tipos de objeção. Em vez de recriar essa rede de padrões, importamos e a
// usamos como base para mapear a intenção comercial.
import { classificarObjecao } from "./comum/templates.ts";
import type { ObjecaoTipo } from "./comum/templates.ts";

// REÚSO (Requisito 4.2): extratores de dados de cadastro já existentes da
// Vendedora_Atual. NÃO reimplementamos a regex de extração — importamos e
// usamos os extratores prontos.
//   - `captureExtractors.ts`: extratores determinísticos por regex (puros, sem
//     IA) para nome e valor da conta. São a base do "fluxo da Camila" e o
//     próprio `extrairNome` da V2 delega a `extractNome` daqui.
//   - `vendedora/extractors.ts`: extrator de e-mail da V2 (regex determinística
//     com cascata opcional de IA), usado para o e-mail.
import { extractNome, extractValor } from "../captureExtractors.ts";
import { extrairEmail } from "./comum/extrair-email.ts";

// ─── Intenção comercial (Tarefa 3.1) ─────────────────────────────────────────

/**
 * Tipos de objeção da Vendedora_Atual que, para fins de INTENÇÃO, contam como
 * "o cliente está levantando uma objeção" (Requisito 4.1 → `levantar_objecao`).
 *
 * Ficam de fora, de propósito:
 *   - `pedido_humano` e `desistencia`: têm intenção própria no conjunto fechado.
 *   - `foto_antes`: cliente quer enviar a conta → sinal de interesse, não objeção.
 *   - `como_funciona` e `pedido_recap`: são dúvidas informativas, não objeções;
 *     caem em `indefinido` (Requisito 4.4) para o Decisor/Escritor tratarem.
 *   - `generica`: catch-all do classificador; não é objeção por si só.
 */
const OBJECOES_REAIS = new Set<ObjecaoTipo>([
  "golpe",
  "obra",
  "fidelidade",
  "solar",
  "distribuidora",
  "aluguel",
  "outra_empresa",
  "boleto",
  "prazo",
  "cobertura",
  "cancelar",
  "taxa_adesao",
  "conta_baixa",
  "como_ganham",
  "pensar",
  "titularidade",
  "cnpj",
  "homologacao_aneel",
]);

/**
 * O cliente está pedindo explicitamente uma simulação/estimativa de economia?
 * (Requisito 4.1 → `pedir_simulacao`). Heurística determinística e enxuta —
 * evita catálogo amplo de intenções (Requisito 4.5).
 */
function pedeSimulacao(texto: string): boolean {
  const t = texto.toLowerCase();
  if (/simula[çc]/.test(t)) return true; // "simulação", "simular", "faz uma simulação"
  if (/qual (?:o |a |seria )?(?:meu )?(?:desconto|economia)/.test(t)) return true;
  // "me faz/manda/mostra/dá uma cotação/prévia/estimativa". Não inclui "conta"
  // (ambíguo com "conta de luz") nem "da" sem fronteira (pegaria "da conta").
  if (/(?:me )?(?:faz|manda|mostra|\bd[áa]\b|fazer) (?:uma |a )?(?:cota[çc]|pr[ée]via|estimativa)/.test(t)) {
    return true;
  }
  // "quanto (eu) vou economizar/pagar/poupar", "quanto fica/sai/cai a conta"
  if (/quanto\s+(?:eu\s+)?(?:vou|iria|consigo|posso|daria|d[áa]\s*pra|fica|sai|cai|cair|pagaria|pago|economiz|poupar|abat)/.test(t)) {
    return true;
  }
  return false;
}

/**
 * O cliente demonstrou interesse explícito em prosseguir? (Requisito 4.1 →
 * `demonstrar_interesse`). Os gatilhos espelham os padrões determinísticos já
 * validados em `vendedora/extractors.ts` (`classificarInteresse`) — sem chamar
 * IA, para manter a peça testável de forma isolada (Requisito 7.4).
 */
function demonstraInteresse(texto: string): boolean {
  const t = texto.trim();
  const low = t.toLowerCase();

  // Negação explícita nunca é interesse ("não quero", "agora não", "ainda não")
  // — salvo confirmação forte logo depois ("não tenho dúvida, quero sim").
  if (/\b(n[ãa]o|nunca|jamais|ainda n[ãa]o|agora n[ãa]o)\b/.test(low)) {
    if (!/\b(quero sim|sim,?\s*quero|pode sim|claro que quero)\b/.test(low)) {
      return false;
    }
  }

  // "quero/queria + verbo de dúvida" é pergunta, não interesse de fechar.
  if (/\b(quero|queria|gostaria de)\s+(saber|entender|ver|conhecer|pensar|perguntar|tirar|confirmar|comparar)\b/.test(low)) {
    return false;
  }

  // Gatilhos fortes de avançar/fechar.
  if (/(^|\s)(vamos|fechado|fechou|bora|t[óo]\s*dentro|manda\s*ver)(\s|$|[.!])/.test(low)) return true;
  if (/\b(pode\s*mandar|ok\s*manda|sim,?\s*manda|manda\s*a[ií]|quero\s*sim|sim,?\s*quero|claro\s*que\s*quero|quero\s*(fechar|contratar|cadastrar|come|seguir|aderir|agora|esse|isso)|pode\s*(seguir|mandar|prosseguir)|como\s*fa(z|ç|c))/.test(low)) {
    return true;
  }
  // Confirmação curta isolada ("sim", "quero", "fechado", "bora"…).
  if (/^(sim|quero|isso|claro|com certeza|perfeito|ok|fechado|bora|manda|👍|✅)[\s.!]*$/.test(low)) {
    return true;
  }
  return false;
}

/**
 * Identifica a Intencao_Comercial da mensagem dentro de um conjunto PEQUENO e
 * FECHADO (Requisito 4.1, 4.5). Qualquer mensagem que não caia em nenhuma das
 * intenções conhecidas vira `indefinido` (Requisito 4.4).
 *
 * Função determinística e pura no texto, para ser testada isolada das demais
 * peças (Requisito 7.4). A ordem de verificação reflete a prioridade comercial:
 * pedido de humano e desistência vêm primeiro; depois pedido de simulação;
 * objeção; interesse; e, por fim, indefinido.
 */
export function identificarIntencao(inboundText: string): IntencaoComercial {
  const texto = String(inboundText || "").trim();
  if (!texto) return "indefinido";

  // 1) Reúso do classificador da Vendedora_Atual: já cobre pedido de humano,
  //    desistência e os tipos de objeção de forma determinística.
  const tipo = classificarObjecao(texto);
  if (tipo === "pedido_humano") return "pedir_humano";
  if (tipo === "desistencia") return "desistir";

  // 2) Pedido explícito de simulação/economia.
  if (pedeSimulacao(texto)) return "pedir_simulacao";

  // 3) Objeção comercial reconhecida.
  if (OBJECOES_REAIS.has(tipo)) return "levantar_objecao";

  // 4) Interesse explícito em prosseguir (inclui "quero mandar a foto").
  if (tipo === "foto_antes" || demonstraInteresse(texto)) return "demonstrar_interesse";

  // 5) Nada do conjunto fechado se aplica (Requisito 4.4).
  return "indefinido";
}

// ─── Classificação da objeção (Tarefa 3.3) ───────────────────────────────────

/**
 * Mapa de equivalência entre os tipos de objeção da Vendedora_Atual
 * (`ObjecaoTipo`, conjunto amplo e específico do negócio) e o conjunto PEQUENO
 * e FECHADO de `TipoObjecao` do Cérebro (Requisito 4.3).
 *
 * REÚSO (Requisito 1.3): a DETECÇÃO da objeção continua sendo feita pelo
 * `classificarObjecao` da vendedora — aqui só traduzimos o rótulo dele para o
 * vocabulário enxuto do Cérebro. Nada de rede de regex é reimplementado.
 *
 * Tipos que não representam uma objeção comercial (pedido de humano,
 * desistência, intenção de enviar foto, dúvidas informativas e o catch-all
 * `generica`) mapeiam para `undefined` — nesses casos o campo `objecao` fica
 * ausente. Eles são tratados pela intenção, não como objeção.
 *
 * Critério de agrupamento (do específico para o enxuto):
 *   - `preco`: custo de entrar ou "não compensa" pelo valor da conta.
 *   - `desconfianca`: medo de golpe, dúvida sobre lucro/idoneidade/regulação.
 *   - `sem_tempo`: adiar a decisão ("vou pensar", "depois").
 *   - `ja_tem_solucao`: já está com outra empresa/solução.
 *   - `nao_entendeu`: confusão sobre o que é (ex.: acha que é energia solar).
 *   - `outro`: demais objeções legítimas sem encaixe direto no conjunto enxuto.
 */
const MAPA_OBJECAO: Partial<Record<ObjecaoTipo, TipoObjecao>> = {
  // preço / custo
  taxa_adesao: "preco",
  conta_baixa: "preco",
  // desconfiança / idoneidade
  golpe: "desconfianca",
  como_ganham: "desconfianca",
  cnpj: "desconfianca",
  homologacao_aneel: "desconfianca",
  // adiar a decisão
  pensar: "sem_tempo",
  // já tem outra solução
  outra_empresa: "ja_tem_solucao",
  // confusão sobre o que é o serviço
  solar: "nao_entendeu",
  // demais objeções legítimas
  obra: "outro",
  fidelidade: "outro",
  distribuidora: "outro",
  aluguel: "outro",
  boleto: "outro",
  prazo: "outro",
  cobertura: "outro",
  cancelar: "outro",
  titularidade: "outro",
};

/**
 * Classifica o tipo da objeção da mensagem dentro do conjunto fechado
 * `TipoObjecao` (Requisito 4.3), REUSANDO o `classificarObjecao` da
 * Vendedora_Atual para a detecção e o `MAPA_OBJECAO` para a tradução.
 *
 * Retorna `undefined` quando a mensagem não contém uma objeção comercial
 * (ex.: pedido de humano, desistência, dúvida informativa) — nesse caso o
 * campo `objecao` do entendimento fica ausente.
 *
 * Função determinística e pura no texto, testável de forma isolada
 * (Requisito 7.4).
 */
export function classificarTipoObjecao(inboundText: string): TipoObjecao | undefined {
  const texto = String(inboundText || "").trim();
  if (!texto) return undefined;
  const tipoVendedora = classificarObjecao(texto);
  return MAPA_OBJECAO[tipoVendedora];
}

// ─── Extração de dados (Tarefa 3.2) ──────────────────────────────────────────

/**
 * Extrai os dados de cadastro citados na mensagem REUSANDO os extratores já
 * existentes (Requisito 4.2). Nenhuma regex de extração é reimplementada aqui:
 *
 *   - `nome`  → `extractNome` de `captureExtractors.ts` (determinístico, puro).
 *   - `valorConta` → `extractValor` de `captureExtractors.ts` (determinístico).
 *   - `email` → `extrairEmail` de `vendedora/extractors.ts`. Esse extrator tem
 *     um atalho determinístico por regex e só recorre à IA quando o atalho
 *     falha. Para manter a peça testável de forma isolada e respeitar o
 *     controle de custo de IA (Requisito 16.5), só o acionamos quando o texto
 *     contém "@" — sinal de que pode haver um e-mail para o regex resolver.
 *
 * Campos sem valor extraído ficam ausentes (indefinidos) — nunca são
 * preenchidos por suposição (ver contrato de `DadosExtraidos`).
 */
export async function extrairDados(inboundText: string): Promise<DadosExtraidos> {
  const texto = String(inboundText || "");
  const dados: DadosExtraidos = {};
  if (!texto.trim()) return dados;

  const nome = extractNome(texto);
  if (nome) dados.nome = nome;

  const valor = extractValor(texto);
  if (valor != null) dados.valorConta = valor;

  if (texto.includes("@")) {
    const email = await extrairEmail(texto);
    if (email) dados.email = email;
  }

  return dados;
}

// ─── Entendimento completo (N2) ──────────────────────────────────────────────

/**
 * Entende a mensagem recebida do cliente.
 *
 * @param entrada Texto recebido, histórico e estado atual do cliente.
 * @returns Intenção comercial, dados extraídos e objeção (se houver).
 *
 * Preenche a intenção (Tarefa 3.1), os dados de cadastro (Tarefa 3.2) e o tipo
 * da objeção (Tarefa 3.3), reusando os extratores e o classificador existentes.
 * O campo `objecao` só aparece quando há uma objeção comercial detectada.
 */
export async function entenderMensagem(
  entrada: EntradaEntendimento,
): Promise<ResultadoEntendimento> {
  const intencao = identificarIntencao(entrada.inboundText);
  const dados = await extrairDados(entrada.inboundText);

  // Tarefa 3.3: quando a intenção é `levantar_objecao` (ou há objeção
  // detectada pelo classificador reusado), preenche o tipo da objeção
  // (Requisito 4.3). Caso contrário, o campo fica ausente.
  const resultado: ResultadoEntendimento = { intencao, dados };
  const objecao = classificarTipoObjecao(entrada.inboundText);
  if (objecao) resultado.objecao = objecao;

  return resultado;
}
