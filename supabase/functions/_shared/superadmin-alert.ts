/**
 * Alerta operacional para o super-admin via Whapi (canal primário).
 * Dedup em infra_metrics (metric_key = ops_alert).
 *
 * INTENTIONAL: staff alert — bypasses anti-ban / quiet hours.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type OpsAlertSeverity = "warn" | "critical";

export interface OpsAlertOpts {
  /** Chave estável p/ dedup (ex.: velip_credit, worker:portal2). */
  key: string;
  severity: OpsAlertSeverity;
  text: string;
  /** Janela de dedup em minutos (default 60). */
  dedupMinutes?: number;
  /** metric_key em infra_metrics (default ops_alert). */
  metricKey?: string;
}

type SettingsRow = { key: string; value: string | null };

async function resolveWhapiAndPhone(
  supabase: SupabaseClient,
): Promise<{ token: string; baseUrl: string; phone: string } | null> {
  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["whapi_token", "whapi_api_url", "superadmin_consultant_id"]);

  const settings: Record<string, string> = {};
  for (const row of (settingsRows as SettingsRow[] | null) || []) {
    const k = String(row.key || "");
    const v = String(row.value || "").trim();
    if (k) settings[k] = v;
  }

  const token = settings.whapi_token || Deno.env.get("WHAPI_TOKEN") || "";
  if (!token) {
    console.warn("[superadmin-alert] whapi_token ausente");
    return null;
  }

  let phone = "";
  const saId = settings.superadmin_consultant_id || "";
  if (saId) {
    const { data: sa } = await supabase
      .from("consultants")
      .select("phone")
      .eq("id", saId)
      .maybeSingle();
    phone = String((sa as { phone?: string } | null)?.phone || "").replace(/\D/g, "");
  }
  if (!phone) {
    const { data: app } = await supabase
      .from("app_settings")
      .select("super_admin_phone")
      .eq("id", "global")
      .maybeSingle();
    phone = String((app as { super_admin_phone?: string } | null)?.super_admin_phone || "")
      .replace(/\D/g, "");
  }
  if (!phone) {
    console.warn("[superadmin-alert] super_admin_phone ausente");
    return null;
  }

  const digits = phone.startsWith("55") ? phone : `55${phone}`;
  const baseUrl = (settings.whapi_api_url || "https://gate.whapi.cloud").replace(/\/+$/, "");
  return { token, baseUrl, phone: digits };
}

/**
 * Envia alerta WA ao super-admin se não houver dedup recente.
 * Retorna: sent | skipped_dedup | skipped_config | failed
 */
export async function notifySuperAdminOpsAlert(
  supabase: SupabaseClient,
  opts: OpsAlertOpts,
): Promise<"sent" | "skipped_dedup" | "skipped_config" | "failed"> {
  const dedupMin = Math.max(5, opts.dedupMinutes ?? 60);
  const metricKey = opts.metricKey || "ops_alert";
  const dedupCutoff = new Date(Date.now() - dedupMin * 60_000).toISOString();

  const { data: recent } = await supabase
    .from("infra_metrics")
    .select("id")
    .eq("metric_key", metricKey)
    .gte("created_at", dedupCutoff)
    .contains("meta", { key: opts.key, severity: opts.severity })
    .limit(1);
  if (recent && recent.length > 0) return "skipped_dedup";

  const dest = await resolveWhapiAndPhone(supabase);
  if (!dest) {
    await supabase.from("infra_metrics").insert({
      metric_key: metricKey,
      value_num: null,
      meta: {
        key: opts.key,
        severity: opts.severity,
        text: opts.text,
        sent: false,
        reason: "config_missing",
      },
    });
    return "skipped_config";
  }

  const to = `${dest.phone}@s.whatsapp.net`;
  try {
    const res = await fetch(`${dest.baseUrl}/messages/text`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dest.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, body: opts.text, typing_time: 0 }),
    });
    const ok = res.ok;
    if (!ok) {
      const errText = (await res.text()).slice(0, 200);
      console.error("[superadmin-alert] whapi falhou:", res.status, errText);
    }
    await supabase.from("infra_metrics").insert({
      metric_key: metricKey,
      value_num: null,
      meta: {
        key: opts.key,
        severity: opts.severity,
        text: opts.text,
        sent: ok,
        status: res.status,
      },
    });
    return ok ? "sent" : "failed";
  } catch (e) {
    console.error("[superadmin-alert] envio falhou:", (e as Error).message);
    await supabase.from("infra_metrics").insert({
      metric_key: metricKey,
      value_num: null,
      meta: {
        key: opts.key,
        severity: opts.severity,
        text: opts.text,
        sent: false,
        reason: (e as Error).message,
      },
    });
    return "failed";
  }
}
