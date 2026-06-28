/**
 * meta-ctwa-fallback.ts
 *
 * Quando o Meta entrega o lead via Click-to-WhatsApp mas NÃO propaga o
 * `ctwa_clid`/`referral` no payload (acontece em ~10% dos cliques, depende do
 * template do anúncio), a única pista que sobra é a frase de abertura
 * genérica que o Meta pré-preenche. Cobrimos esse caso com 2 ferramentas:
 *
 *   1. `matchesMetaCtwaPhrase(text)` — confere se a primeira mensagem do lead
 *      bate com uma das frases-âncora típicas do CTWA.
 *   2. `resolveSingleActivePool(supabase, consultantId)` — se o consultor
 *      tem EXATAMENTE 1 pool de rodízio ativa, devolve a `campaign_id` dela
 *      para servir de fallback determinístico (não há ambiguidade).
 *
 * Use os dois em conjunto: detecta meta_ads via frase + atribui via pool única.
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
 * Se o consultor tem EXATAMENTE 1 pool de rodízio ativa (com campaign_id),
 * devolve `{ pool_id, campaign_id }`. Caso contrário (0 ou 2+) devolve null —
 * ambíguo demais para fallback automático.
 */
export async function resolveSingleActivePool(
  supabase: any,
  consultantId: string,
): Promise<{ pool_id: string; campaign_id: string } | null> {
  try {
    const { data, error } = await supabase
      .from("rodizio_pools")
      .select("id, campaign_id")
      .eq("consultant_id", consultantId)
      .eq("is_active", true)
      .not("campaign_id", "is", null);
    if (error || !Array.isArray(data) || data.length !== 1) return null;
    const row = data[0] as { id: string; campaign_id: string };
    if (!row.campaign_id) return null;
    return { pool_id: row.id, campaign_id: row.campaign_id };
  } catch {
    return null;
  }
}
