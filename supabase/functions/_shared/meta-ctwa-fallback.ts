/**
 * meta-ctwa-fallback.ts
 *
 * Quando o Meta entrega o lead via Click-to-WhatsApp mas NÃO propaga o
 * `ctwa_clid`/`referral` no payload (acontece em ~10% dos cliques, depende do
 * template do anúncio), a única pista que sobra é a frase de abertura
 * genérica que o Meta pré-preenche.
 *
 * `matchesMetaCtwaPhrase(text)` — confere se a primeira mensagem do lead
 * bate com uma das frases-âncora típicas do CTWA.
 *
 * ⚠️ Quando há **2+ pools/campanhas ativas** e nenhum sinal forte, NÃO escolher
 * campanha. DDD, atividade recente e rotação não provam a origem do lead e já
 * causaram contaminação entre campanhas individuais. O lead deve ir para revisão
 * manual até chegar AD ID / CTWA / protocolo / fuzzy claro.
 */


export const META_CTWA_OPENING_PHRASES = [
  "ola posso ter mais informacoes sobre isso",
  "posso ter mais informacoes sobre isso",
  "quero saber mais",
  "tenho interesse gostaria de mais informacoes",
  "ola vi o anuncio",
  "ola vi seu anuncio",
  "ola tenho interesse",
  "ola gostaria de saber mais",
  "ola quero mais informacoes",
  // iGreen / energia CTWA (autofill típico dos anúncios)
  "quero saber como consigo pagar menos na conta de luz",
  "pagar menos na conta de luz",
  "conta de luz mais barata",
];

function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesMetaCtwaPhrase(text: string | null | undefined): boolean {
  if (!text) return false;
  const n = norm(text);
  if (n.length < 5) return false;
  for (const p of META_CTWA_OPENING_PHRASES) {
    if (n.includes(p) || p.includes(n)) return true;
  }
  return false;
}

/** Abertura típica CTWA iGreen/energia (inclui frases Meta genéricas). */
export function looksLikePaidCtwaOpener(text: string | null | undefined): boolean {
  if (!text) return false;
  if (matchesMetaCtwaPhrase(text)) return true;
  const n = norm(text);
  if (n.length < 12) return false;
  return (
    n.includes("pagar menos na conta de luz") ||
    n.includes("economia na conta de luz") ||
    n.includes("desconto na conta de luz") ||
    n.includes("conta de luz mais barata") ||
    n.includes("quero saber como consigo pagar menos")
  );
}

// resolveSingleActivePool foi REMOVIDO — não reintroduzir. Se um caller
// precisar reaparecer, use a fila de revisão manual em customers.needs_manual_review.

