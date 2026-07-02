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
 * ⚠️ `resolveSingleActivePool` foi REMOVIDO propositalmente (blindagem do
 * rodízio — plano "blindagem-do-rodizio-de-parceiros"). Ele atribuía uma
 * campanha ao acaso quando o consultor tinha exatamente 1 pool ativa, o que
 * levou a leads irem para o parceiro errado. Hoje: se a frase-âncora bate
 * mas nenhum sinal determinístico (AD ID / ctwa_clid / initial_message) casa
 * uma campanha, o lead entra na **fila de revisão manual** (customers.
 * needs_manual_review = true) e o dono do anúncio é notificado por WhatsApp.
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

/**
 * @deprecated Removido pela blindagem do rodízio. Chamadas antigas caem
 * automaticamente na fila de revisão manual. Se algum código ainda importar
 * esta função, ela devolve `null` (nunca atribui campanha por chute).
 */
export async function resolveSingleActivePool(
  _supabase: unknown,
  _consultantId: string,
): Promise<null> {
  return null;
}
