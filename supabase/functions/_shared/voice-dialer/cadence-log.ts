/**
 * Extrai o customer_id somente de logs criados pelo cadence-tick.
 * Callback externo nunca é aceito como fonte desse vínculo.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function customerIdFromCadenceVoiceLog(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const meta = raw as Record<string, unknown>;
  if (meta.source !== "cadence") return null;
  const customerId = typeof meta.customer_id === "string" ? meta.customer_id.trim() : "";
  return UUID_RE.test(customerId) ? customerId : null;
}
