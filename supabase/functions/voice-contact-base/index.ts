// voice-contact-base — CRUD simples de bases (phones em JSONB)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { toVelipBRDest } from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const caller = await resolveCaller(req);
  if (!caller?.consultantId) return json(401, { error: "unauthorized" });

  let body: { action?: string; name?: string; phones?: string[]; id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (body.action === "create") {
    const name = (body.name || "").trim();
    if (!name) return json(400, { error: "missing_name" });
    const clean = (Array.isArray(body.phones) ? body.phones : [])
      .map((p) => toVelipBRDest(p))
      .filter((v): v is string => !!v);
    const uniq = [...new Set(clean)];
    const { data, error } = await admin
      .from("voice_contact_bases")
      .insert({
        consultant_id: caller.consultantId,
        name,
        phones: uniq.map((phone) => ({ phone })),
        total: uniq.length,
      })
      .select("id")
      .single();
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, id: (data as { id: string }).id, total: uniq.length });
  }

  if (body.action === "delete" && body.id) {
    await admin.from("voice_contact_bases").delete().eq("id", body.id).eq("consultant_id", caller.consultantId);
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown_action" });
});
