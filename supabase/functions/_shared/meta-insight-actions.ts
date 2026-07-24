/**
 * Extrai leads/conversas dos `actions[]` do Insights da Meta.
 *
 * Armadilha (2026-07-24): NÃO somar action_types distintos de messaging.
 * A Graph costuma devolver juntos:
 *   messaging_conversation_started_7d + messaging_first_reply + total_messaging_connection
 * Somar triplica conversas → CPL artificialmente ~1/3 → Cérebro sobe budget à toa.
 * Usar 1 métrica canônica (prioridade) = o que o Ads Manager mostra como resultado CTWA.
 */

export const META_CONV_ACTION_PRIORITY = [
  "onsite_conversion.messaging_conversation_started_7d",
  "messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "messaging_first_reply",
  "onsite_conversion.total_messaging_connection",
  "total_messaging_connection",
] as const;

export const META_LEAD_ACTION_PRIORITY = [
  "lead",
  "onsite_conversion.lead_grouped",
] as const;

type ActionRow = { action_type?: string; value?: string | number };

/** Primeiro valor > 0 na ordem de prioridade (não soma tipos diferentes). */
export function pickMetaActionValue(
  actions: ActionRow[] | undefined,
  priority: readonly string[],
): number {
  if (!Array.isArray(actions) || actions.length === 0) return 0;
  const byType = new Map<string, number>();
  for (const a of actions) {
    const t = typeof a?.action_type === "string" ? a.action_type : "";
    if (!t) continue;
    const v = Number(a?.value || 0);
    if (!Number.isFinite(v)) continue;
    byType.set(t, v);
  }
  for (const t of priority) {
    const v = byType.get(t);
    if (v != null && v > 0) return Math.round(v);
  }
  return 0;
}

export function pickMetaConversations(actions: ActionRow[] | undefined): number {
  return pickMetaActionValue(actions, META_CONV_ACTION_PRIORITY);
}

export function pickMetaLeads(actions: ActionRow[] | undefined): number {
  return pickMetaActionValue(actions, META_LEAD_ACTION_PRIORITY);
}
