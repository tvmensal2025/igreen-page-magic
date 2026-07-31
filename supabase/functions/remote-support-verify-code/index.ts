import { buildCors } from "../_shared/cors.ts";
import { rs, sha256, SESSION_MAX_DURATION_MS } from "../_shared/remote-support.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const ctx = await rs.context(req, cors, "remote-support-verify-code");
    if (ctx instanceof Response) return ctx;
    const { admin, user, json } = ctx;

    if (!(await rs.isSuperAdmin(admin, user.id))) return json({ error: "forbidden" }, 403);

    const { session_id, code } = await req.json();
    if (!session_id || !code) return json({ error: "missing params" }, 400);

    const { data: session } = await admin
      .from("remote_support_sessions").select("*").eq("id", session_id).single();
    if (!session) return json({ error: "session not found" }, 404);
    if (session.status !== "pending_code") return json({ error: "not pending code" }, 400);

    const createdMs = new Date(session.created_at).getTime();
    if (Number.isFinite(createdMs) && Date.now() - createdMs > SESSION_MAX_DURATION_MS) {
      await admin.from("remote_support_sessions").update({
        status: "ended",
        ended_at: new Date().toISOString(),
        end_reason: "max_duration",
      }).eq("id", session_id);
      await admin.from("remote_support_logs").insert({
        session_id, actor: "system", action: "session_expired",
        payload: { reason: "max_duration_before_verify" },
      });
      return json({ error: "session expired" }, 410);
    }

    const { data: codeRow } = await admin
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
      await admin.from("remote_support_sessions").update({
        status: "rejected", ended_at: new Date().toISOString(), end_reason: "max_attempts",
      }).eq("id", session_id);
      return json({ error: "max attempts reached" }, 429);
    }

    const inputHash = await sha256(String(code));
    if (inputHash !== codeRow.code_hash) {
      await admin.from("remote_support_codes")
        .update({ attempts: codeRow.attempts + 1 }).eq("id", codeRow.id);
      await admin.from("remote_support_logs").insert({
        session_id, actor: "operator", action: "code_failed",
        payload: { attempts: codeRow.attempts + 1 },
      });
      return json({ error: "invalid code", attempts_left: codeRow.max_attempts - codeRow.attempts - 1 }, 400);
    }

    await admin.from("remote_support_codes").update({
      consumed_at: new Date().toISOString(),
    }).eq("id", codeRow.id);

    await admin.from("remote_support_sessions").update({
      status: "active", started_at: new Date().toISOString(),
    }).eq("id", session_id);

    await admin.from("remote_support_logs").insert({
      session_id, actor: "system", action: "session_active",
    });

    return json({ ok: true });
  } catch (e) {
    console.error("[remote-support-verify-code]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
