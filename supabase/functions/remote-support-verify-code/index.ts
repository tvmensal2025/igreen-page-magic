import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

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
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) return json({ error: "invalid user" }, 401);

    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: user.id });
    if (!isSuper) return json({ error: "forbidden" }, 403);

    const { session_id, code } = await req.json();
    if (!session_id || !code) return json({ error: "missing params" }, 400);

    const { data: session } = await supabase
      .from("remote_support_sessions").select("*").eq("id", session_id).single();
    if (!session) return json({ error: "session not found" }, 404);
    if (session.status !== "pending_code") return json({ error: "not pending code" }, 400);

    const { data: codeRow } = await supabase
      .from("remote_support_codes")
      .select("*")
      .eq("session_id", session_id)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!codeRow) return json({ error: "no active code" }, 400);
    if (new Date(codeRow.rotates_at).getTime() < Date.now()) {
      return json({ error: "code expired" }, 400);
    }
    if (codeRow.attempts >= codeRow.max_attempts) {
      await supabase.from("remote_support_sessions").update({
        status: "rejected", ended_at: new Date().toISOString(), end_reason: "max_attempts",
      }).eq("id", session_id);
      return json({ error: "max attempts reached" }, 429);
    }

    const inputHash = await sha256(String(code));
    if (inputHash !== codeRow.code_hash) {
      await supabase.from("remote_support_codes")
        .update({ attempts: codeRow.attempts + 1 }).eq("id", codeRow.id);
      await supabase.from("remote_support_logs").insert({
        session_id, actor: "operator", action: "code_failed",
        payload: { attempts: codeRow.attempts + 1 },
      });
      return json({ error: "invalid code", attempts_left: codeRow.max_attempts - codeRow.attempts - 1 }, 400);
    }

    await supabase.from("remote_support_codes").update({
      consumed_at: new Date().toISOString(),
    }).eq("id", codeRow.id);

    await supabase.from("remote_support_sessions").update({
      status: "active", started_at: new Date().toISOString(),
    }).eq("id", session_id);

    await supabase.from("remote_support_logs").insert({
      session_id, actor: "system", action: "session_active",
    });

    return json({ ok: true });
  } catch (e: any) {
    console.error("[remote-support-verify-code]", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
