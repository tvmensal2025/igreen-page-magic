// Carrega credenciais de canal (Whapi + Evolution) a partir de settings + env.
// Super admin usa settings.whapi_token; consultores usam Evolution do ambiente.

import type { ChannelEnv } from "./channel-sender.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export async function loadChannelEnv(supabase: SB): Promise<ChannelEnv & {
  superadminConsultantId: string | null;
}> {
  const { data: rows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["whapi_token", "whapi_api_url", "superadmin_consultant_id"]);

  const settings: Record<string, string> = {};
  for (const r of (rows as Array<{ key: string; value: unknown }> | null) || []) {
    const raw = r.value;
    settings[r.key] = typeof raw === "string" ? raw : String(raw ?? "");
  }

  return {
    evolutionUrl: Deno.env.get("EVOLUTION_API_URL"),
    evolutionKey: Deno.env.get("EVOLUTION_API_KEY"),
    whapiToken: settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "",
    superadminConsultantId: settings.superadmin_consultant_id || null,
  };
}

export function isSuperAdminConsultant(
  consultantId: string,
  superadminConsultantId: string | null,
): boolean {
  return !!superadminConsultantId && String(superadminConsultantId) === String(consultantId);
}

/**
 * Lê apenas `settings.superadmin_consultant_id` (dono do Whapi).
 * Usado por edges que montam ChannelEnv manualmente — sem isso a trava
 * "Whapi é só do superadmin" ficava fail-open.
 */
export async function loadSuperadminConsultantId(supabase: SB): Promise<string | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "superadmin_consultant_id")
    .maybeSingle();
  const raw = (data as { value?: unknown } | null)?.value;
  const val = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  return val.replace(/^"|"$/g, "") || null;
}
