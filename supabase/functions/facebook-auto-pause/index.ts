/**
 * Waste Guard automático (estilo pacing Meta/Google/Amazon Ads).
 *
 * Antes: só gerava recomendação (não pausava) → queimava budget.
 * Agora: pausa de verdade campanha/ad que gasta sem conversa CTWA.
 *
 * Auth: service_role JWT | apikey-only (cron) | dry_run sem pause.
 * Body opcional:
 *   { dry_run?: boolean, force_campaign_ids?: string[] }
 */
import {
  adminClient,
  corsHeaders,
  FB_GRAPH,
  loadCampaignConnection,
} from "../_shared/fb-graph.ts";
import { isConsultantLocked } from "../_shared/campaign-pause.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { notifyConsultant } from "../_shared/notify-consultant.ts";
import { notifyRodizioOnCampaignPaused } from "../_shared/rodizio-pause-notify.ts";
import {
  evaluateAdWaste,
  evaluateCampaignWaste,
  WASTE_LOOKBACK_DAYS,
  WASTE_MIN_AGE_MS,
} from "../_shared/campaign-waste-guard.ts";

async function postStatus(id: string, status: "PAUSED" | "ACTIVE", token: string) {
  const r = await fetch(`${FB_GRAPH}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status, access_token: token }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Meta ${id}: ${r.status} ${body.slice(0, 280)}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const isCron =
      isServiceRoleAuth(req) ||
      (!authHeader && !!req.headers.get("apikey"));
    if (!isCron) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body?.dry_run);
    const forceIds = Array.isArray(body?.force_campaign_ids)
      ? (body.force_campaign_ids as string[]).filter((x) => typeof x === "string")
      : [];

    const admin = adminClient();
    const since = new Date(Date.now() - WASTE_LOOKBACK_DAYS * 86400_000)
      .toISOString()
      .slice(0, 10);

    const { data: campaigns, error: campErr } = await admin
      .from("facebook_campaigns")
      .select(
        "id, name, consultant_id, status, fb_campaign_id, fb_adset_ids, fb_ad_ids, rejection_reason, started_at, created_at",
      )
      .eq("status", "active");
    if (campErr) throw campErr;

    const campList = (campaigns || []) as Array<{
      id: string;
      name: string;
      consultant_id: string;
      status: string;
      fb_campaign_id: string | null;
      fb_adset_ids: string[] | null;
      fb_ad_ids: string[] | null;
      rejection_reason: string | null;
      started_at: string | null;
      created_at: string;
    }>;

    const ids = campList.map((c) => c.id);
    const metricsByCamp = new Map<string, { spend: number; conv: number; clicks: number }>();
    if (ids.length) {
      const { data: rows } = await admin
        .from("facebook_metrics_daily")
        .select("campaign_id, spend_cents, messaging_conversations_started, clicks")
        .in("campaign_id", ids)
        .gte("date", since);
      for (const row of (rows || []) as any[]) {
        const cur = metricsByCamp.get(row.campaign_id) || { spend: 0, conv: 0, clicks: 0 };
        cur.spend += Number(row.spend_cents || 0);
        cur.conv += Number(row.messaging_conversations_started || 0);
        cur.clicks += Number(row.clicks || 0);
        metricsByCamp.set(row.campaign_id, cur);
      }
    }

    const adMetrics = new Map<string, { campaignId: string; spend: number; conv: number }>();
    {
      const { data: adRows } = await admin
        .from("facebook_ad_metrics_daily")
        .select("campaign_id, fb_ad_id, spend_cents, messaging_conversations_started")
        .in("campaign_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
        .gte("date", since);
      for (const row of (adRows || []) as any[]) {
        const key = String(row.fb_ad_id);
        const cur = adMetrics.get(key) || {
          campaignId: row.campaign_id,
          spend: 0,
          conv: 0,
        };
        cur.spend += Number(row.spend_cents || 0);
        cur.conv += Number(row.messaging_conversations_started || 0);
        adMetrics.set(key, cur);
      }
    }

    const tokenCache: Record<string, string> = {};
    async function tokenFor(consultantId: string): Promise<string | null> {
      if (tokenCache[consultantId]) return tokenCache[consultantId];
      const conn = await loadCampaignConnection(consultantId);
      if (!conn?.token) return null;
      tokenCache[consultantId] = conn.token;
      return conn.token;
    }

    let pausedCampaigns = 0;
    let pausedAds = 0;
    const actions: Array<Record<string, unknown>> = [];

    for (const c of campList) {
      if (!c.fb_campaign_id) continue;
      if (isConsultantLocked(c.rejection_reason)) {
        actions.push({ campaign_id: c.id, skipped: "locked" });
        continue;
      }

      const forced = forceIds.includes(c.id);
      const ageMs = Date.now() - new Date(c.started_at || c.created_at).getTime();
      if (!forced && ageMs < WASTE_MIN_AGE_MS) {
        actions.push({ campaign_id: c.id, skipped: "too_new", age_h: +(ageMs / 3600000).toFixed(2) });
        continue;
      }

      const m = metricsByCamp.get(c.id) || { spend: 0, conv: 0, clicks: 0 };
      let verdict = evaluateCampaignWaste({
        spendCents: m.spend,
        conversations: m.conv,
        clicks: m.clicks,
      });

      if (forced && verdict.action === "none") {
        verdict = {
          action: "pause_campaign",
          rule: "zero_conv",
          reason:
            `AUTO_PERF_PAUSE: Pausada manualmente via waste guard (forçada — queima sem lead) — só reativa no Play`,
        };
      }

      if (verdict.action === "pause_campaign") {
        const token = await tokenFor(c.consultant_id);
        if (!token) {
          actions.push({ campaign_id: c.id, error: "sem_token" });
          continue;
        }
        if (!dryRun) {
          await postStatus(c.fb_campaign_id, "PAUSED", token);
          for (const adsetId of c.fb_adset_ids || []) {
            try { await postStatus(adsetId, "PAUSED", token); } catch (_) { /* best effort */ }
          }
          for (const adId of c.fb_ad_ids || []) {
            try { await postStatus(adId, "PAUSED", token); } catch (_) { /* best effort */ }
          }
          await admin.from("facebook_campaigns").update({
            status: "paused",
            rejection_reason: verdict.reason,
            updated_at: new Date().toISOString(),
          }).eq("id", c.id);

          await admin.from("ad_recommendations").insert({
            consultant_id: c.consultant_id,
            type: "waste_guard_pause",
            title: `Pausada: ${c.name?.slice(0, 40) || c.fb_campaign_id}`,
            message: verdict.reason,
            severity: "critical",
            action_label: "Revisar campanha",
            action_payload: { kind: "review_campaign", campaign_id: c.id, rule: verdict.rule },
            applied_at: new Date().toISOString(),
          });

          try {
            await notifyConsultant(
              c.consultant_id,
              "warning",
              "Campanha pausada — waste guard 🛡️",
              verdict.reason,
            );
          } catch (_) { /* ignore */ }
          try {
            await notifyRodizioOnCampaignPaused(admin, c.id, "auto_performance");
          } catch (_) { /* ignore */ }
        }
        pausedCampaigns++;
        actions.push({
          campaign_id: c.id,
          name: c.name,
          action: "pause_campaign",
          rule: verdict.rule,
          spend: m.spend,
          conv: m.conv,
          clicks: m.clicks,
          dry_run: dryRun,
          forced,
        });
        continue;
      }

      // Ads zumbi dentro de campanha que ainda tem conversa no total
      for (const adId of c.fb_ad_ids || []) {
        const am = adMetrics.get(adId);
        if (!am) continue;
        const adVerdict = evaluateAdWaste({
          fbAdId: adId,
          spendCents: am.spend,
          conversations: am.conv,
        });
        if (adVerdict.action !== "pause_ad") continue;
        // Se a campanha inteira já está sem conversa, a regra de cima já cuidou.
        if (m.conv <= 0 && m.spend >= 800) continue;

        const token = await tokenFor(c.consultant_id);
        if (!token) continue;
        if (!dryRun) {
          await postStatus(adId, "PAUSED", token);
          await admin.from("ad_creative_performance").update({
            paused_by_ai_at: new Date().toISOString(),
            is_loser: true,
          }).eq("fb_ad_id", adId);
          await admin.from("ad_recommendations").insert({
            consultant_id: c.consultant_id,
            type: "waste_guard_ad_pause",
            title: `Ad zumbi pausado ${adId}`,
            message: adVerdict.reason,
            severity: "warning",
            action_label: "Revisar criativo",
            action_payload: { kind: "review_creative", campaign_id: c.id, fb_ad_id: adId },
            applied_at: new Date().toISOString(),
          });
        }
        pausedAds++;
        actions.push({
          campaign_id: c.id,
          fb_ad_id: adId,
          action: "pause_ad",
          spend: am.spend,
          conv: am.conv,
          dry_run: dryRun,
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        lookback_days: WASTE_LOOKBACK_DAYS,
        scanned: campList.length,
        paused_campaigns: pausedCampaigns,
        paused_ads: pausedAds,
        actions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
