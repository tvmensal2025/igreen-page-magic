// Universal kill switch for automated functions.
// Every edge function that SENDS something (WhatsApp, SMS, call, Meta sync)
// must call `isAutomationEnabled(supabase, key)` before dispatching.
//
// Default is FALSE (off). Admins turn it on in /admin/agendamentos-central.

// deno-lint-ignore no-explicit-any
type SB = any;

const cache = new Map<string, { value: boolean; expires: number }>();
const TTL_MS = 15_000;

export async function isAutomationEnabled(
  supabase: SB,
  key: string,
): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.value;

  const { data, error } = await supabase
    .from("automation_toggles")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();

  const value = !!(data as { enabled?: boolean } | null)?.enabled && !error;
  cache.set(key, { value, expires: now + TTL_MS });
  return value;
}

export async function logSkipped(
  supabase: SB,
  key: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  // Log estruturado sempre sai (visível em Logs da função).
  try {
    console.log(JSON.stringify({ level: "info", event: "automation_skipped_toggle_off", key, ...meta }));
  } catch { /* noop */ }
  // Persistência: tabela própria automation_skip_log. (A versão anterior
  // inseria em cadence_action_log com colunas inexistentes/enum inválido e
  // falhava silenciosamente em todas as chamadas.)
  try {
    const { error } = await supabase.from("automation_skip_log").insert({ key, meta });
    if (error) console.warn(`[automation-gate] skip log falhou: ${error.message}`);
  } catch {
    /* best-effort: nunca bloqueia o fluxo principal */
  }
}
