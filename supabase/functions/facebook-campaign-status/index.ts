// Verifica status ao vivo de uma campanha na Meta Graph API.
// Retorna effective_status da campanha, adsets e ads + último horário de impressão.
// Usado pelo painel "Está funcionando?" no card da campanha.
import { adminClient, authConsultant, corsHeaders, fbFetch, loadCampaignConnection } from "../_shared/fb-graph.ts";
import { resolveCampaignEffectiveStatus, type MetaObjectState } from "../_shared/campaign-effective-status.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authConsultant(req);
    if (!auth) return j({ error: "Unauthorized" }, 401);
    const { campaign_id } = await req.json().catch(() => ({}));
    if (!campaign_id) return j({ error: "campaign_id obrigatório" }, 400);

    const admin = adminClient();
    const { data: c } = await admin
      .from("facebook_campaigns")
      .select("id, consultant_id, fb_campaign_id, fb_adset_ids, fb_ad_ids, status, created_at")
      .eq("id", campaign_id)
      .maybeSingle();
    if (!c) return j({ error: "Campanha não encontrada" }, 404);
    if (c.consultant_id !== auth.id) return j({ error: "Forbidden" }, 403);
    if (!c.fb_campaign_id) {
      return j({
        delivery: "not_published",
        campaign_status: c.status,
        adset_status: null,
        ad_status: null,
        issues: [],
        last_impression_at: null,
        impressions_24h: 0,
        impressions_7d: 0,
        message: "Ainda não publicada na Meta",
      });
    }

    const conn = await loadCampaignConnection(c.consultant_id);
    if (!conn?.token) return j({ error: "Sem conexão Meta" }, 500);
    const token = conn.token;

    // 1) Status ao vivo da campanha + todos os adsets e anúncios
    const [camp, adsets, ads] = await Promise.all([
      fbFetch(`/${c.fb_campaign_id}?fields=effective_status,issues_info,configured_status&access_token=${encodeURIComponent(token)}`).catch((e) => ({ _err: e?.message })),
      Promise.all(((c.fb_adset_ids || []) as string[]).map((id) =>
        fbFetch(`/${id}?fields=effective_status,issues_info,configured_status&access_token=${encodeURIComponent(token)}`).catch(() => null)
      )),
      Promise.all(((c.fb_ad_ids || []) as string[]).map((id) =>
        fbFetch(`/${id}?fields=effective_status,issues_info,configured_status&access_token=${encodeURIComponent(token)}`).catch(() => null)
      )),
    ]);
    const normalizedAdsets = adsets.map((item) => item || { effective_status: "UNKNOWN" }) as MetaObjectState[];
    const normalizedAds = ads.map((item) => item || { effective_status: "UNKNOWN" }) as MetaObjectState[];
    const resolved = resolveCampaignEffectiveStatus(camp as MetaObjectState, normalizedAdsets, normalizedAds);

    // 2) Insights ao vivo: impressões hoje + últimos 7 dias
    const insightsToday = await fbFetch(
      `/${c.fb_campaign_id}/insights?fields=impressions,clicks,spend&date_preset=today&access_token=${encodeURIComponent(token)}`,
    ).catch(() => ({ data: [] }));
    const insights7d = await fbFetch(
      `/${c.fb_campaign_id}/insights?fields=impressions,clicks,spend&date_preset=last_7d&access_token=${encodeURIComponent(token)}`,
    ).catch(() => ({ data: [] }));

    const todayRow = insightsToday?.data?.[0] || {};
    const weekRow = insights7d?.data?.[0] || {};
    const impressions24h = Number(todayRow.impressions || 0);
    const impressions7d = Number(weekRow.impressions || 0);

    const issues = resolved.issues;

    // Veredito combinado: campanha, todos os conjuntos e todos os anúncios.
    const campStatus = resolved.campaignEffectiveStatus;
    const adsetStatuses = normalizedAdsets.map((item) => item.effective_status || "UNKNOWN");
    const adStatuses = normalizedAds.map((item) => item.effective_status || "UNKNOWN");
    const adsetStatus = adsetStatuses[0] || null;
    const adStatus = adStatuses[0] || null;
    const ageHours = (Date.now() - new Date(c.created_at).getTime()) / 3_600_000;

    let delivery: "delivering" | "warming" | "no_delivery" | "paused" | "rejected" | "review" = "no_delivery";
    let message = "";

    if (resolved.localStatus === "rejected") {
      delivery = "rejected";
      message = "Anúncio com pendência ou reprovação na Meta";
    } else if (resolved.localStatus === "paused") {
      delivery = "paused";
      message = "Pausado";
    } else if (resolved.localStatus === "pending_review") {
      delivery = "review";
      message = "Em análise ou processamento na Meta";
    } else if (resolved.localStatus === "active") {
      if (impressions24h > 0) {
        delivery = "delivering";
        message = `Entregando — ${impressions24h.toLocaleString("pt-BR")} impressões hoje`;
      } else if (ageHours < 24) {
        delivery = "warming";
        message = "Aquecendo — Meta começa a entregar em até 24h";
      } else {
        delivery = "no_delivery";
        message = "Ativa mas sem entregar — verifique pagamento ou aumente orçamento";
      }
    } else {
      message = `Status Meta: ${campStatus}`;
    }

    return j({
      delivery,
      message,
      campaign_status: campStatus,
      adset_status: adsetStatus,
      ad_status: adStatus,
      adset_statuses: adsetStatuses,
      ad_statuses: adStatuses,
      resolved_local_status: resolved.localStatus,
      issues,
      impressions_24h: impressions24h,
      impressions_7d: impressions7d,
      clicks_24h: Number(todayRow.clicks || 0),
      spend_24h_cents: Math.round(Number(todayRow.spend || 0) * 100),
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[campaign-status]", e);
    return j({ error: (e as Error).message }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
