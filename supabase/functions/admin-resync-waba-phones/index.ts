// Admin one-shot: percorre todos os consultores com número WhatsApp salvo e
// tenta resolver/persistir o phone_number_id real via resolveWabaPhone.
// Chamado manualmente pelo super admin (via header x-admin-secret) para
// destravar consultores que ainda estão sem ID numérico salvo.
import { adminClient, corsHeaders } from "../_shared/fb-graph.ts";
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

  // Gate: exige service_role no header (só quem tem SUPABASE_SERVICE_ROLE_KEY chama)
  const secret = req.headers.get("x-admin-secret") || "";
  if (secret !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return json({ error: "Forbidden" }, 403);
  }

  const admin = adminClient();
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
