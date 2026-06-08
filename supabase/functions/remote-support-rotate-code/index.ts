import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function genCode(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const n = (buf[0] << 24 | buf[1] << 16 | buf[2] << 8 | buf[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}
async function sha256(s: string) {
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

    const { session_id } = await req.json();
    if (!session_id) return json({ error: "session_id required" }, 400);

    const { data: session } = await supabase
      .from("remote_support_sessions").select("*").eq("id", session_id).single();
    if (!session) return json({ error: "not found" }, 404);
    if (session.requester_id !== user.id) return json({ error: "forbidden" }, 403);
    if (session.status !== "pending_code") return json({ error: "not pending" }, 400);

    const code = genCode();
    const codeHash = await sha256(code);
    const rotatesAt = new Date(Date.now() + 60_000).toISOString();

    await supabase.from("remote_support_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("session_id", session_id).is("consumed_at", null);

    await supabase.from("remote_support_codes").insert({
      session_id, code_hash: codeHash, rotates_at: rotatesAt,
    });

    return json({ code, rotates_at: rotatesAt });
  } catch (e: any) {
    console.error("[remote-support-rotate-code]", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
