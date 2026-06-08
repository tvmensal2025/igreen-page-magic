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

    const { session_id } = await req.json();
    if (!session_id) return json({ error: "session_id required" }, 400);

    const { data: session, error: serr } = await supabase
      .from("remote_support_sessions")
      .select("*")
      .eq("id", session_id)
      .single();
    if (serr || !session) return json({ error: "session not found" }, 404);
    if (!["requested", "pending_code"].includes(session.status)) {
      return json({ error: `session in status ${session.status}` }, 400);
    }

    // Autorização:
    //  - Sessão iniciada pelo requester: apenas Super Admin pode aceitar (vira operador).
    //  - Sessão iniciada pelo operador: o próprio requester autoriza (consultor clica autorizar)
    //    OU um Super Admin pode aceitar em seu lugar.
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: user.id });
    const isRequesterAuthorizing =
      session.initiated_by === "operator" && session.requester_id === user.id;
    if (!isSuper && !isRequesterAuthorizing) {
      return json({ error: "forbidden" }, 403);
    }

    const code = genCode();
    const codeHash = await sha256(code);
    const rotatesAt = new Date(Date.now() + 60_000).toISOString();

    // Invalidate previous codes
    await supabase
      .from("remote_support_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("session_id", session_id)
      .is("consumed_at", null);

    await supabase.from("remote_support_codes").insert({
      session_id,
      code_hash: codeHash,
      rotates_at: rotatesAt,
    });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

    // Operator_id: se Super Admin aceitou, ele vira operator; se requester autorizou
    // sessão iniciada pelo operador, preserva o operator_id que já está na sessão.
    const updatePayload: Record<string, unknown> = { status: "pending_code" };
    if (isSuper) {
      updatePayload.operator_id = user.id;
      updatePayload.ip_operator = ip;
    }
    await supabase
      .from("remote_support_sessions")
      .update(updatePayload)
      .eq("id", session_id);

    await supabase.from("remote_support_logs").insert({
      session_id,
      actor: isRequesterAuthorizing ? "requester" : "operator",
      action: isRequesterAuthorizing ? "requester_authorized" : "operator_accepted",
      payload: { user_id: user.id },
    });

    // Broadcast code to the requester via realtime HTTP API (no subscribe needed)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    try {
      await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          messages: [{
            topic: `support:${session_id}:code`,
            event: "new_code",
            payload: { code, rotates_at: rotatesAt },
          }],
        }),
      });
    } catch (e) {
      console.warn("[remote-support-accept] broadcast failed", e);
    }

    // Retorna code também na resposta — útil quando o requester é quem autoriza
    // (ele já está autenticado como dono da sessão, então pode ver o code).
    return json({ ok: true, rotates_at: rotatesAt, code: isRequesterAuthorizing ? code : undefined });
  } catch (e: any) {
    console.error("[remote-support-accept]", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
