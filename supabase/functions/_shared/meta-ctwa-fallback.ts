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
 * ⚠️ `resolveSingleActivePool` foi removido — não escolher campanha "no chute"
 * quando existe 1 pool única já é feito por `resolveCampaignBySoleActivePool`
 * (que exige exatamente 1 ativa). Quando há **2+ pools ativas** e nenhum sinal
 * forte, a escada `resolveCampaignAutoLadder` (degraus DDD/cidade → atividade
 * recente → rodízio justo) decide de forma determinística e rastreável em
 * `campaign_match_log`. `customers.needs_manual_review = true` só vira último
 * recurso quando o consultor não tem nenhuma pool ativa.
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

// resolveSingleActivePool foi REMOVIDO — não reintroduzir. Se um caller
// precisar reaparecer, use a fila de revisão manual em customers.needs_manual_review.

