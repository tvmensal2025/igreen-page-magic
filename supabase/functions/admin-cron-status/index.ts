// Central de Agendamentos — lista jobs pg_cron + últimas execuções.
// GET  → { jobs: [...], runs: {...} }
// POST { action: "run", job_name } → executa a query do job imediatamente
// POST { action: "toggle", job_name, active } → ativa/desativa
// POST { action: "reschedule", job_name, schedule } → altera cron expression
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveCaller } from "../_shared/caller-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-service-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;
  if (caller.mode !== "service" && !caller.isAdmin) {
    return new Response(JSON.stringify({ error: "admin_only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (req.method === "GET") {
      const { data: jobs, error: jErr } = await admin.rpc("admin_cron_list");
      if (jErr) throw jErr;
      const { data: runs, error: rErr } = await admin.rpc("admin_cron_last_runs");
      if (rErr) throw rErr;
      return new Response(JSON.stringify({ jobs: jobs ?? [], runs: runs ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const jobName = String(body.job_name || "");

    if (!jobName) throw new Error("job_name required");

    if (action === "run") {
      const { data, error } = await admin.rpc("admin_cron_run_now", { p_job_name: jobName });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, result: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "toggle") {
      const { error } = await admin.rpc("admin_cron_toggle", {
        p_job_name: jobName, p_active: !!body.active,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "reschedule") {
      const { error } = await admin.rpc("admin_cron_reschedule", {
        p_job_name: jobName, p_schedule: String(body.schedule || ""),
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("unknown_action");
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
