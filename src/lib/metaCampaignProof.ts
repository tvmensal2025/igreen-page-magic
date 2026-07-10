/**
 * Critério único: lead só conta como "da campanha Meta" com prova determinística.
 *
 * NÃO conta: só source_campaign_id, manual_backfill, fallback_single_active_pool,
 * frase genérica Meta sem AD ID / ctwa_clid.
 */

export const META_CAMPAIGN_PROOF_METHODS = [
  "ad_id",
  "ctwa_clid",
  "ad_id_or_ctwa_clid",
  "protocol",
  "short_code",
  "exact_message",
  "initial_message",
] as const;

export type MetaCampaignProofMethod = (typeof META_CAMPAIGN_PROOF_METHODS)[number];

export type CustomerMetaProofFields = {
  source_ad_id?: string | null;
  ctwa_clid?: string | null;
  source_ctwa_clid?: string | null;
};

function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** Prova no próprio customer (AD ID ou ctwa_clid). */
export function hasMetaCampaignProof(c: CustomerMetaProofFields | null | undefined): boolean {
  if (!c) return false;
  return nonEmpty(c.source_ad_id) || nonEmpty(c.ctwa_clid) || nonEmpty(c.source_ctwa_clid);
}

/**
 * Filtro PostgREST para `.or(...)` — só customers com prova Meta no registro.
 * Usar junto com `.eq("source_campaign_id", id)` / `.in(...)`.
 */
export const META_CAMPAIGN_PROOF_OR =
  "source_ad_id.not.is.null,ctwa_clid.not.is.null,source_ctwa_clid.not.is.null";

export function isProvenMatchMethod(method: string | null | undefined): boolean {
  if (!method) return false;
  return (META_CAMPAIGN_PROOF_METHODS as readonly string[]).includes(method);
}
