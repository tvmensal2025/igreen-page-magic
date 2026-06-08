// Super Admin inicia o pedido: cria sessão e notifica o consultor para autorizar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing auth" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "invalid user" }, 401);

    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: user.id });
    if (!isSuper) return json({ error: "forbidden" }, 403);

    const { requester_id } = await req.json();
    if (!requester_id) return json({ error: "requester_id required" }, 400);

    // Cancel previous pending for this requester
    await supabase
      .from("remote_support_sessions")
      .update({ status: "expired", ended_at: new Date().toISOString(), end_reason: "superseded" })
      .eq("requester_id", requester_id)
      .in("status", ["requested", "pending_code"]);

    const { data: session, error } = await supabase
      .from("remote_support_sessions")
      .insert({
        requester_id,
        operator_id: user.id,
        status: "requested",
        initiated_by: "operator",
      })
      .select()
      .single();
    if (error) throw error;

    await supabase.from("remote_support_logs").insert({
      session_id: session.id, actor: "operator", action: "operator_requested",
      payload: { operator_id: user.id },
    });

    return json({ session });
  } catch (e: any) {
    console.error("[remote-support-operator-request]", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
