// Meta Ads metrics — agrega métricas por campanha pro Painel_Meta_Ads.
// GET /meta-ads-metrics?from=2025-04-01&to=2025-05-01[&campaign_id=uuid]
//
// Retorna:
//   - by_campaign: [{campaign_id, name, status, leads_received, leads_converted, conversion_rate, cac, total_cost_cents}]
//   - leads_for_campaign (quando campaign_id passado)
//
// Reqs: 9.1 a 9.8.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const consultantId = user.id;

    const url = new URL(req.url);
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));
    const campaignId = url.searchParams.get("campaign_id");
    const page = Math.max(0, parseInt(url.searchParams.get("page") || "0", 10));
    const PAGE_SIZE = 50;

    // Validações de range (Req 9.4)
    if (!from || !to) {
      return new Response(JSON.stringify({ error: "from e to são obrigatórios (YYYY-MM-DD)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (from > to) {
      return new Response(JSON.stringify({ error: "from deve ser anterior a to" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const days = Math.ceil((to.getTime() - from.getTime()) / (24 * 3600 * 1000));
    if (days > 365) {
      return new Response(JSON.stringify({ error: "Intervalo máximo: 365 dias" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detalhe de uma campanha específica (Req 9.5)
    if (campaignId) {
      const { data: leads } = await supabase
        .from("customers")
        .select("id, name, phone_whatsapp, conversation_step, status, created_at, source_campaign_id, source_ad_id, ctwa_clid, source_ctwa_clid")
        .eq("consultant_id", consultantId)
        .eq("source_campaign_id", campaignId)
        .or("source_ad_id.not.is.null,ctwa_clid.not.is.null,source_ctwa_clid.not.is.null")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Total
      const { count: total } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("consultant_id", consultantId)
        .eq("source_campaign_id", campaignId)
        .or("source_ad_id.not.is.null,ctwa_clid.not.is.null,source_ctwa_clid.not.is.null")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString());

      // Custo total no intervalo pra essa campanha
      const { data: costRows } = await supabase
        .from("facebook_metrics_daily")
        .select("spend_cents")
        .eq("campaign_id", campaignId)
        .gte("date", from.toISOString().slice(0, 10))
        .lt("date", to.toISOString().slice(0, 10));
      const totalCostCents = ((costRows as any[]) || []).reduce(
        (sum, r) => sum + Number(r.spend_cents || 0),
        0,
      );
      const costPerLead = leads && leads.length > 0 && total
        ? totalCostCents / total
        : null;

      return new Response(JSON.stringify({
        campaign_id: campaignId,
        leads,
        total,
        total_cost_cents: totalCostCents,
        cost_per_lead_cents: costPerLead,
        page,
        page_size: PAGE_SIZE,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Métricas agregadas por campanha (Req 9.1-9.3)
    const { data: campaigns } = await supabase
      .from("facebook_campaigns")
      .select("id, name, status, created_at")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false });

    if (!campaigns || campaigns.length === 0) {
      return new Response(JSON.stringify({ by_campaign: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const campaignIds = (campaigns as any[]).map((c) => c.id);

    // Leads recebidos por campanha — só com prova Meta (AD id / CTWA)
    const { data: leadsAgg } = await supabase
      .from("customers")
      .select("source_campaign_id, status, source_ad_id, ctwa_clid, source_ctwa_clid")
      .eq("consultant_id", consultantId)
      .in("source_campaign_id", campaignIds)
      .or("source_ad_id.not.is.null,ctwa_clid.not.is.null,source_ctwa_clid.not.is.null")
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString());

    const leadCount = new Map<string, { received: number; converted: number }>();
    for (const l of (leadsAgg as any[]) || []) {
      const proven = !!(l.source_ad_id || l.ctwa_clid || l.source_ctwa_clid);
      if (!proven) continue;
      const cid = l.source_campaign_id;
      if (!leadCount.has(cid)) leadCount.set(cid, { received: 0, converted: 0 });
      const entry = leadCount.get(cid)!;
      entry.received++;
      if (l.status === "approved") entry.converted++;
    }

    // Custos por campanha no intervalo (1 query)
    const { data: metricsAgg } = await supabase
      .from("facebook_metrics_daily")
      .select("campaign_id, spend_cents")
      .in("campaign_id", campaignIds)
      .gte("date", from.toISOString().slice(0, 10))
      .lt("date", to.toISOString().slice(0, 10));

    const costByCampaign = new Map<string, number>();
    for (const m of (metricsAgg as any[]) || []) {
      const prev = costByCampaign.get(m.campaign_id) || 0;
      costByCampaign.set(m.campaign_id, prev + Number(m.spend_cents || 0));
    }

    const byCampaign = (campaigns as any[]).map((c) => {
      const counts = leadCount.get(c.id) || { received: 0, converted: 0 };
      const cost = costByCampaign.get(c.id) || 0;
      const conversionRate = counts.received > 0
        ? Number(((counts.converted / counts.received) * 100).toFixed(2))
        : 0;
      const cac = counts.converted > 0 ? cost / counts.converted : null;
      return {
        campaign_id: c.id,
        name: c.name,
        status: c.status,
        leads_received: counts.received,
        leads_converted: counts.converted,
        conversion_rate: conversionRate,
        cac_cents: cac,
        total_cost_cents: cost,
      };
    });

    return new Response(JSON.stringify({ by_campaign: byCampaign }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
