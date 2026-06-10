/**
 * Glossário ÚNICO de linguagem do cliente (pt-BR comercial).
 *
 * Spec: `.kiro/specs/cerebro-ia/` — Requisitos 13 (linguagem em português
 * comercial) e 19 (glossário único). É a FONTE ÚNICA do mapa "termo técnico →
 * Termo_Comercial" (Requisito 19.1): qualquer peça que precise trocar jargão
 * por linguagem comercial deve importar daqui, para que o mesmo conceito tenha
 * sempre um único nome em banco, interface e mensagem (Requisito 19.3).
 *
 * O Guarda (N5) usa este mapa para aplicar o glossário na SAÍDA ao cliente
 * (Requisito 9.4) — ver `guarda.ts` → `aplicarGlossario`.
 *
 * Como adicionar um termo: inclua um par em `GLOSSARIO`. A substituição é
 * case-insensitive, respeita fronteiras de palavra (não quebra palavra dentro
 * de outra, mesmo com acentos) e trata frases de várias palavras antes das de
 * uma só (ex.: "uso de token" vira "consumo" sem cair na regra de "token").
 */

/** Um par do glossário: termo técnico (de entrada) → Termo_Comercial (saída). */
export interface ParGlossario {
  /** Termo técnico a ser substituído (case-insensitive; pode ter mais de uma palavra). */
  tecnico: string;
  /** Termo comercial que entra no lugar. */
  comercial: string;
}

/**
 * Mapa ÚNICO termo técnico → Termo_Comercial (Requisito 19.1).
 *
 * Reúne o mínimo exigido pelos Requisitos 13.2 e 19.2. A ordem aqui não importa
 * para a aplicação: `aplicarGlossario` ordena por tamanho (frases maiores
 * primeiro) para evitar substituição parcial.
 */
export const GLOSSARIO: ParGlossario[] = [
  // ── Requisito 13.2 ─────────────────────────────────────────────────────────
  { tecnico: "payload", comercial: "dados enviados" },
  { tecnico: "webhook", comercial: "integração automática" },
  { tecnico: "node", comercial: "etapa" },
  { tecnico: "trigger", comercial: "gatilho automático" },
  { tecnico: "flow", comercial: "fluxo de atendimento" },
  { tecnico: "lead", comercial: "cliente interessado" },
  { tecnico: "endpoint", comercial: "endereço de integração" },
  { tecnico: "token", comercial: "chave de integração" },
  { tecnico: "api", comercial: "integração" },
  { tecnico: "debug", comercial: "diagnóstico" },
  { tecnico: "undefined", comercial: "não informado" },
  { tecnico: "null", comercial: "não informado" },
  { tecnico: "error", comercial: "não foi possível concluir" },
  // ── Requisito 19.2 ─────────────────────────────────────────────────────────
  // "uso de token" vem aqui, mas a ordenação por tamanho garante que ele seja
  // tratado ANTES de "token" sozinho.
  { tecnico: "uso de token", comercial: "consumo" },
  { tecnico: "intenção", comercial: "assunto" },
  { tecnico: "agente", comercial: "atendimento inteligente" },
  { tecnico: "base de conhecimento", comercial: "base de conteúdo" },
  { tecnico: "memória", comercial: "histórico útil" },
  { tecnico: "handoff", comercial: "transferir para atendente" },
  { tecnico: "ferramenta", comercial: "ação automática" },
];

/**
 * Letra/algarismo em Unicode — usado para montar fronteiras de palavra que
 * funcionam com acentos (o `\b` do JavaScript é só ASCII e falha em "intenção",
 * "memória", etc.). Considera letras (`\p{L}`), números (`\p{N}`) e `_`.
 */
const CLASSE_PALAVRA = "[\\p{L}\\p{N}_]";

/** Escapa caracteres especiais de regex em um termo do glossário. */
function escaparRegex(termo: string): string {
  return termo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Monta a regex de um termo: case-insensitive, com fronteira de palavra antes e
 * depois (sem quebrar palavra dentro de outra) e tolerante a espaços variáveis
 * em frases de várias palavras (ex.: "base   de  conhecimento").
 */
function montarRegex(tecnico: string): RegExp {
  const partes = tecnico.trim().split(/\s+/).map(escaparRegex);
  const corpo = partes.join("\\s+");
  // Lookbehind/lookahead negativos garantem que não estamos no meio de outra
  // palavra (ex.: "api" não casa dentro de "apicultura" nem "rapidez").
  return new RegExp(
    `(?<!${CLASSE_PALAVRA})(${corpo})(?!${CLASSE_PALAVRA})`,
    "giu",
  );
}

/** Aplica a capitalização do trecho original ao termo comercial de saída. */
function preservarCaixa(original: string, comercial: string): string {
  // Trecho todo em maiúsculas (ex.: "API") → comercial em maiúsculas.
  if (original.length > 1 && original === original.toUpperCase()) {
    return comercial.toUpperCase();
  }
  // Primeira letra maiúscula (início de frase) → comercial capitalizado.
  const primeira = original[0];
  if (primeira && primeira === primeira.toUpperCase() && primeira !== primeira.toLowerCase()) {
    return comercial.charAt(0).toUpperCase() + comercial.slice(1);
  }
  return comercial;
}

/**
 * Lista de regras já compiladas, ordenadas da frase mais longa para a mais
 * curta (por nº de palavras e depois por tamanho). Isso garante que "uso de
 * token" e "base de conhecimento" sejam tratados antes de "token"/"base".
 */
const REGRAS = [...GLOSSARIO]
  .sort((a, b) => {
    const palavrasA = a.tecnico.trim().split(/\s+/).length;
    const palavrasB = b.tecnico.trim().split(/\s+/).length;
    if (palavrasB !== palavrasA) return palavrasB - palavrasA;
    return b.tecnico.length - a.tecnico.length;
  })
  .map((par) => ({ regex: montarRegex(par.tecnico), comercial: par.comercial }));

/**
 * Troca todo termo técnico do glossário pelo Termo_Comercial correspondente,
 * preservando o restante do texto (Requisitos 9.4, 13.1, 13.2, 19.1, 19.2).
 *
 * - Case-insensitive, com preservação leve de caixa (início de frase / sigla).
 * - Respeita fronteira de palavra: não substitui termo dentro de outra palavra.
 * - Frases de várias palavras têm prioridade sobre palavras isoladas.
 */
export function traduzirComGlossario(texto: string): string {
  let s = String(texto ?? "");
  if (!s) return s;
  for (const { regex, comercial } of REGRAS) {
    s = s.replace(regex, (achado) => preservarCaixa(achado, comercial));
  }
  return s;
}
