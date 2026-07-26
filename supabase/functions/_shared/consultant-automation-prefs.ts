/**
 * Preferências de automação por consultor (opt-in).
 * Cadeado 2 após gates globais — nunca liga o que o global desligou.
 *
 * Packs:
 *  - a / b / c → cadência + reheat (B)
 *  - pos_venda → pos-venda-auto-progress
 *  - reminders → follow-ups / FAQ nudge / bot-followup / CRM auto msg
 */

// deno-lint-ignore no-explicit-any
type SB = any;

export type ConsultantAutoPack = "a" | "b" | "c" | "pos_venda" | "reminders";

export type ConsultantAutomationPrefs = {
  consultant_id: string;
  group_a_enabled: boolean;
  group_b_enabled: boolean;
  group_c_enabled: boolean;
  pos_venda_auto_enabled: boolean;
  pos_venda_auto_validate: boolean;
  reminders_auto_enabled: boolean;
  acked_at: string | null;
};

/** Defaults fail-closed: sem row = tudo OFF. */
export const DEFAULT_CONSULTANT_AUTOMATION_PREFS: Omit<ConsultantAutomationPrefs, "consultant_id"> = {
  group_a_enabled: false,
  group_b_enabled: false,
  group_c_enabled: false,
  pos_venda_auto_enabled: false,
  pos_venda_auto_validate: false,
  reminders_auto_enabled: false,
  acked_at: null,
};

const cache = new Map<string, { value: ConsultantAutomationPrefs; expires: number }>();
const TTL_MS = 15_000;

export function stageGroupToPack(group: "A" | "B" | "C"): ConsultantAutoPack {
  if (group === "A") return "a";
  if (group === "B") return "b";
  return "c";
}

export function isConsultantAutoAllowed(
  prefs: Pick<
    ConsultantAutomationPrefs,
    | "group_a_enabled"
    | "group_b_enabled"
    | "group_c_enabled"
    | "pos_venda_auto_enabled"
    | "reminders_auto_enabled"
  > | null | undefined,
  pack: ConsultantAutoPack,
): boolean {
  if (!prefs) return false;
  switch (pack) {
    case "a":
      return !!prefs.group_a_enabled;
    case "b":
      return !!prefs.group_b_enabled;
    case "c":
      return !!prefs.group_c_enabled;
    case "pos_venda":
      return !!prefs.pos_venda_auto_enabled;
    case "reminders":
      return !!prefs.reminders_auto_enabled;
    default:
      return false;
  }
}

function normalizeRow(
  consultantId: string,
  row: Partial<ConsultantAutomationPrefs> | null | undefined,
): ConsultantAutomationPrefs {
  return {
    consultant_id: consultantId,
    group_a_enabled: !!row?.group_a_enabled,
    group_b_enabled: !!row?.group_b_enabled,
    group_c_enabled: !!row?.group_c_enabled,
    pos_venda_auto_enabled: !!row?.pos_venda_auto_enabled,
    pos_venda_auto_validate: !!row?.pos_venda_auto_validate,
    reminders_auto_enabled: !!row?.reminders_auto_enabled,
    acked_at: row?.acked_at ? String(row.acked_at) : null,
  };
}

export async function getConsultantAutomationPrefs(
  supabase: SB,
  consultantId: string | null | undefined,
): Promise<ConsultantAutomationPrefs | null> {
  if (!consultantId) return null;
  const now = Date.now();
  const hit = cache.get(consultantId);
  if (hit && hit.expires > now) return hit.value;

  const { data, error } = await supabase
    .from("consultant_automation_prefs")
    .select(
      "consultant_id, group_a_enabled, group_b_enabled, group_c_enabled, pos_venda_auto_enabled, pos_venda_auto_validate, reminders_auto_enabled, acked_at",
    )
    .eq("consultant_id", consultantId)
    .maybeSingle();

  if (error) {
    console.warn("[consultant-automation-prefs] load failed", error.message);
    // Fail-closed em erro de leitura (não dispara outreach sem confirmação).
    const closed = normalizeRow(consultantId, DEFAULT_CONSULTANT_AUTOMATION_PREFS);
    cache.set(consultantId, { value: closed, expires: now + TTL_MS });
    return closed;
  }

  const prefs = data
    ? normalizeRow(consultantId, data as ConsultantAutomationPrefs)
    : normalizeRow(consultantId, DEFAULT_CONSULTANT_AUTOMATION_PREFS);
  cache.set(consultantId, { value: prefs, expires: now + TTL_MS });
  return prefs;
}

/** Pré-carrega vários consultores (1 query) e popula cache. */
export async function preloadConsultantAutomationPrefs(
  supabase: SB,
  consultantIds: string[],
): Promise<Map<string, ConsultantAutomationPrefs>> {
  const out = new Map<string, ConsultantAutomationPrefs>();
  const ids = [...new Set(consultantIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from("consultant_automation_prefs")
    .select(
      "consultant_id, group_a_enabled, group_b_enabled, group_c_enabled, pos_venda_auto_enabled, pos_venda_auto_validate, reminders_auto_enabled, acked_at",
    )
    .in("consultant_id", ids);

  if (error) {
    console.warn("[consultant-automation-prefs] preload failed", error.message);
  }

  const byId = new Map<string, ConsultantAutomationPrefs>();
  for (const row of (data || []) as ConsultantAutomationPrefs[]) {
    byId.set(row.consultant_id, normalizeRow(row.consultant_id, row));
  }

  const now = Date.now();
  for (const id of ids) {
    const prefs = byId.get(id) ?? normalizeRow(id, DEFAULT_CONSULTANT_AUTOMATION_PREFS);
    out.set(id, prefs);
    cache.set(id, { value: prefs, expires: now + TTL_MS });
  }
  return out;
}

/** Só testes / invalidate após write. */
export function clearConsultantAutomationPrefsCache(consultantId?: string): void {
  if (consultantId) cache.delete(consultantId);
  else cache.clear();
}
