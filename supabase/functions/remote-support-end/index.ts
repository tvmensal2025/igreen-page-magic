import { buildCors } from "../_shared/cors.ts";
import { rs } from "../_shared/remote-support.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const ctx = await rs.context(req, cors, "remote-support-end");
    if (ctx instanceof Response) return ctx;
    const { admin, user, json } = ctx;

    const { session_id, reason } = await req.json();
    if (!session_id) return json({ error: "session_id required" }, 400);

    const { data: session } = await admin
      .from("remote_support_sessions").select("*").eq("id", session_id).single();
    if (!session) return json({ error: "not found" }, 404);

    const isSuper = await rs.isSuperAdmin(admin, user.id);
    const isParticipant = session.requester_id === user.id || session.operator_id === user.id || isSuper;
    if (!isParticipant) return json({ error: "forbidden" }, 403);

    await admin.from("remote_support_sessions").update({
      status: "ended",
      ended_at: new Date().toISOString(),
      end_reason: reason || (session.requester_id === user.id ? "requester_ended" : "operator_ended"),
    }).eq("id", session_id);

    await admin.from("remote_support_logs").insert({
      session_id,
      actor: session.requester_id === user.id ? "requester" : "operator",
      action: "session_ended",
      payload: { reason },
    });

    return json({ ok: true });
  } catch (e) {
    console.error("[remote-support-end]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
