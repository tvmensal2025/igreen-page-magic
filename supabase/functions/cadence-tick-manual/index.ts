// Disparo manual do cadence-tick por usuário administrativo.
// O JWT fica no browser; a credencial de serviço usada no hop interno existe
// somente no runtime da Edge Function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { buildCors } from "../_shared/cors.ts";

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRole) {
    return json({ error: "service_not_configured" }, 500, cors);
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) {
    return new Response(caller.body, {
      status: caller.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (caller.mode !== "jwt") return json({ error: "forbidden" }, 403, cors);

  const { data: roles, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", caller.consultantId)
    .in("role", ["admin", "super_admin"])
    .limit(1);
  if (roleError) {
    console.warn("[cadence-tick-manual] role_check_failed", roleError.message);
    return json({ error: "role_check_failed" }, 500, cors);
  }
  if (!roles?.length) return json({ error: "forbidden" }, 403, cors);

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/cadence-tick`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRole}`,
        apikey: serviceRole,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "cadence-tick-manual",
        requested_by: caller.consultantId,
      }),
    });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: "invalid_internal_response" };
    }
    return json(payload, response.status, cors);
  } catch (error) {
    console.error("[cadence-tick-manual] internal_call_failed", error);
    return json({ error: "cadence_tick_unavailable" }, 502, cors);
  }
});
