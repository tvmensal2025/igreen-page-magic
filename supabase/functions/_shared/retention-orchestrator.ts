/**
 * Orquestrador de retenção — impede vários crons de cutucar o mesmo lead.
 *
 * Com toggle `retention_orchestrator` OFF (default): sempre permite (comportamento legado).
 * Com ON: respeita cooldown + prioridade em `retention_settings`.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { isAutomationEnabled, logSkipped } from "./automation-gate.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type RetentionSettings = {
  speed_to_lead_minutes: number;
  orchestrator_cooldown_hours: number;
  priority_order: string[];
  portal_abandon_hours: number;
  call_answered_pause_hours: number;
};

const DEFAULTS: RetentionSettings = {
  speed_to_lead_minutes: 5,
  orchestrator_cooldown_hours: 6,
  priority_order: [
    "process_followups",
    "bot_stuck_recovery",
    "faq_reengagement_nudge",
    "bot_followup_checker",
    "cadence_engine",
    "reactivation_cron",
    "portal_abandon_sequence",
  ],
  portal_abandon_hours: 2,
  call_answered_pause_hours: 24,
};

let settingsCache: { value: RetentionSettings; expires: number } | null = null;
const SETTINGS_TTL_MS = 30_000;

export async function loadRetentionSettings(supabase: SB): Promise<RetentionSettings> {
  const now = Date.now();
  if (settingsCache && settingsCache.expires > now) return settingsCache.value;

  const { data } = await supabase
    .from("retention_settings")
    .select("*")
    .eq("id", "global")
    .maybeSingle();

  const row = data as Partial<RetentionSettings> | null;
  const priority = Array.isArray(row?.priority_order)
    ? (row!.priority_order as string[])
    : DEFAULTS.priority_order;

  const value: RetentionSettings = {
    speed_to_lead_minutes: Number(row?.speed_to_lead_minutes) || DEFAULTS.speed_to_lead_minutes,
    orchestrator_cooldown_hours: Number(row?.orchestrator_cooldown_hours) || DEFAULTS.orchestrator_cooldown_hours,
    priority_order: priority.length ? priority : DEFAULTS.priority_order,
    portal_abandon_hours: Number(row?.portal_abandon_hours) || DEFAULTS.portal_abandon_hours,
    call_answered_pause_hours: Number(row?.call_answered_pause_hours) || DEFAULTS.call_answered_pause_hours,
  };
  settingsCache = { value, expires: now + SETTINGS_TTL_MS };
  return value;
}

function priorityIndex(order: string[], key: string): number {
  const i = order.indexOf(key);
  return i >= 0 ? i : 999;
}

/**
 * Pode este source tocar o lead agora?
 * - Orchestrator OFF → true
 * - Sem toque recente no cooldown → true
 * - Toque recente de prioridade maior/igual → false (exceto o mesmo source em retry curto)
 */
export async function canProactiveTouch(
  supabase: SB,
  customerId: string,
  sourceKey: string,
): Promise<{ allowed: boolean; reason?: string; blockedBy?: string }> {
  if (!(await isAutomationEnabled(supabase, "retention_orchestrator"))) {
    return { allowed: true, reason: "orchestrator_off" };
  }

  const settings = await loadRetentionSettings(supabase);
  const since = new Date(
    Date.now() - settings.orchestrator_cooldown_hours * 3600_000,
  ).toISOString();

  const { data: recent } = await supabase
    .from("proactive_touch_log")
    .select("source_key, created_at")
    .eq("customer_id", customerId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);

  const rows = (recent || []) as { source_key: string; created_at: string }[];
  if (rows.length === 0) return { allowed: true };

  const myPri = priorityIndex(settings.priority_order, sourceKey);
  for (const r of rows) {
    if (r.source_key === sourceKey) continue; // mesmo source pode seguir (cron próprio)
    const otherPri = priorityIndex(settings.priority_order, r.source_key);
    if (otherPri <= myPri) {
      return {
        allowed: false,
        reason: "blocked_by_higher_or_equal_priority",
        blockedBy: r.source_key,
      };
    }
  }
  return { allowed: true };
}

export async function recordProactiveTouch(
  supabase: SB,
  customerId: string,
  sourceKey: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from("proactive_touch_log").insert({
      customer_id: customerId,
      source_key: sourceKey,
      meta,
    });
  } catch (err) {
    console.warn("[retention-orchestrator] recordProactiveTouch failed", err);
  }
}

/** Helper: checa + se negar, loga skip. */
export async function gateProactiveTouch(
  supabase: SB,
  customerId: string,
  sourceKey: string,
): Promise<boolean> {
  const r = await canProactiveTouch(supabase, customerId, sourceKey);
  if (!r.allowed) {
    await logSkipped(supabase, "retention_orchestrator", {
      customer_id: customerId,
      source: sourceKey,
      blocked_by: r.blockedBy,
      reason: r.reason,
    });
    return false;
  }
  return true;
}

/** Usado em testes unitários sem Deno/Supabase. */
export function decideProactiveTouchPure(
  settings: RetentionSettings,
  orchestratorEnabled: boolean,
  recentSources: string[],
  sourceKey: string,
): { allowed: boolean; blockedBy?: string } {
  if (!orchestratorEnabled) return { allowed: true };
  if (recentSources.length === 0) return { allowed: true };
  const myPri = priorityIndex(settings.priority_order, sourceKey);
  for (const other of recentSources) {
    if (other === sourceKey) continue;
    if (priorityIndex(settings.priority_order, other) <= myPri) {
      return { allowed: false, blockedBy: other };
    }
  }
  return { allowed: true };
}

export type { SupabaseClient };
