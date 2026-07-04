/**
 * whapi-history-status
 * GET simples para o frontend consultar progresso do backfill.
 * Sem restrição de super admin — só retorna estatística/estado, sem dados sensíveis.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await admin
      .from("settings")
      .select("value")
      .eq("key", "whapi_backfill_status")
      .maybeSingle();
    let payload: any = null;
    try {
      payload = data?.value ? JSON.parse(data.value) : null;
    } catch { payload = null; }
    return new Response(
      JSON.stringify({ ok: true, status: payload }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
