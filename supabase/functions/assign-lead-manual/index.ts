/**
 * assign-lead-manual
 *
 * Atribui manualmente um lead da fila de revisão a um parceiro (chamado pelo
 * ManualReviewQueueCard). Além do UPDATE em customers, também:
 *   - notifica o parceiro por WhatsApp (mesmo canal do rodízio automático)
 *   - registra em campaign_match_log (method='manual_assignment')
 *
 * Autenticação: exige JWT válido do admin (dono do consultor). Nunca aceita
 * partnerId de outro consultor.
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { notifyPartnerNewLead } from "../_shared/notify-consultant.ts";

const BodySchema = z.object({
  customer_id: z.string().uuid(),
  partner_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cliente do usuário (valida JWT)
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

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { customer_id, partner_id } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    // Carrega consultor do usuário logado
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

    // Valida que o customer e o parceiro pertencem a este consultor
    const [customerRes, partnerRes] = await Promise.all([
      admin
        .from("customers")
        .select("id, consultant_id, name, phone_whatsapp, is_sandbox, source_campaign_id, needs_manual_review")
        .eq("id", customer_id)
        .maybeSingle(),
      admin
        .from("referral_partners")
        .select("id, consultant_id")
        .eq("id", partner_id)
        .maybeSingle(),
    ]);

    const customer: any = customerRes.data;
    const partner: any = partnerRes.data;

    if (!customer || customer.consultant_id !== consultantId) {
      return new Response(JSON.stringify({ error: "customer not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!partner || partner.consultant_id !== consultantId) {
      return new Response(JSON.stringify({ error: "partner not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atribui + remove da fila
    const { error: updErr } = await admin
      .from("customers")
      .update({
        referral_partner_id: partner_id,
        referral_detected_at: new Date().toISOString(),
        needs_manual_review: false,
      })
      .eq("id", customer_id);
    if (updErr) throw updErr;

    // Log de auditoria
    admin
      .from("campaign_match_log")
      .insert({
        customer_id,
        campaign_id: customer.source_campaign_id ?? null,
        method: "manual_assignment",
        rodizio_outcome: "assigned",
      })
      .then(({ error }) => {
        if (error) console.warn("[assign-lead-manual] log falhou:", error.message);
      });

    // Notifica o parceiro (mesmo canal do rodízio automático)
    notifyPartnerNewLead(consultantId, partner_id, {
      id: customer.id,
      name: customer.name,
      phone_whatsapp: customer.phone_whatsapp,
      is_sandbox: customer.is_sandbox,
    }).catch((e) => console.warn("[assign-lead-manual] notify falhou:", (e as Error).message));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[assign-lead-manual] erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
