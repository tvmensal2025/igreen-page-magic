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

    const { session_id, reason } = await req.json();
    if (!session_id) return json({ error: "session_id required" }, 400);

    const { data: session } = await supabase
      .from("remote_support_sessions").select("*").eq("id", session_id).single();
    if (!session) return json({ error: "not found" }, 404);

    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: user.id });
    const isParticipant = session.requester_id === user.id || session.operator_id === user.id || isSuper;
    if (!isParticipant) return json({ error: "forbidden" }, 403);

    await supabase.from("remote_support_sessions").update({
      status: "ended",
      ended_at: new Date().toISOString(),
      end_reason: reason || (session.requester_id === user.id ? "requester_ended" : "operator_ended"),
    }).eq("id", session_id);

    await supabase.from("remote_support_logs").insert({
      session_id,
      actor: session.requester_id === user.id ? "requester" : "operator",
      action: "session_ended",
      payload: { reason },
    });

    return json({ ok: true });
  } catch (e: any) {
    console.error("[remote-support-end]", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
