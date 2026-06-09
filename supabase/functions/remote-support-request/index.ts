import { buildCors } from "../_shared/cors.ts";
import { rs, callerIp } from "../_shared/remote-support.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const ctx = await rs.context(req, cors, "remote-support-request");
    if (ctx instanceof Response) return ctx;
    const { admin, user, json } = ctx;

    // Cancela pedidos pendentes anteriores deste consultor.
    await admin
      .from("remote_support_sessions")
      .update({ status: "expired", ended_at: new Date().toISOString(), end_reason: "superseded" })
      .eq("requester_id", user.id)
      .in("status", ["requested", "pending_code"]);

    const { data: session, error } = await admin
      .from("remote_support_sessions")
      .insert({
        requester_id: user.id,
        status: "requested",
        initiated_by: "requester",
        ip_requester: callerIp(req),
      })
      .select()
      .single();
    if (error) throw error;

    await admin.from("remote_support_logs").insert({
      session_id: session.id,
      actor: "requester",
      action: "session_requested",
      payload: { user_id: user.id },
    });

    return json({ session });
  } catch (e) {
    console.error("[remote-support-request]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
