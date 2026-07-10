// close-capture-and-register-sale
// Encerra a captação de um lead e vincula ele em Vendas / CRM / Comissão.
// - Marca customers.capture_mode = null + capture_closed_at
// - Faz upsert em sales com status='fechado' (idempotente por consultant+customer)
// - Atualiza crm_deals.stage='finalizando' se existir deal
// - Calcula ROI da campanha (investido vs retorno) se lead veio de anúncio
// - NÃO mexe em WhatsApp: o chat continua ativo normalmente

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface Body {
  customerId: string;
  consultantId: string;
  productId?: string;
  amountCents?: number;
  notes?: string;
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
    if (!customerId || !consultantId) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    // 1) Carrega cliente
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

    // Idempotência — já encerrado antes
    if (customer.capture_closed_at) {
      return json({ ok: true, alreadyClosed: true });
    }

    // 2) Resolve produto (default: primeiro produto ativo)
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

    // 3) kWh estimado — usa media_consumo direto, ou deriva do valor da conta
    const billValue = Number(customer.electricity_bill_value || 0);
    const mediaConsumo = Number(customer.media_consumo || 0);
    const pointsKwh = mediaConsumo > 0
      ? mediaConsumo
      : billValue > 0
        ? Math.round(billValue / 0.85)
        : 0;

    // 4) Upsert sale (idempotente): procura sale aberta desse cliente
    const { data: existingSale } = await supabase
      .from("sales")
      .select("id, status")
      .eq("consultant_id", consultantId)
      .eq("customer_id", customerId)
      .maybeSingle();

    const saleSnapshot = {
      name: customer.name,
      phone: customer.phone_whatsapp,
      cpf: customer.cpf,
      city: customer.address_city,
      state: customer.address_state,
      bill_value: billValue,
      closed_via: "capture_close_button",
    };

    let saleId = existingSale?.id;
    if (saleId) {
      await supabase
        .from("sales")
        .update({
          status: "fechado",
          product_id: productId,
          points_kwh: pointsKwh,
          amount_cents: body.amountCents ?? null,
          capture_data: saleSnapshot,
          closed_at: new Date().toISOString(),
          notes: body.notes ?? null,
        })
        .eq("id", saleId);
    } else {
      const { data: newSale, error: sErr } = await supabase
        .from("sales")
        .insert({
          consultant_id: consultantId,
          customer_id: customerId,
          product_id: productId,
          status: "fechado",
          points_kwh: pointsKwh,
          amount_cents: body.amountCents ?? null,
          capture_data: saleSnapshot,
          closed_at: new Date().toISOString(),
          notes: body.notes ?? null,
        })
        .select("id")
        .maybeSingle();
      if (sErr) return json({ ok: false, error: "sale_insert_failed", detail: sErr.message }, 500);
      saleId = newSale?.id;
    }

    // 5) Encerra a captação (sem apagar o chat WhatsApp)
    await supabase
      .from("customers")
      .update({
        capture_mode: null,
        capture_closed_at: new Date().toISOString(),
        capture_closed_by: consultantId,
      })
      .eq("id", customerId);

    // 6) CRM deal — atualiza estágio pra "finalizando" se existir
    await supabase
      .from("crm_deals")
      .update({ stage: "finalizando", updated_at: new Date().toISOString() })
      .eq("customer_id", customerId)
      .eq("consultant_id", consultantId);

    // 7) ROI da campanha (só se veio de campanha rastreada)
    let campaignRoi: null | {
      campaignId: string;
      leadsCount: number;
      investedCents: number;
      returnedCents: number;
      balanceCents: number;
      positive: boolean;
    } = null;

    if (customer.source_campaign_id) {
      const { count: leadsCount } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("source_campaign_id", customer.source_campaign_id);

      const { data: soldSales } = await supabase
        .from("sales")
        .select("amount_cents, customer:customers!inner(source_campaign_id)")
        .eq("status", "fechado")
        .eq("customer.source_campaign_id", customer.source_campaign_id);

      const returnedCents = (soldSales || []).reduce(
        (acc: number, s: any) => acc + Number(s.amount_cents || 0),
        0,
      );

      // Investimento real da campanha (soma facebook_metrics_daily)
      const { data: spendRows } = await supabase
        .from("facebook_metrics_daily")
        .select("spend_cents")
        .eq("campaign_id", customer.source_campaign_id);
      const investedCents = (spendRows || []).reduce(
        (acc: number, r: any) => acc + Number(r.spend_cents || 0),
        0,
      );

      campaignRoi = {
        campaignId: customer.source_campaign_id,
        leadsCount: leadsCount || 0,
        investedCents,
        returnedCents,
        balanceCents: returnedCents - investedCents,
        positive: returnedCents >= investedCents,
      };
    }

    return json({
      ok: true,
      saleId,
      pointsKwh,
      campaignRoi,
    });
  } catch (e) {
    return json({ ok: false, error: "exception", message: (e as Error).message }, 500);
  }
});
