// Fase 5 — Retargeting Meta automático.
// Sobe telefone/email (SHA256) de leads em CLOSE_LOST/RETARGET_META
// para a Custom Audience configurada em facebook_connections.custom_audience_id.
// Cron 3x/dia. Respeita opt-out via lead_consent_log (SAIR).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAutomationEnabled, logSkipped } from "../_shared/automation-gate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v20.0";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function normPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") ? d : "55" + d;
}
function normEmail(e: string | null): string | null {
  if (!e) return null;
  const t = e.trim().toLowerCase();
  return t.includes("@") ? t : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!(await isAutomationEnabled(admin, "facebook_retarget_sync"))) {
      await logSkipped(admin, "facebook_retarget_sync");
      return new Response(JSON.stringify({ skipped: "automation_disabled", key: "facebook_retarget_sync" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }


  const { data: flag } = await admin.from("app_settings").select("retarget_enabled").limit(1).maybeSingle();
  if (flag && flag.retarget_enabled === false) {
    return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: conns } = await admin
    .from("facebook_connections")
    .select("consultant_id, access_token_encrypted, custom_audience_id, ad_account_id")
    .not("custom_audience_id", "is", null)
    .eq("status", "active");

  const { decryptToken } = await import("../_shared/fb-crypto.ts");
  const results: Array<{ consultant_id: string; audience_id: string; added: number; error?: string }> = [];

  for (const c of conns ?? []) {
    if (!c.access_token_encrypted || !c.custom_audience_id) continue;

    // Leads elegíveis: motor marcou como frio nos últimos 90 dias.
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data: leads } = await admin
      .from("lead_cadence_state")
      .select("customer_id, stage, updated_at, customer:customers!inner(id, consultant_id, phone_whatsapp, email)")
      .in("stage", ["CLOSE_LOST", "RETARGET_META"])
      .gte("updated_at", cutoff)
      .eq("customer.consultant_id", c.consultant_id)
      .limit(5000);

    if (!leads?.length) { results.push({ consultant_id: c.consultant_id, audience_id: c.custom_audience_id, added: 0 }); continue; }

    // Filtra opt-outs via customers.do_not_contact (fonte da verdade).
    const ids = leads.map(l => l.customer_id);
    const { data: optouts } = await admin
      .from("customers")
      .select("id")
      .in("id", ids)
      .eq("do_not_contact", true);
    const blocked = new Set((optouts ?? []).map((o: { id: string }) => o.id));

    const rows: Array<[string, string]> = [];
    for (const l of leads) {
      if (blocked.has(l.customer_id)) continue;
      const cust = Array.isArray(l.customer) ? l.customer[0] : l.customer;
      const ph = normPhone(cust?.phone_whatsapp ?? null);
      const em = normEmail(cust?.email ?? null);
      const phH = ph ? await sha256Hex(ph) : "";
      const emH = em ? await sha256Hex(em) : "";
      if (phH || emH) rows.push([phH, emH]);
    }
    if (!rows.length) { results.push({ consultant_id: c.consultant_id, audience_id: c.custom_audience_id, added: 0 }); continue; }

    try {
      const token = await decryptToken(c.access_token_encrypted);
      const payload = { schema: ["PHONE", "EMAIL"], data: rows };
      const url = `${GRAPH}/${c.custom_audience_id}/users?access_token=${encodeURIComponent(token)}`;
      const resp = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(JSON.stringify(body));

      await admin.from("facebook_connections").update({
        audience_synced_at: new Date().toISOString(),
        audience_source_count: rows.length,
      }).eq("consultant_id", c.consultant_id);

      // Marca leads como retargetados no motor.
      await admin.from("lead_cadence_state").update({ stage: "RETARGET_META" })
        .in("customer_id", ids.filter(id => !blocked.has(id)))
        .eq("stage", "CLOSE_LOST");

      // Log agregado no cadence_action_log.
      await admin.from("cadence_action_log").insert({
        customer_id: ids[0], stage: "RETARGET_META", channel: "meta_audience",
        status: "sent", cost_cents: 0,
        payload: { synced: rows.length, audience_id: c.custom_audience_id, consultant_id: c.consultant_id },
      });

      results.push({ consultant_id: c.consultant_id, audience_id: c.custom_audience_id, added: rows.length });
    } catch (e) {
      results.push({ consultant_id: c.consultant_id, audience_id: c.custom_audience_id, added: 0, error: String((e as Error).message).slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});