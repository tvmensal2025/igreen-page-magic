/**
 * instance-health-cron
 * Roda a cada ~1h. Verifica instâncias Evolution e notifica quando
 * uma instância de consultor ativo está desconectada há mais de 15 min.
 *
 * Whapi (superadmin): NÃO alerta por whatsapp_instances.needs_reconnect —
 * o Zap real é Whapi AUTH, não a linha Evolution legada.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = Date.now();
  const alerts: any[] = [];
  const errors: any[] = [];
  let skippedWhapi = 0;

  try {
    const { data: settingsRows } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["superadmin_consultant_id", "whapi_token"]);
    const settings: Record<string, string> = {};
    for (const r of (settingsRows || []) as Array<{ key: string; value: unknown }>) {
      settings[r.key] = typeof r.value === "string" ? r.value : String(r.value ?? "");
    }
    const superId = (settings.superadmin_consultant_id || "").replace(/^"|"$/g, "").trim();
    const hasWhapi = !!(settings.whapi_token || Deno.env.get("WHAPI_TOKEN"));

    const { data: instances } = await supabase
      .from("whatsapp_instances")
      .select("id, consultant_id, instance_name, status, last_health_check_at, updated_at");

    const cutoff = Date.now() - 15 * 60 * 1000;

    for (const inst of (instances || []) as any[]) {
      // Superadmin Whapi: Evolution needs_reconnect NÃO significa Zap offline.
      if (hasWhapi && superId && String(inst.consultant_id) === superId) {
        skippedWhapi++;
        continue;
      }
      // Instância com nome whapi* não é Evolution health.
      if (String(inst.instance_name || "").toLowerCase().startsWith("whapi")) {
        skippedWhapi++;
        continue;
      }

      const lastSeen = new Date(inst.last_health_check_at || inst.updated_at || 0).getTime();
      const disconnected = inst.status !== "connected" && inst.status !== "open" && inst.status !== "online";
      const stale = lastSeen < cutoff;
      if (!disconnected && !stale) continue;

      const { data: c } = await supabase
        .from("consultants")
        .select("name, notification_phone, approved")
        .eq("id", inst.consultant_id)
        .maybeSingle();

      if (!c?.approved) continue;

      // Throttle: 1 alerta por instância a cada 60 min
      const since60 = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("production_health_snapshot")
        .select("id")
        .eq("consultant_id", inst.consultant_id)
        .gte("captured_at", since60)
        .contains("errors", [{ kind: "instance_down" }])
        .limit(1);

      if (recent && recent.length > 0) continue;

      await supabase.from("production_health_snapshot").insert({
        consultant_id: inst.consultant_id,
        captured_at: new Date().toISOString(),
        instance_status: inst.status || "unknown",
        instance_last_seen: inst.last_health_check_at || inst.updated_at,
        pixel_ok: false,
        capi_ok: false,
        flows_ok: false,
        flows_missing: [],
        active_variants: [],
        notification_phone_ok: !!c?.notification_phone,
        last_lead_at: null,
        leads_24h: 0,
        errors: [{ kind: "instance_down", instance_name: inst.instance_name, status: inst.status }],
      });

      alerts.push({ consultant_id: inst.consultant_id, name: c?.name, status: inst.status });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        alerts,
        errors,
        skipped_whapi: skippedWhapi,
        duration_ms: Date.now() - startedAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
