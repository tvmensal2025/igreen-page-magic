// qrPhrase — frase PADRÃO e curta para o link/QR de parceiros indicadores.
//
// PROBLEMA QUE RESOLVE
// --------------------
// O link `wa.me` do parceiro carrega a mensagem inteira no `?text=`, codificada
// (`encodeURIComponent`). Frases longas (ex.: as geradas como "exemplo de
// mensagem do lead") viram URLs gigantes — cada espaço vira `%20`, cada acento
// `%C3%xx`. O consultor reclama do tamanho do link no card abaixo do QR.
//
// SOLUÇÃO
// -------
// Uma frase PADRÃO curta, montada de forma DETERMINÍSTICA (sem IA), que todo
// parceiro recebe por padrão. Ela é propositalmente enxuta e SEMPRE contém a
// palavra-chave do parceiro — porque é exatamente a keyword que o webhook
// procura no texto para atribuir o lead ao parceiro (`keyword-matcher.ts`,
// match por substring normalizada). Encurtar sem a keyword quebraria o cashback;
// por isso a keyword é preservada.
//
// REGRA DE OURO: a keyword precisa continuar aparecendo na frase. Tudo o mais
// é livre e mantido curto.

/** Comprimento máximo recomendado da frase (mantém a URL `wa.me` enxuta). */
export const QR_PHRASE_MAX = 90;

/** Remove espaços duplicados e apara as pontas. */
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Frase PADRÃO curta para um parceiro, sempre contendo a `keyword`.
 *
 * - Com keyword: `Oi! Quero saber mais sobre o desconto na energia. (indicação: {keyword})`
 * - Sem keyword: frase genérica curta (parceiro sem keyword não atribui mesmo,
 *   mas o link continua válido e curto).
 */
export function buildDefaultQrPhrase(keyword?: string | null): string {
  const kw = tidy(keyword ?? "");
  const base = "Oi! Quero saber mais sobre o desconto na energia.";
  if (!kw) return base;
  return tidy(`${base} (indicação: ${kw})`);
}

/**
 * Resolve a mensagem final do link/QR a partir do que está salvo no parceiro.
 *
 * Ordem de decisão:
 *   1. Sem `qrPhrase`, OU `qrPhrase` longa demais (acima de `QR_PHRASE_MAX`):
 *      usa a frase padrão curta (`buildDefaultQrPhrase`), que já contém a
 *      keyword. É isso que encurta o link de parceiros antigos com frase grande.
 *   2. Frase própria dentro do limite, mas SEM a keyword: anexa a keyword ao
 *      final para não perder a atribuição (o cashback depende disso) — mas, se
 *      isso estourar o limite, cai na frase padrão curta.
 *   3. Frase própria dentro do limite e com a keyword: respeita a escolha dele.
 *
 * Nunca devolve string vazia: no pior caso, a frase genérica padrão.
 */
export function resolveQrMessage(
  qrPhrase: string | null | undefined,
  keyword: string | null | undefined,
): string {
  const kw = tidy(keyword ?? "");
  const custom = tidy(qrPhrase ?? "");

  // Sem frase própria OU frase longa demais → padrão curto (encurta o link).
  if (!custom || custom.length > QR_PHRASE_MAX) {
    return buildDefaultQrPhrase(kw);
  }

  // Frase dentro do limite, mas sem a keyword: tenta anexar a keyword. Se o
  // resultado passar do limite, prefere a frase padrão curta a alongar o link.
  if (kw && !containsKeyword(custom, kw)) {
    const withKw = tidy(`${custom} (indicação: ${kw})`);
    return withKw.length > QR_PHRASE_MAX ? buildDefaultQrPhrase(kw) : withKw;
  }

  return custom;
}

/**
 * Igual à normalização do `keyword-matcher.ts` do runtime: sem acentos,
 * pontuação vira espaço, minúsculas. Usado para checar se a keyword já está
 * presente na frase do consultor (mesma régua que o webhook usa para atribuir).
 */
function norm(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `true` quando a keyword aparece na frase (substring após normalização). */
export function containsKeyword(phrase: string, keyword: string): boolean {
  const k = norm(keyword);
  if (!k) return true; // sem keyword, nada a exigir
  return norm(phrase).includes(k);
}
