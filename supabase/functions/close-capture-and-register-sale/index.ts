// close-capture-and-register-sale
// Encerra a captação com decisão explícita: Ganho (won) ou Perdido (lost).
// - Grava sales com outcome + source_kind/source_id (ou lost_reason)
// - Atualiza customers.capture_closed_at (sem apagar o chat WhatsApp)
// - Move crm_deals para stage='ganho' | 'perdido'
// - Se won + veio de campanha, devolve ROI para exibir no toast
// Idempotente: se já encerrado antes, devolve o estado atual.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendRawToNumber } from "../_shared/notify-consultant.ts";

type Attribution =
  | { kind: "campaign"; id: string; campaignId?: string | null; partnerId?: string | null }
  | { kind: "partner"; id: string; campaignId?: string | null; partnerId?: string | null }
  | { kind: "organic"; campaignId?: string | null; partnerId?: string | null };

interface Body {
  customerId: string;
  consultantId: string;
  outcome: "won" | "lost";
  // won
  productId?: string;
  amountCents?: number;
  pointsKwh?: number;
  attribution?: Attribution;
  // lost
  lostReason?: string;
  notes?: string;
  // partner notification (lost)
  notifyPartner?: boolean;
  partnerMessage?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.replace(/^Bearer\s+/i, "")) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Partial<Body>;
    const customerId = String(body.customerId || "").trim();
    const consultantId = String(body.consultantId || "").trim();
    const outcome = body.outcome === "lost" ? "lost" : body.outcome === "won" ? "won" : null;
    if (!customerId || !consultantId || !outcome) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    // 1) Cliente
    const { data: customer, error: cErr } = await supabase
      .from("customers")
      .select(
        "id, consultant_id, name, phone_whatsapp, cpf, address_city, address_state, electricity_bill_value, media_consumo, source_campaign_id, referral_partner_id, capture_closed_at",
      )
      .eq("id", customerId)
      .maybeSingle();
    if (cErr || !customer) return json({ ok: false, error: "customer_not_found" }, 404);
    if (customer.consultant_id && customer.consultant_id !== consultantId) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
    if (customer.capture_closed_at) {
      return json({ ok: true, alreadyClosed: true });
    }

    const nowIso = new Date().toISOString();
    const attribution = body.attribution;
    const sourceKind = attribution?.kind ?? "organic";
    const sourceId =
      attribution && "id" in attribution ? attribution.id : null;
    const attrCampaignId =
      attribution && "campaignId" in attribution && attribution.campaignId
        ? String(attribution.campaignId)
        : sourceKind === "campaign" && sourceId
          ? sourceId
          : null;
    const attrPartnerId =
      attribution && "partnerId" in attribution && attribution.partnerId
        ? String(attribution.partnerId)
        : sourceKind === "partner" && sourceId
          ? sourceId
          : null;

    // Se usuário mudou a origem, reflete em customers (campanha e parceiro podem coexistir)
    // NÃO zerar capture_mode — coluna é NOT NULL (default 'auto').
    const customerPatch: Record<string, unknown> = {
      capture_closed_at: nowIso,
      capture_closed_by: consultantId,
    };
    if (outcome === "won" && attribution) {
      if (sourceKind === "organic") {
        // Orgânico explícito: não apaga vínculos já existentes no lead
        // (só registra a sale como orgânica).
      } else {
        if (attrCampaignId) customerPatch.source_campaign_id = attrCampaignId;
        if (attrPartnerId) customerPatch.referral_partner_id = attrPartnerId;
      }
    }

    // ----- WON -----
    let saleId: string | undefined;
    let pointsKwh = 0;
    if (outcome === "won") {
      let productId = body.productId;
      if (!productId) {
        const { data: prod } = await supabase
          .from("products")
          .select("id")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .limit(1)
          .maybeSingle();
        productId = prod?.id;
      }
      if (!productId) return json({ ok: false, error: "no_product_available" }, 500);

      const billValue = Number(customer.electricity_bill_value || 0);
      const mediaConsumo = Number(customer.media_consumo || 0);
      pointsKwh = Number(body.pointsKwh ?? 0) > 0
        ? Number(body.pointsKwh)
        : mediaConsumo > 0
          ? mediaConsumo
          : billValue > 0
            ? Math.round(billValue / 0.85)
            : 0;

      const snapshot = {
        name: customer.name,
        name_source: (customer as any).name_source,
        phone: customer.phone_whatsapp,
        cpf: customer.cpf,
        city: customer.address_city,
        state: customer.address_state,
        bill_value: billValue,
        closed_via: "capture_close_button",
        source_kind: sourceKind,
        source_id: sourceId,
      };

      const { data: existingSale } = await supabase
        .from("sales")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("customer_id", customerId)
        .maybeSingle();

      const salePayload = {
        status: "fechado" as const,
        outcome: "won" as const,
        source_kind: sourceKind,
        source_id: sourceId,
        product_id: productId,
        points_kwh: pointsKwh,
        amount_cents: body.amountCents ?? null,
        capture_data: snapshot,
        closed_at: nowIso,
        notes: body.notes ?? null,
        lost_reason: null,
      };

      if (existingSale?.id) {
        await supabase.from("sales").update(salePayload).eq("id", existingSale.id);
        saleId = existingSale.id;
      } else {
        const { data: newSale, error: sErr } = await supabase
          .from("sales")
          .insert({ consultant_id: consultantId, customer_id: customerId, ...salePayload })
          .select("id")
          .maybeSingle();
        if (sErr) return json({ ok: false, error: "sale_insert_failed", detail: sErr.message }, 500);
        saleId = newSale?.id;
      }

      // CRM → ganho
      await supabase
        .from("crm_deals")
        .update({ stage: "ganho", updated_at: nowIso })
        .eq("customer_id", customerId)
        .eq("consultant_id", consultantId);
    }

    // ----- LOST -----
    if (outcome === "lost") {
      const lostReason = String(body.lostReason || "sem_motivo").slice(0, 120);

      const { data: existingSale } = await supabase
        .from("sales")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("customer_id", customerId)
        .maybeSingle();

      const lostPayload = {
        status: "perdido" as const,
        outcome: "lost" as const,
        lost_reason: lostReason,
        notes: body.notes ?? null,
        closed_at: nowIso,
      };

      if (existingSale?.id) {
        await supabase.from("sales").update(lostPayload).eq("id", existingSale.id);
        saleId = existingSale.id;
      } else {
        const { data: newSale } = await supabase
          .from("sales")
          .insert({ consultant_id: consultantId, customer_id: customerId, ...lostPayload })
          .select("id")
          .maybeSingle();
        saleId = newSale?.id;
      }

      await supabase
        .from("crm_deals")
        .update({ stage: "perdido", updated_at: nowIso, rejection_reason: lostReason })
        .eq("customer_id", customerId)
        .eq("consultant_id", consultantId);

      // Aviso opcional ao parceiro que indicou este lead
      if (body.notifyPartner && customer.referral_partner_id && body.partnerMessage) {
        try {
          const { data: partner } = await supabase
            .from("referral_partners")
            .select("nome, notification_phone")
            .eq("id", customer.referral_partner_id)
            .maybeSingle();
          const phone = (partner as any)?.notification_phone || "";
          if (phone) {
            const sent = await sendRawToNumber(consultantId, phone, body.partnerMessage);
            if (!sent) console.warn("[close-capture] aviso parceiro falhou");
          }
        } catch (e) {
          console.warn("[close-capture] aviso parceiro erro:", (e as Error).message);
        }
      }
    }

    // 2) Encerra captação
    await supabase.from("customers").update(customerPatch).eq("id", customerId);

    // 3) ROI (só em won + campanha)
    let campaignRoi: null | {
      campaignId: string;
      leadsCount: number;
      investedCents: number;
      returnedCents: number;
      balanceCents: number;
      positive: boolean;
    } = null;

    const roiCampaignId =
      outcome === "won" && sourceKind === "campaign" && sourceId
        ? sourceId
        : customer.source_campaign_id;

    if (outcome === "won" && roiCampaignId) {
      const { count: leadsCount } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("source_campaign_id", roiCampaignId);

      const { data: soldSales } = await supabase
        .from("sales")
        .select("amount_cents, customer:customers!inner(source_campaign_id)")
        .eq("status", "fechado")
        .eq("customer.source_campaign_id", roiCampaignId);

      const returnedCents = (soldSales || []).reduce(
        (acc: number, s: any) => acc + Number(s.amount_cents || 0),
        0,
      );

      const { data: spendRows } = await supabase
        .from("facebook_metrics_daily")
        .select("spend_cents")
        .eq("campaign_id", roiCampaignId);
      const investedCents = (spendRows || []).reduce(
        (acc: number, r: any) => acc + Number(r.spend_cents || 0),
        0,
      );

      campaignRoi = {
        campaignId: roiCampaignId,
        leadsCount: leadsCount || 0,
        investedCents,
        returnedCents,
        balanceCents: returnedCents - investedCents,
        positive: returnedCents >= investedCents,
      };
    }

    return json({ ok: true, outcome, saleId, pointsKwh, campaignRoi });
  } catch (e) {
    return json({ ok: false, error: "exception", message: (e as Error).message }, 500);
  }
});
