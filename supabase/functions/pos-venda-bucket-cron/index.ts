import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureError } from "../_shared/audit.ts";
import { assertCronAuth, cronAuthUnauthorized } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-service-secret, x-internal-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cronAuth = await assertCronAuth(req, supabase as any);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

    const { data, error } = await supabase.rpc("recompute_pos_venda_stages" as any);

    return new Response(
      JSON.stringify({ ok: !error, updated: data ?? 0, error: error?.message ?? null }),
      { status: error ? 500 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    captureError(err, { tags: { function: "pos-venda-bucket-cron" } });
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
