/**
 * Variante canônica do funil WhatsApp (Grupo A / Sofia Multicanal).
 *
 * Regra de produto (2026-07-20): o padrão é SEMPRE A.
 * Fluxo F (CEMIG 2), D, M etc. NÃO devem receber lead novo nem
 * “roubar” lead no meio do atendimento (ex.: Iniciar atendimento / reheat).
 *
 * Quem precisa ler a variante do customer deve passar por
 * `resolveCanonicalFlowVariant` — se vier F/D/M/…, força A.
 */

export const CANONICAL_FLOW_VARIANT = "A" as const;

/**
 * Normaliza qualquer valor para a variante canônica A.
 * Qualquer coisa diferente de A (F, D, M, B, C, vazio) → A.
 */
export function resolveCanonicalFlowVariant(
  _raw?: string | null,
): typeof CANONICAL_FLOW_VARIANT {
  return CANONICAL_FLOW_VARIANT;
}

/** True se a variante atual precisa ser corrigida para A. */
export function needsCanonicalFlowVariantRepair(
  raw: string | null | undefined,
): boolean {
  return String(raw || "").trim().toUpperCase() !== CANONICAL_FLOW_VARIANT;
}
