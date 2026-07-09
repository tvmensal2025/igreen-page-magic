/**
 * admin-promote-parked-leads
 *
 * Varre leads parados dos últimos N dias (default 120) do consultor autenticado
 * e joga TODOS no funil de Conversão:
 *
 *  - `captured_leads` sem `customer_id` → cria/atualiza em `customers` com
 *    `customer_origin='whatsapp_lead'` e `pos_venda_stage=NULL` (aparece no
 *    Cockpit de Conversão do consultor dono do lead).
 *  - `customers` com `customer_origin` != `igreen_sync` e sem estágio → apenas
 *    garante `pos_venda_stage=NULL` (idempotente).
 *
 * Nunca toca em `igreen_sync`. Dedup por telefone normalizado + consultor via
 * upsert manual (SELECT + INSERT/UPDATE).
 *
 * POST body opcional: { days?: number (30-365, default 120) }
 * Retorno: { promoted, linked, reactivated, skipped }
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 12 && digits.startsWith("55")) return digits;
  if (digits.length >= 10 && digits.length <= 11) return "55" + digits;
  return digits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) {
    return new Response(JSON.stringify({ error: "missing auth" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: "invalid auth" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: consultant } = await admin
    .from("consultants")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!consultant) {
    return new Response(JSON.stringify({ error: "consultant not found" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const consultantId = (consultant as any).id as string;

  // Body
  let days = 120;
  try {
    const body = await req.json().catch(() => ({}));
    const n = Number(body?.days);
    if (Number.isFinite(n)) days = Math.min(365, Math.max(30, Math.floor(n)));
  } catch { /* ignore */ }

  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  try {
    let promoted = 0;
    let linked = 0;
    let reactivated = 0;
    let skipped = 0;

    // 1) captured_leads sem customer_id → promover a customers
    const { data: leads, error: leadsErr } = await admin
      .from("captured_leads")
      .select("id, consultant_id, full_name, phone, city, uf, source_campaign_id, ctwa_clid, channel, created_at")
      .eq("consultant_id", consultantId)
      .is("customer_id", null)
      .gte("created_at", since)
      .limit(5000);
    if (leadsErr) throw leadsErr;

    for (const lead of (leads ?? []) as any[]) {
      const phoneNorm = normalizePhone(lead.phone);
      if (!phoneNorm) { skipped++; continue; }

      const { data: existing } = await admin
        .from("customers")
        .select("id, customer_origin, name, pos_venda_stage")
        .eq("consultant_id", consultantId)
        .eq("phone_whatsapp", phoneNorm)
        .maybeSingle();

      let customerId: string | null = null;

      if (existing && (existing as any).customer_origin === "igreen_sync") {
        // já é cliente ativo iGreen — não mexe, só linka o captured para não repetir
        customerId = (existing as any).id;
      } else if (existing) {
        customerId = (existing as any).id;
        const patch: Record<string, any> = { pos_venda_stage: null };
        if (!(existing as any).name && lead.full_name) patch.name = lead.full_name;
        const { error: updErr } = await admin
          .from("customers")
          .update(patch)
          .eq("id", customerId);
        if (!updErr) reactivated++;
      } else {
        const { data: inserted, error: insErr } = await admin
          .from("customers")
          .insert({
            consultant_id: consultantId,
            phone_whatsapp: phoneNorm,
            name: lead.full_name ?? null,
            address_city: lead.city ?? null,
            customer_origin: "whatsapp_lead",
            origin_channel: lead.channel ?? "meta_form",
            source_campaign_id: lead.source_campaign_id ?? null,
            source_ctwa_clid: lead.ctwa_clid ?? null,
            pos_venda_stage: null,
          })
          .select("id")
          .maybeSingle();
        if (insErr) {
          console.warn("[promote] insert falhou:", insErr.message, "phone:", phoneNorm);
          skipped++;
          continue;
        }
        customerId = (inserted as any)?.id ?? null;
        if (customerId) promoted++;
      }

      if (customerId) {
        await admin
          .from("captured_leads")
          .update({ customer_id: customerId, status: "converted", updated_at: new Date().toISOString() })
          .eq("id", lead.id);
        linked++;
      }
    }

    // 2) customers whatsapp_lead sem pos_venda_stage=NULL do consultor →
    //    já aparecem no cockpit, mas garantimos limpeza de estágio residual.
    const { error: updErr, count } = await admin
      .from("customers")
      .update({ pos_venda_stage: null }, { count: "exact" })
      .eq("consultant_id", consultantId)
      .neq("customer_origin", "igreen_sync")
      .not("pos_venda_stage", "is", null)
      .gte("created_at", since);
    if (updErr) console.warn("[promote] reset stage falhou:", updErr.message);
    else reactivated += count ?? 0;

    // Audit
    await admin.from("admin_audit_log").insert({
      admin_user_id: userData.user.id,
      action: "conversao.promote_parked",
      target_type: "customers",
      target_id: null,
      metadata: { days, promoted, linked, reactivated, skipped, captured_scanned: (leads ?? []).length },
    }).then(({ error }) => { if (error) console.warn("audit:", error.message); });

    return new Response(
      JSON.stringify({ ok: true, days, promoted, linked, reactivated, skipped, scanned: (leads ?? []).length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[admin-promote-parked-leads] error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
