// qr-phrase (Deno) — frase PADRÃO e curta para o link/QR de parceiros.
//
// PARIDADE COM O FRONT
// --------------------
// Este módulo é o ESPELHO em Deno de `src/components/admin/parceiros/qrPhrase.ts`
// (front, Vite/TS). A lógica precisa ser idêntica nos dois lados porque:
//   • o FRONT usa para exibir/prever a frase no card do QR (`PartnerQrCode`);
//   • o RUNTIME (`qr-redirect`) usa para montar o `?text=` do `wa.me` quando o
//     lead abre o link curto `.../qr-redirect?l={licenca}&p={partnerId}`.
// Se um lado divergir, o consultor veria uma frase no painel e o lead receberia
// outra. Ao mexer aqui, replique no front (e vice-versa).
//
// REGRA DE OURO: a keyword precisa continuar aparecendo na frase, porque é ela
// que o webhook procura no texto para atribuir o lead ao parceiro
// (`keyword-matcher.ts`, match por substring normalizada). Encurtar sem a
// keyword quebraria o cashback.

/** Comprimento máximo recomendado da frase (mantém a URL `wa.me` enxuta). */
export const QR_PHRASE_MAX = 90;

/** Remove espaços duplicados e apara as pontas. */
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Igual à normalização do `keyword-matcher.ts`: sem acentos, pontuação vira
 * espaço, minúsculas. Usado para checar se a keyword já está na frase.
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

/**
 * Frase PADRÃO curta para um parceiro, sempre contendo a `keyword`.
 *
 * - Com keyword: `Oi! Quero economizar na conta de luz. (indicação: {keyword})`
 * - Sem keyword: frase genérica curta.
 */
export function buildDefaultQrPhrase(keyword?: string | null): string {
  const kw = tidy(keyword ?? "");
  const base = "Oi! Quero economizar na conta de luz.";
  if (!kw) return base;
  return tidy(`${base} (indicação: ${kw})`);
}

/**
 * Resolve a mensagem final do link/QR a partir do que está salvo no parceiro.
 *
 *   1. Sem `qrPhrase`, OU `qrPhrase` longa demais (> `QR_PHRASE_MAX`): usa a
 *      frase padrão curta, que já contém a keyword.
 *   2. Frase própria dentro do limite, mas SEM a keyword: anexa a keyword ao
 *      final — mas, se isso estourar o limite, cai na frase padrão curta.
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
