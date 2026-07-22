/**
 * production-health-snapshot
 * Roda a cada 5 min (cron) e popula production_health_snapshot
 * com o estado atual de cada consultor ativo.
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
  let written = 0;
  const errors: any[] = [];

  try {
    const { data: consultants } = await supabase
      .from("consultants")
      .select("id, name, active_variants, facebook_pixel_id, notification_phone")
      .eq("approved", true);

    if (!consultants?.length) {
      return new Response(JSON.stringify({ ok: true, written: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Canal ativo do super admin = Whapi (não Evolution). Evita falso "needs_reconnect".
    const { data: settingsRows } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["superadmin_consultant_id", "whapi_token"]);
    const settingsMap: Record<string, string> = {};
    for (const row of settingsRows || []) {
      const k = String((row as { key?: string }).key || "");
      const v = String((row as { value?: string }).value || "").trim();
      if (k) settingsMap[k] = v;
    }
    const superadminId = settingsMap.superadmin_consultant_id || "";
    const whapiConfigured = !!settingsMap.whapi_token;

    for (const c of consultants as any[]) {
      try {
        // Instância (Evolution legado — pode estar needs_reconnect mesmo com Whapi ok)
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("status, last_health_check_at, updated_at, connected_phone")
          .eq("consultant_id", c.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Fluxos por variante
        const variants: string[] = Array.isArray(c.active_variants) && c.active_variants.length
          ? c.active_variants.map((v: string) => String(v).toUpperCase())
          : ["A"];
        const { data: flows } = await supabase
          .from("bot_flows")
          .select("variant, is_active")
          .eq("consultant_id", c.id)
          .eq("is_active", true);
        const haveVariants = new Set((flows || []).map((f: any) => String(f.variant).toUpperCase()));
        const missing = variants.filter((v) => !haveVariants.has(v));

        // CAPI: tem facebook_connections válido?
        const { data: fbConn } = await supabase
          .from("facebook_connections")
          .select("access_token_encrypted, token_expires_at, status")
          .eq("consultant_id", c.id)
          .maybeSingle();
        const capiOk = !!(fbConn?.access_token_encrypted && fbConn.status === 'active' && (!fbConn.token_expires_at || new Date(fbConn.token_expires_at) > new Date()));

        // Leads
        const { count: leads24 } = await supabase
          .from("customers")
          .select("*", { count: "exact", head: true })
          .eq("consultant_id", c.id)
          .gte("created_at", since24h);

        const { data: lastLead } = await supabase
          .from("customers")
          .select("created_at")
          .eq("consultant_id", c.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const isWhapiConsultant = !!superadminId && c.id === superadminId && whapiConfigured;
        const evolutionStatus = inst?.status || "unknown";
        // Fonte da verdade de envio do super admin = Whapi; Evolution offline não é queda do Zap.
        const instanceStatus = isWhapiConsultant ? "connected" : evolutionStatus;
        const snapErrors: Array<{ code: string; detail?: string }> = [];
        if (isWhapiConsultant && evolutionStatus && evolutionStatus !== "connected") {
          snapErrors.push({
            code: "evolution_stale_whapi_primary",
            detail: `Evolution=${evolutionStatus}; canal ativo=Whapi`,
          });
        }

        const snapshot = {
          consultant_id: c.id,
          captured_at: new Date().toISOString(),
          instance_status: instanceStatus,
          instance_last_seen: inst?.last_health_check_at || inst?.updated_at || null,
          pixel_ok: !!c.facebook_pixel_id,
          capi_ok: capiOk,
          flows_ok: missing.length === 0,
          flows_missing: missing,
          active_variants: variants,
          notification_phone_ok: !!c.notification_phone,
          last_lead_at: lastLead?.created_at || null,
          leads_24h: leads24 || 0,
          errors: snapErrors,
        };

        const { error } = await supabase.from("production_health_snapshot").insert(snapshot);
        if (error) errors.push({ consultant_id: c.id, error: error.message });
        else written++;
      } catch (e) {
        errors.push({ consultant_id: c.id, error: (e as Error).message });
      }
    }

    // Limpa snapshots antigos (>7 dias)
    await supabase
      .from("production_health_snapshot")
      .delete()
      .lt("captured_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    return new Response(
      JSON.stringify({ ok: true, written, errors, duration_ms: Date.now() - startedAt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message, written, errors }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
