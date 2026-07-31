import { buildCors } from "../_shared/cors.ts";
import {
  rs,
  genCode,
  sha256,
  callerIp,
  CODE_TTL_MS,
  SESSION_MAX_DURATION_MS,
} from "../_shared/remote-support.ts";

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const ctx = await rs.context(req, cors, "remote-support-accept");
    if (ctx instanceof Response) return ctx;
    const { admin, user, json } = ctx;

    const { session_id } = await req.json();
    if (!session_id) return json({ error: "session_id required" }, 400);

    const { data: session, error: serr } = await admin
      .from("remote_support_sessions")
      .select("*")
      .eq("id", session_id)
      .single();
    if (serr || !session) return json({ error: "session not found" }, 404);
    if (!["requested", "pending_code"].includes(session.status)) {
      return json({ error: `session in status ${session.status}` }, 400);
    }

    // Sessão pedida há mais de SESSION_MAX → encerra (não gera código órfão).
    const createdMs = new Date(session.created_at).getTime();
    if (Number.isFinite(createdMs) && Date.now() - createdMs > SESSION_MAX_DURATION_MS) {
      await admin.from("remote_support_sessions").update({
        status: "ended",
        ended_at: new Date().toISOString(),
        end_reason: "max_duration",
      }).eq("id", session_id);
      await admin.from("remote_support_logs").insert({
        session_id,
        actor: "system",
        action: "session_expired",
        payload: { reason: "max_duration_before_accept" },
      });
      return json({ error: "session expired" }, 410);
    }

    // Autorização:
    //  - Sessão iniciada pelo requester: apenas Super Admin pode aceitar (vira operador).
    //  - Sessão iniciada pelo operador: o próprio requester autoriza (consultor clica autorizar)
    //    OU um Super Admin pode aceitar em seu lugar.
    const isSuper = await rs.isSuperAdmin(admin, user.id);
    const isRequesterAuthorizing =
      session.initiated_by === "operator" && session.requester_id === user.id;
    if (!isSuper && !isRequesterAuthorizing) {
      return json({ error: "forbidden" }, 403);
    }

    const code = genCode();
    const codeHash = await sha256(code);
    const rotatesAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    // Invalida códigos anteriores.
    await admin
      .from("remote_support_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("session_id", session_id)
      .is("consumed_at", null);

    await admin.from("remote_support_codes").insert({
      session_id,
      code_hash: codeHash,
      rotates_at: rotatesAt,
    });

    // Operator_id: se Super Admin aceitou, ele vira operator; se requester autorizou
    // sessão iniciada pelo operador, preserva o operator_id que já está na sessão.
    const updatePayload: Record<string, unknown> = { status: "pending_code" };
    if (isSuper) {
      updatePayload.operator_id = user.id;
      updatePayload.ip_operator = callerIp(req);
    }
    await admin
      .from("remote_support_sessions")
      .update(updatePayload)
      .eq("id", session_id);

    await admin.from("remote_support_logs").insert({
      session_id,
      actor: isRequesterAuthorizing ? "requester" : "operator",
      action: isRequesterAuthorizing ? "requester_authorized" : "operator_accepted",
      payload: { user_id: user.id },
    });

    // Broadcast do código ao requester via Realtime HTTP API (sem subscribe).
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let broadcastOk = false;
    try {
      const broadcastRes = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
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
      broadcastOk = broadcastRes.ok;
      if (!broadcastOk) {
        const bodyText = await broadcastRes.text().catch(() => "");
        console.warn(
          "[remote-support-accept] broadcast non-ok",
          broadcastRes.status,
          bodyText.slice(0, 200),
        );
        await admin.from("remote_support_logs").insert({
          session_id,
          actor: "system",
          action: "broadcast_failed",
          payload: { status: broadcastRes.status, body: bodyText.slice(0, 200) },
        });
      }
    } catch (e) {
      console.warn("[remote-support-accept] broadcast failed", e);
      await admin.from("remote_support_logs").insert({
        session_id,
        actor: "system",
        action: "broadcast_failed",
        payload: { error: e instanceof Error ? e.message : String(e) },
      });
    }

    // Code na resposta:
    //  - requester autorizando → sempre (é o dono da sessão)
    //  - Super Admin + broadcast falhou → fallback para ler o código ao consultor
    //  - Super Admin + broadcast ok → omitido (canal seguro é o broadcast)
    const includeCode = isRequesterAuthorizing || !broadcastOk;
    return json({
      ok: true,
      rotates_at: rotatesAt,
      broadcast_ok: broadcastOk,
      code: includeCode ? code : undefined,
    });
  } catch (e) {
    console.error("[remote-support-accept]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
