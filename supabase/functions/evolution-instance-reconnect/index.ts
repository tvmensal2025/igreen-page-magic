// Reconnect a degraded WhatsApp instance: logout (force) + connect (returns new QR).
// Used by the admin UI when delivery is failing with ERROR acks.
//
// Flow:
//   1. Authenticate the caller and verify they own (or admin) the instance.
//   2. Optionally call /instance/logout/{name} to drop the dead Baileys session.
//   3. Call /instance/connect/{name} to obtain a fresh pairing code / QR.
//   4. Clear `consecutive` risk signals and `recovery_mode_until` so the next
//      successful connection isn't blocked by stale circuit breaker state.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

interface ReconnectBody {
  instanceName: string;
  forceLogout?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return json({ error: "Evolution API not configured" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_auth" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => ({}))) as Partial<ReconnectBody>;
    const instanceName = String(body?.instanceName || "").trim();
    if (!instanceName) return json({ error: "instanceName_required" }, 400);

    // Ownership check (consultant owns instance OR user is super-admin)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: inst } = await admin
      .from("whatsapp_instances")
      .select("id, instance_name, consultant_id")
      .eq("instance_name", instanceName)
      .maybeSingle();
    if (!inst) return json({ error: "instance_not_found" }, 404);

    const owns = inst.consultant_id === user.id;
    let isAdmin = false;
    if (!owns) {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "super_admin"])
        .maybeSingle();
      isAdmin = !!roleRow;
    }
    if (!owns && !isAdmin) return json({ error: "forbidden" }, 403);

    const headers = { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY };

    // Step 1: logout (best-effort) — drops the dead Baileys session.
    let loggedOut = false;
    if (body?.forceLogout !== false) {
      try {
        const r = await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
          method: "DELETE", headers,
        });
        loggedOut = r.ok;
        await r.text(); // consume
      } catch (_) { /* swallow */ }
    }

    // Step 2: connect — returns base64 QR + pairingCode.
    let qrPayload: any = null;
    try {
      const r = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
        method: "GET", headers,
      });
      qrPayload = await r.json().catch(() => null);
      if (!r.ok) {
        return json({ error: "evolution_connect_failed", status: r.status, body: qrPayload }, 502);
      }
    } catch (e: any) {
      return json({ error: "evolution_connect_exception", message: e?.message }, 502);
    }

    // Step 3: clear stale recovery state so a successful reconnect isn't blocked.
    try { await admin.rpc("clear_recovery_mode", { p_instance: instanceName }); } catch (_) { /* swallow */ }
    try {
      await admin
        .from("instance_risk_signals")
        .delete()
        .eq("instance_name", instanceName)
        .in("signal_type", ["send_failure", "disconnect_transient"]);
    } catch (_) { /* swallow */ }

    return json({
      ok: true,
      logged_out: loggedOut,
      qr_base64: qrPayload?.base64 ?? qrPayload?.qrcode?.base64 ?? null,
      pairing_code: qrPayload?.pairingCode ?? qrPayload?.code ?? null,
      raw: qrPayload,
    });
  } catch (err: any) {
    console.error("[evolution-instance-reconnect] error:", err);
    return json({ error: String(err?.message || err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
