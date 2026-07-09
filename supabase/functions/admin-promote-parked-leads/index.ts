/**
 * admin-promote-parked-leads
 *
 * Reativa customers do consultor autenticado que estavam com `pos_venda_stage`
 * preenchido (fora do funil de Conversão) para `pos_venda_stage=NULL`, para
 * que reapareçam no Cockpit.
 *
 * NÃO toca em `captured_leads` (esses ficam em Captação) e NUNCA toca em
 * `customer_origin='igreen_sync'`.
 *
 * POST body opcional: { days?: number (30-365, default 120) }
 * Retorno: { reactivated, scanned }
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!consultant) {
    return new Response(JSON.stringify({ error: "consultant not found" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const consultantId = (consultant as any).id as string;

  let days = 120;
  try {
    const body = await req.json().catch(() => ({}));
    const n = Number(body?.days);
    if (Number.isFinite(n)) days = Math.min(365, Math.max(30, Math.floor(n)));
  } catch { /* ignore */ }

  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  try {
    // Quantos existem com estágio preenchido (para relatar `scanned`)
    const { count: scanned } = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("consultant_id", consultantId)
      .neq("customer_origin", "igreen_sync")
      .not("pos_venda_stage", "is", null)
      .gte("created_at", since);

    const { error: updErr, count } = await admin
      .from("customers")
      .update({ pos_venda_stage: null }, { count: "exact" })
      .eq("consultant_id", consultantId)
      .neq("customer_origin", "igreen_sync")
      .not("pos_venda_stage", "is", null)
      .gte("created_at", since);
    if (updErr) throw updErr;

    const reactivated = count ?? 0;

    await admin.from("admin_audit_log").insert({
      admin_user_id: userData.user.id,
      action: "conversao.reactivate_parked",
      target_type: "customers",
      target_id: null,
      metadata: { days, reactivated, scanned: scanned ?? 0 },
    }).then(({ error }) => { if (error) console.warn("audit:", error.message); });

    return new Response(
      JSON.stringify({ ok: true, days, reactivated, scanned: scanned ?? 0 }),
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
