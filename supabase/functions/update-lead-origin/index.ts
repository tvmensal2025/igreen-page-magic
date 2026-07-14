/**
 * update-lead-origin
 *
 * Edita origem do lead (parceiro / campanha Meta / limpar) SEM notificar
 * parceiro e SEM regenerar protocolo. Usado pelo LeadOriginEditorDialog.
 *
 * Auth: JWT do consultor (dono do lead) ou super admin.
 * Bloqueia se capture_closed_at estiver preenchido (409).
 * Leads com source_ad_id (prova Meta forte): não permite limpar/trocar campanha
 * (trigger enforce_customer_meta_ad_campaign_guard restauraria mesmo).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  customer_id: z.string().uuid(),
  kind: z.enum(["partner", "campaign", "none"]),
  source_id: z.string().uuid().nullable().optional(),
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
      return json(
        { ok: false, error: "invalid_body", details: parsed.error.flatten().fieldErrors },
        400,
      );
    }
    const { customer_id, kind, source_id } = parsed.data;

    if ((kind === "partner" || kind === "campaign") && !source_id) {
      return json({ ok: false, error: "source_id_required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

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

    const { data: customer, error: custErr } = await admin
      .from("customers")
      .select(
        "id, consultant_id, capture_closed_at, referral_partner_id, source_campaign_id, source_ad_id, referral_detected_at",
      )
      .eq("id", customer_id)
      .maybeSingle();

    if (custErr) throw custErr;
    if (!customer) return json({ ok: false, error: "customer_not_found" }, 404);

    if (!isSuperAdmin && customer.consultant_id !== userId) {
      return json({ ok: false, error: "forbidden_customer" }, 403);
    }

    if (customer.capture_closed_at) {
      return json({ ok: false, error: "capture_already_closed" }, 409);
    }

    const hasStrongMetaAd =
      typeof customer.source_ad_id === "string" && customer.source_ad_id.trim().length > 0;

    // Trigger Meta restaura source_campaign_id quando source_ad_id existe.
    // Não fingir exclusividade que o banco desfaz.
    if (hasStrongMetaAd) {
      if (kind === "none") {
        return json({ ok: false, error: "meta_ad_origin_locked" }, 409);
      }
      if (kind === "campaign" && source_id && source_id !== customer.source_campaign_id) {
        return json({ ok: false, error: "meta_ad_campaign_locked" }, 409);
      }
    }

    let patch: Record<string, unknown>;

    if (kind === "none") {
      patch = {
        referral_partner_id: null,
        source_campaign_id: null,
        referral_detected_at: null,
      };
    } else if (kind === "partner") {
      const { data: partner } = await admin
        .from("referral_partners")
        .select("id, consultant_id, is_active, nome")
        .eq("id", source_id!)
        .maybeSingle();
      if (!partner) return json({ ok: false, error: "partner_not_found" }, 404);
      if (partner.is_active === false) {
        return json({ ok: false, error: "partner_inactive" }, 400);
      }
      if (partner.consultant_id !== customer.consultant_id) {
        return json({ ok: false, error: "partner_wrong_consultant" }, 403);
      }
      // Com AD Meta forte: só troca parceiro, mantém campanha (trigger exige).
      patch = hasStrongMetaAd
        ? {
            referral_partner_id: source_id!,
            referral_detected_at: new Date().toISOString(),
          }
        : {
            referral_partner_id: source_id!,
            source_campaign_id: null,
            referral_detected_at: new Date().toISOString(),
          };
    } else {
      const { data: campaign } = await admin
        .from("facebook_campaigns")
        .select("id, consultant_id, name, status")
        .eq("id", source_id!)
        .maybeSingle();
      if (!campaign) return json({ ok: false, error: "campaign_not_found" }, 404);
      if (campaign.consultant_id !== customer.consultant_id && !isSuperAdmin) {
        return json({ ok: false, error: "campaign_wrong_consultant" }, 403);
      }
      patch = {
        source_campaign_id: source_id!,
        referral_partner_id: null,
        referral_detected_at: null,
      };
    }

    const { error: updErr } = await admin
      .from("customers")
      .update(patch)
      .eq("id", customer_id);
    if (updErr) {
      const msg = updErr.message || "";
      if (msg.includes("campaign_ad_id_mismatch")) {
        return json({ ok: false, error: "partner_not_in_campaign_pool" }, 409);
      }
      throw updErr;
    }

    // Estado real pós-trigger (Meta pode ter restaurado campanha / limpo parceiro)
    const { data: after } = await admin
      .from("customers")
      .select("referral_partner_id, source_campaign_id")
      .eq("id", customer_id)
      .maybeSingle();

    const finalPartnerId = after?.referral_partner_id ?? null;
    const finalCampaignId = after?.source_campaign_id ?? null;

    let finalKind: "partner" | "campaign" | "none" = "none";
    if (finalPartnerId) finalKind = "partner";
    else if (finalCampaignId) finalKind = "campaign";

    admin
      .from("campaign_match_log")
      .insert({
        customer_id,
        campaign_id: finalCampaignId,
        method: "manual_origin_edit",
        rodizio_outcome: finalKind,
        message_sample: `requested=${kind};final=${finalKind};source_id=${source_id ?? "null"}`,
      })
      .then(({ error }) => {
        if (error) console.warn("[update-lead-origin] log falhou:", error.message);
      });

    let partner_name: string | null = null;
    let campaign_name: string | null = null;
    if (finalPartnerId) {
      const { data: p } = await admin
        .from("referral_partners")
        .select("nome")
        .eq("id", finalPartnerId)
        .maybeSingle();
      partner_name = (p as { nome?: string } | null)?.nome ?? null;
    }
    if (finalCampaignId) {
      const { data: c } = await admin
        .from("facebook_campaigns")
        .select("name")
        .eq("id", finalCampaignId)
        .maybeSingle();
      campaign_name = (c as { name?: string } | null)?.name ?? null;
    }

    return json({
      ok: true,
      kind: finalKind,
      referral_partner_id: finalPartnerId,
      source_campaign_id: finalCampaignId,
      partner_name,
      campaign_name,
      meta_ad_locked: hasStrongMetaAd,
    });
  } catch (e) {
    console.error("[update-lead-origin] erro:", (e as Error).message);
    return json({ ok: false, error: (e as Error).message || "internal_error" }, 500);
  }
});
