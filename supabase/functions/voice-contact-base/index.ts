// voice-contact-base — CRUD de bases de contato reutilizáveis.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCors } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/caller-auth.ts";
import { toVelipBRDest } from "../_shared/voice-dialer/velip.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  action: "create" | "add_items" | "delete" | "list_items";
  base_id?: string;
  name?: string;
  description?: string;
  items?: Array<{ phone: string; name?: string; vars?: Record<string, string> }>;
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (s: number, b: unknown) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const caller = await resolveCaller(req, admin);
  if (caller instanceof Response) return caller;
  if (caller.mode !== "jwt") return json(403, { error: "forbidden" });
  const consultantId = caller.consultantId;

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }

  if (body.action === "create") {
    if (!body.name?.trim()) return json(400, { error: "missing_name" });
    const { data, error } = await admin
      .from("voice_contact_bases")
      .insert({ consultant_id: consultantId, name: body.name.trim(), description: body.description ?? null })
      .select("id, name, total, created_at")
      .single();
    if (error) return json(500, { error: error.message });
    let inserted = 0;
    if (Array.isArray(body.items) && body.items.length > 0) {
      const rows = body.items
        .map((it) => ({ dest: toVelipBRDest(it.phone), it }))
        .filter((x): x is { dest: string; it: NonNullable<typeof body.items>[number] } => !!x.dest)
        .map(({ dest, it }) => ({
          base_id: (data as { id: string }).id,
          phone: dest,
          name: it.name ?? null,
          vars: it.vars ?? {},
        }));
      const seen = new Set<string>();
      const unique = rows.filter((r) => (seen.has(r.phone) ? false : (seen.add(r.phone), true)));
      if (unique.length) {
        const CHUNK = 500;
        for (let i = 0; i < unique.length; i += CHUNK) {
          await admin.from("voice_contact_base_items").insert(unique.slice(i, i + CHUNK));
        }
        inserted = unique.length;
        await admin.from("voice_contact_bases")
          .update({ total: inserted })
          .eq("id", (data as { id: string }).id);
      }
    }
    return json(200, { ok: true, base: data, inserted });
  }

  if (body.action === "add_items") {
    if (!body.base_id || !Array.isArray(body.items)) return json(400, { error: "missing_fields" });
    const { data: base } = await admin
      .from("voice_contact_bases").select("id, consultant_id, total").eq("id", body.base_id).maybeSingle();
    if (!base || (base as { consultant_id: string }).consultant_id !== consultantId) {
      return json(404, { error: "base_not_found" });
    }
    const rows = body.items
      .map((it) => ({ dest: toVelipBRDest(it.phone), it }))
      .filter((x): x is { dest: string; it: NonNullable<typeof body.items>[number] } => !!x.dest)
      .map(({ dest, it }) => ({
        base_id: body.base_id!,
        phone: dest,
        name: it.name ?? null,
        vars: it.vars ?? {},
      }));
    if (rows.length) {
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await admin.from("voice_contact_base_items").insert(rows.slice(i, i + CHUNK));
      }
      await admin.from("voice_contact_bases")
        .update({ total: ((base as { total: number }).total || 0) + rows.length })
        .eq("id", body.base_id);
    }
    return json(200, { ok: true, inserted: rows.length });
  }

  if (body.action === "delete") {
    if (!body.base_id) return json(400, { error: "missing_base_id" });
    await admin.from("voice_contact_bases").delete()
      .eq("id", body.base_id).eq("consultant_id", consultantId);
    return json(200, { ok: true });
  }

  if (body.action === "list_items") {
    if (!body.base_id) return json(400, { error: "missing_base_id" });
    const { data: base } = await admin
      .from("voice_contact_bases").select("consultant_id").eq("id", body.base_id).maybeSingle();
    if (!base || (base as { consultant_id: string }).consultant_id !== consultantId) {
      return json(404, { error: "base_not_found" });
    }
    const { data: items } = await admin
      .from("voice_contact_base_items")
      .select("id, phone, name, vars")
      .eq("base_id", body.base_id)
      .limit(2000);
    return json(200, { ok: true, items: items || [] });
  }

  return json(400, { error: "invalid_action" });
});
