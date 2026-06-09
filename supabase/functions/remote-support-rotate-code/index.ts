import { buildCors } from "../_shared/cors.ts";
import { rs, genCode, sha256, CODE_TTL_MS } from "../_shared/remote-support.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const ctx = await rs.context(req, cors, "remote-support-rotate-code");
    if (ctx instanceof Response) return ctx;
    const { admin, user, json } = ctx;

    const { session_id } = await req.json();
    if (!session_id) return json({ error: "session_id required" }, 400);

    const { data: session } = await admin
      .from("remote_support_sessions").select("*").eq("id", session_id).single();
    if (!session) return json({ error: "not found" }, 404);
    if (session.requester_id !== user.id) return json({ error: "forbidden" }, 403);
    if (session.status !== "pending_code") return json({ error: "not pending" }, 400);

    const code = genCode();
    const codeHash = await sha256(code);
    const rotatesAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    await admin.from("remote_support_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("session_id", session_id).is("consumed_at", null);

    await admin.from("remote_support_codes").insert({
      session_id, code_hash: codeHash, rotates_at: rotatesAt,
    });

    return json({ code, rotates_at: rotatesAt });
  } catch (e) {
    console.error("[remote-support-rotate-code]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
