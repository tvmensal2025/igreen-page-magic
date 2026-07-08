// Admin one-shot: percorre todos os consultores com número WhatsApp salvo e
// tenta resolver/persistir o phone_number_id real via resolveWabaPhone.
// Chamado manualmente pelo super admin (via header x-admin-secret) para
// destravar consultores que ainda estão sem ID numérico salvo.
import { adminClient, authConsultant, corsHeaders } from "../_shared/fb-graph.ts";
import { resolveWabaPhone } from "../_shared/resolve-waba-phone.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await authConsultant(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const admin = adminClient();
  // Só admin/super_admin OU o super-admin fundador podem rodar.
  let allowed = false;
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.id)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();
  if (roleRow) allowed = true;
  if (!allowed) {
    try {
      const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: auth.id });
      if (isSuper === true) allowed = true;
    } catch (_) { /* ignore */ }
  }
  if (!allowed) return json({ error: "Forbidden — admin only" }, 403);

  const { data: rows } = await admin
    .from("consultant_ad_settings")
    .select("consultant_id, whatsapp_destination_number, whatsapp_phone_number_id")
    .not("whatsapp_destination_number", "is", null);

  const results: Array<Record<string, unknown>> = [];
  for (const row of rows || []) {
    const before = {
      consultant_id: row.consultant_id,
      saved_number: row.whatsapp_destination_number,
      saved_id: row.whatsapp_phone_number_id,
    };
    try {
      const res = await resolveWabaPhone(row.consultant_id as string, { persist: true });
      results.push({
        ...before,
        ok: res.ok,
        reason: res.reason || null,
        discovered_via: res.discovered_via || null,
        chosen_id: res.chosen?.id || null,
        chosen_display: res.chosen?.display || null,
        waba_id: res.waba_id || null,
        hint: res.hint || null,
      });
    } catch (e) {
      results.push({ ...before, ok: false, error: (e as Error).message });
    }
  }

  const ready = results.filter((r) => r.ok).length;
  const blocked = results.length - ready;
  return json({ ok: true, total: results.length, ready, blocked, results });
});
