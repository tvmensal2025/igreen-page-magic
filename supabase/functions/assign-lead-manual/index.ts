/**
 * assign-lead-manual
 *
 * Atribui manualmente um lead da fila de revisão a um parceiro (UI
 * ManualReviewQueueCard). Além do UPDATE em customers:
 *   - gera protocolo {short_code}-YYMMDD-seq
 *   - notifica o parceiro no WhatsApp
 *   - registra em campaign_match_log (method='manual_assignment')
 *
 * Auth: JWT do consultor. Em consultants, id = auth.users.id (não há user_id).
 * Super admin pode atribuir leads de qualquer consultor.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";
import { notifyPartnerNewLead } from "../_shared/notify-consultant.ts";
import { assignProtocolToCustomer } from "../_shared/protocol.ts";

const BodySchema = z.object({
  customer_id: z.string().uuid(),
  partner_id: z.string().uuid(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ ok: false, error: "missing_auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData.user) {
      return json({ ok: false, error: "invalid_auth" }, 401);
    }
    const userId = userData.user.id;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ ok: false, error: "invalid_body", details: parsed.error.flatten().fieldErrors }, 400);
    }
    const { customer_id, partner_id } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    // consultants.id = auth.users.id (não existe coluna user_id)
    const { data: consultant } = await admin
      .from("consultants")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    let isSuperAdmin = false;
    try {
      const { data: sa } = await admin.rpc("is_super_admin", { _user_id: userId });
      isSuperAdmin = sa === true;
    } catch {
      isSuperAdmin = false;
    }

    if (!consultant && !isSuperAdmin) {
      return json({ ok: false, error: "consultant_not_found" }, 403);
    }

    const [customerRes, partnerRes] = await Promise.all([
      admin
        .from("customers")
        .select(
          "id, consultant_id, name, phone_whatsapp, is_sandbox, source_campaign_id, needs_manual_review, tracking_protocol",
        )
        .eq("id", customer_id)
        .maybeSingle(),
      admin
        .from("referral_partners")
        .select("id, consultant_id, nome, short_code, is_active")
        .eq("id", partner_id)
        .maybeSingle(),
    ]);

    const customer: any = customerRes.data;
    const partner: any = partnerRes.data;

    if (!customer) {
      return json({ ok: false, error: "customer_not_found" }, 404);
    }
    if (!partner) {
      return json({ ok: false, error: "partner_not_found" }, 404);
    }
    if (partner.is_active === false) {
      return json({ ok: false, error: "partner_inactive" }, 400);
    }

    // Dono do lead ou super admin
    if (!isSuperAdmin && customer.consultant_id !== userId) {
      return json({ ok: false, error: "forbidden_customer" }, 403);
    }
    // Parceiro precisa ser do mesmo consultor do lead
    if (partner.consultant_id !== customer.consultant_id) {
      return json({ ok: false, error: "partner_wrong_consultant" }, 403);
    }

    const ownerConsultantId = String(customer.consultant_id);

    const { error: updErr } = await admin
      .from("customers")
      .update({
        referral_partner_id: partner_id,
        referral_detected_at: new Date().toISOString(),
        needs_manual_review: false,
        manual_review_reason: null,
      })
      .eq("id", customer_id);
    if (updErr) {
      const msg = updErr.message || "";
      if (msg.includes("campaign_ad_id_mismatch")) {
        return json({
          ok: false,
          error: "partner_not_in_campaign_pool",
          hint: "Este parceiro não faz parte do pool de rodízio da campanha Meta deste lead. Adicione-o ao pool da campanha antes de atribuir, ou escolha outro parceiro.",
        }, 409);
      }
      throw updErr;
    }

    // Protocolo do parceiro (short_code-YYMMDD-seq)
    let protocol: string | null = customer.tracking_protocol || null;
    try {
      const protoRes = await assignProtocolToCustomer(admin, customer_id, {
        partnerId: partner_id,
        partnerName: partner.nome,
      });
      if (protoRes?.protocol) protocol = protoRes.protocol;
    } catch (e) {
      console.warn("[assign-lead-manual] protocolo falhou:", (e as Error).message);
    }

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

    const notifyRes = await notifyPartnerNewLead(ownerConsultantId, partner_id, {
      id: customer.id,
      name: customer.name,
      phone_whatsapp: customer.phone_whatsapp,
      is_sandbox: customer.is_sandbox,
      tracking_protocol: protocol,
    }, { force: true, manual: true });

    return json({
      ok: true,
      protocol,
      partner_name: partner.nome,
      partner_short_code: partner.short_code ?? null,
      notify_ok: notifyRes.ok,
      notify_error: notifyRes.reason ?? null,
    });
  } catch (e) {
    console.error("[assign-lead-manual] erro:", (e as Error).message);
    return json({ ok: false, error: (e as Error).message || "internal_error" }, 500);
  }
});
