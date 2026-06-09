// Super Admin inicia o pedido: cria sessão e notifica o consultor para autorizar.
import { buildCors } from "../_shared/cors.ts";
import { rs } from "../_shared/remote-support.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const ctx = await rs.context(req, cors, "remote-support-operator-request");
    if (ctx instanceof Response) return ctx;
    const { admin, user, json } = ctx;

    if (!(await rs.isSuperAdmin(admin, user.id))) return json({ error: "forbidden" }, 403);

    const { requester_id } = await req.json();
    if (!requester_id) return json({ error: "requester_id required" }, 400);

    // Cancela pendentes anteriores deste consultor.
    await admin
      .from("remote_support_sessions")
      .update({ status: "expired", ended_at: new Date().toISOString(), end_reason: "superseded" })
      .eq("requester_id", requester_id)
      .in("status", ["requested", "pending_code"]);

    const { data: session, error } = await admin
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

    await admin.from("remote_support_logs").insert({
      session_id: session.id, actor: "operator", action: "operator_requested",
      payload: { operator_id: user.id },
    });

    return json({ session });
  } catch (e) {
    console.error("[remote-support-operator-request]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
