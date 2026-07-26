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
  FB_GRAPH,
  loadCampaignConnection,
} from "../_shared/fb-graph.ts";
import { buildCors } from "../_shared/cors.ts";
import {
  assertCronAuthStrict,
  cronAuthUnauthorized,
} from "../_shared/cron-auth.ts";
import { isAdsExpansiveMutationAllowed } from "../_shared/brain-config.ts";
import {
  LEGACY_ANCHOR_CAMPAIGN_ID,
  resolveAnchorCampaignId,
} from "../_shared/ads-anchor.ts";
import { isConsultantLocked } from "../_shared/campaign-pause.ts";
import { notifyAnchorBudgetScale, notifyCerebroWhatsApp } from "../_shared/notify-consultant.ts";
import { notifyRodizioOnCampaignPaused } from "../_shared/rodizio-pause-notify.ts";
import { formatCerebroWastePauseWhatsApp } from "../_shared/cerebro-notify-format.ts";
import {
  evaluateAdWaste,
  evaluateCampaignWaste,
  WASTE_LOOKBACK_DAYS,
  WASTE_MIN_AGE_MS,
} from "../_shared/campaign-waste-guard.ts";
import {
  decideAnchorBudgetScale,
  formatAnchorScaleDownWhatsApp,
  formatAnchorScaleUpWhatsApp,
} from "../_shared/brain-budget-scale.ts";

async function postBudget(
  fbCampaignId: string,
  dailyBudgetCents: number,
  token: string,
) {
  const r = await fetch(`${FB_GRAPH}/${fbCampaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      daily_budget: String(dailyBudgetCents),
      access_token: token,
    }),
  });
  const body = await r.text();
  if (!r.ok) {
    throw new Error(
      `budget ${fbCampaignId}: ${r.status} ${body.slice(0, 240)}`,
    );
  }
}

function campaignCityLabel(name: string, cities: unknown): string {
  if (
    Array.isArray(cities) && cities[0] &&
    typeof (cities[0] as any).name === "string"
  ) {
    return String((cities[0] as any).name);
  }
  const raw = String(name || "Campanha")
    .replace(/\[CONS-[^\]]+\]/gi, "")
    .replace(/^MG-ROT-/i, "")
    .split(/\s*[·—–]\s*/)[0]
    .trim();
  return raw.slice(0, 40) || "Campanha";
}

/**
 * MG-ROT e âncora do Cérebro MG: escala de budget é do rotator, não do
 * brain_scale por campanha. Âncora = brain_config.anchor_campaign_id do
 * consultor (+ UUID legado). Não bloqueia campanha parceiro só por cidade/UDI.
 */
function isMgRotOrAnchor(
  id: string,
  name: string,
  consultantId: string,
  brainConfig: unknown,
): boolean {
  if (/^MG-ROT-/i.test(String(name || ""))) return true;
  if (id === LEGACY_ANCHOR_CAMPAIGN_ID) return true;
  const anchor = resolveAnchorCampaignId(
    consultantId,
    (brainConfig && typeof brainConfig === "object"
      ? brainConfig as { anchor_campaign_id?: string | null }
      : null),
  );
  return Boolean(anchor) && id === anchor;
}

async function postStatus(
  id: string,
  status: "PAUSED" | "ACTIVE",
  token: string,
) {
  const r = await fetch(`${FB_GRAPH}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status, access_token: token }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Meta ${id}: ${r.status} ${body.slice(0, 280)}`);
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(req, "x-service-secret, x-internal-secret");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const admin = adminClient();
    const cronAuth = await assertCronAuthStrict(req, admin);
    if (!cronAuth.ok) return cronAuthUnauthorized(cronAuth.reason, corsHeaders);

    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body?.dry_run);
    const forceIds = Array.isArray(body?.force_campaign_ids)
      ? (body.force_campaign_ids as string[]).filter((x) =>
        typeof x === "string"
      )
      : [];

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

    const automationConfigByConsultant = new Map<string, unknown>();
    const consultantIds = Array.from(
      new Set(campList.map((campaign) => campaign.consultant_id)),
    );
    if (consultantIds.length > 0) {
      const { data: automationSettings } = await admin
        .from("consultant_ad_settings")
        .select("consultant_id, brain_config")
        .in("consultant_id", consultantIds);
      for (const row of automationSettings || []) {
        automationConfigByConsultant.set(row.consultant_id, row.brain_config);
      }
    }

    const ids = campList.map((c) => c.id);
    const metricsByCamp = new Map<
      string,
      { spend: number; conv: number; clicks: number }
    >();
    if (ids.length) {
      const { data: rows } = await admin
        .from("facebook_metrics_daily")
        .select(
          "campaign_id, spend_cents, messaging_conversations_started, clicks",
        )
        .in("campaign_id", ids)
        .gte("date", since);
      for (const row of (rows || []) as any[]) {
        const cur = metricsByCamp.get(row.campaign_id) ||
          { spend: 0, conv: 0, clicks: 0 };
        cur.spend += Number(row.spend_cents || 0);
        cur.conv += Number(row.messaging_conversations_started || 0);
        cur.clicks += Number(row.clicks || 0);
        metricsByCamp.set(row.campaign_id, cur);
      }
    }

    const adMetrics = new Map<
      string,
      { campaignId: string; spend: number; conv: number }
    >();
    {
      const { data: adRows } = await admin
        .from("facebook_ad_metrics_daily")
        .select(
          "campaign_id, fb_ad_id, spend_cents, messaging_conversations_started",
        )
        .in(
          "campaign_id",
          ids.length ? ids : ["00000000-0000-0000-0000-000000000000"],
        )
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
      // Waste guard é PROTETIVO: só pausa, nunca amplia gasto. Por isso NÃO
      // passa pelo gate de automação — desligá-lo deixaria a campanha
      // queimando verba sem lead, que é justamente o que ele existe pra evitar.
      if (isConsultantLocked(c.rejection_reason)) {
        actions.push({ campaign_id: c.id, skipped: "locked" });
        continue;
      }

      const forced = forceIds.includes(c.id);
      const ageMs = Date.now() -
        new Date(c.started_at || c.created_at).getTime();
      if (!forced && ageMs < WASTE_MIN_AGE_MS) {
        actions.push({
          campaign_id: c.id,
          skipped: "too_new",
          age_h: +(ageMs / 3600000).toFixed(2),
        });
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
            try {
              await postStatus(adsetId, "PAUSED", token);
            } catch (_) { /* best effort */ }
          }
          for (const adId of c.fb_ad_ids || []) {
            try {
              await postStatus(adId, "PAUSED", token);
            } catch (_) { /* best effort */ }
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
            action_payload: {
              kind: "review_campaign",
              campaign_id: c.id,
              rule: verdict.rule,
            },
            applied_at: new Date().toISOString(),
          });

          try {
            await notifyCerebroWhatsApp(
              c.consultant_id,
              formatCerebroWastePauseWhatsApp({
                campaignName: c.name || c.fb_campaign_id || "Campanha",
                reason: verdict.reason,
                spendCents: m.spend,
                conversations: m.conv,
                clicks: m.clicks,
                rule: verdict.rule,
              }),
            );
          } catch (_) { /* ignore */ }
          try {
            await notifyRodizioOnCampaignPaused(
              admin,
              c.id,
              "auto_performance",
            );
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
      const adIds = (c.fb_ad_ids || []) as string[];
      let alreadyPausedAds = new Set<string>();
      if (adIds.length) {
        const { data: pausedRows } = await admin
          .from("ad_creative_performance")
          .select("fb_ad_id")
          .in("fb_ad_id", adIds)
          .not("paused_by_ai_at", "is", null);
        alreadyPausedAds = new Set(
          (pausedRows || []).map((r: any) => String(r.fb_ad_id)),
        );
      }
      for (const adId of adIds) {
        if (alreadyPausedAds.has(String(adId))) continue;
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
            action_payload: {
              kind: "review_creative",
              campaign_id: c.id,
              fb_ad_id: adId,
            },
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

    // Autopilot Cérebro: após waste, alinha slots + escala âncora (consultores com flag)
    let brainTicks: Array<Record<string, unknown>> = [];
    if (!dryRun) {
      try {
        const { data: settings } = await admin
          .from("consultant_ad_settings")
          .select("consultant_id, brain_config")
          .not("brain_config", "is", null);
        const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const base = Deno.env.get("SUPABASE_URL") || "";
        for (const row of settings || []) {
          const bc = (row as any).brain_config;
          // Slots/escala são EXPANSIVOS: seguem fail-closed no gate.
          if (!isAdsExpansiveMutationAllowed(bc)) continue;
          // Rank primeiro: preferred_slugs aprendido → rotator aplica.
          try {
            await fetch(`${base}/functions/v1/campaign-brain-rank`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${sr}`,
                apikey: sr,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                consultant_id: row.consultant_id,
                action: "rank",
              }),
            });
          } catch (_) { /* rank best-effort */ }
          const r = await fetch(
            `${base}/functions/v1/facebook-mg-city-rotator`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${sr}`,
                apikey: sr,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                consultant_id: row.consultant_id,
                ensure_active_slots: true,
                seed: false,
              }),
            },
          );
          const resp = await r.json().catch(() => ({}));
          // Seed controlado (1/tick) — separado do ensure para não misturar timeout.
          let seedResp: Record<string, unknown> = {};
          try {
            const sr2 = await fetch(
              `${base}/functions/v1/facebook-mg-city-rotator`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${sr}`,
                  apikey: sr,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  consultant_id: row.consultant_id,
                  seed: true,
                  activate_next: true,
                  ensure_active_slots: false,
                }),
              },
            );
            seedResp = await sr2.json().catch(() => ({}));
          } catch (e) {
            seedResp = { error: (e as Error).message };
          }
          brainTicks.push({
            consultant_id: row.consultant_id,
            status: r.status,
            ok: r.ok,
            ensured: (resp as any)?.ensured,
            seed_created: (seedResp as any)?.created,
            seed_log: ((seedResp as any)?.log || []).filter((x: any) =>
              String(x?.action || "").startsWith("seed") ||
              x?.would_seed ||
              x?.skipped === "already_seeded" ||
              x?.action === "seed_failed" ||
              x?.action === "seed_skipped"
            ).slice(0, 8),
            seed_ok: (seedResp as any)?.ok === true,
            seed_error: (seedResp as any)?.error || null,
          });
        }
      } catch (e) {
        brainTicks.push({ error: (e as Error).message });
      }
    }

    // Cérebro por campanha (parceiro / outras cidades — NÃO MG-ROT nem âncora)
    const campaignScaleTicks: Array<Record<string, unknown>> = [];
    try {
      const { data: scaleCamps } = await admin
        .from("facebook_campaigns")
        .select(
          "id, name, consultant_id, status, fb_campaign_id, daily_budget_cents, cities, brain_scale_enabled, brain_scale_step_pct, brain_scale_max_budget_cents, brain_scale_target_cpl_cents, brain_scale_last_at",
        )
        .eq("brain_scale_enabled", true)
        .eq("status", "active");

      const walletCache = new Map<string, number>();
      async function liquidFor(consultantId: string): Promise<number> {
        if (walletCache.has(consultantId)) {
          return walletCache.get(consultantId)!;
        }
        const { data: wallet } = await admin
          .from("consultant_wallet")
          .select("balance_cents, debt_cents")
          .eq("consultant_id", consultantId)
          .maybeSingle();
        const liquid = Math.max(
          0,
          Number(wallet?.balance_cents || 0) - Number(wallet?.debt_cents || 0),
        );
        walletCache.set(consultantId, liquid);
        return liquid;
      }

      for (const c of (scaleCamps || []) as any[]) {
        if (
          !dryRun &&
          !isAdsExpansiveMutationAllowed(
            automationConfigByConsultant.get(c.consultant_id),
          )
        ) {
          campaignScaleTicks.push({
            id: c.id,
            skipped: "ads_automation_disabled",
          });
          continue;
        }
        if (
          isMgRotOrAnchor(
            String(c.id),
            String(c.name || ""),
            String(c.consultant_id),
            automationConfigByConsultant.get(c.consultant_id),
          )
        ) {
          campaignScaleTicks.push({ id: c.id, skipped: "mg_rot_or_anchor" });
          continue;
        }
        if (!c.fb_campaign_id) {
          campaignScaleTicks.push({ id: c.id, skipped: "no_fb_id" });
          continue;
        }

        const sinceScale = new Date(Date.now() - 2 * 24 * 3600 * 1000)
          .toISOString().slice(0, 10);
        const { data: metrics } = await admin
          .from("facebook_metrics_daily")
          .select("spend_cents, messaging_conversations_started")
          .eq("campaign_id", c.id)
          .gte("date", sinceScale);
        const spend = (metrics || []).reduce(
          (s: number, r: any) => s + Number(r.spend_cents || 0),
          0,
        );
        const conv = (metrics || []).reduce(
          (s: number, r: any) =>
            s + Number(r.messaging_conversations_started || 0),
          0,
        );
        const cpl = conv > 0 ? Math.round(spend / conv) : null;
        const fromBudget = Number(c.daily_budget_cents) || 517;
        const stepPct = Math.max(
          15,
          Math.min(30, Number(c.brain_scale_step_pct) || 15),
        );
        let decision = decideAnchorBudgetScale({
          currentBudgetCents: fromBudget,
          maxBudgetCents: Number(c.brain_scale_max_budget_cents) || 50000,
          targetCplCents: Number(c.brain_scale_target_cpl_cents) || 200,
          recentCplCents: cpl,
          recentConversations: conv,
          recentSpendCents: spend,
          stepPct,
          lastScaleAtIso: c.brain_scale_last_at || null,
          minHoursBetweenScaleUps: 4,
        });

        const liquid = await liquidFor(c.consultant_id);
        if (decision.action === "scale_up" && liquid < decision.budgetCents) {
          decision = {
            action: "hold",
            budgetCents: fromBudget,
            reason: `CPL ok, mas saldo R$ ${
              (liquid / 100).toFixed(2)
            } < orçamento R$ ${
              (decision.budgetCents / 100).toFixed(2)
            } — não sobe`,
          };
        }

        const tick: Record<string, unknown> = {
          id: c.id,
          name: c.name,
          action: decision.action,
          reason: decision.reason,
          from: fromBudget,
          to: decision.budgetCents,
          cpl,
          conv,
          spend,
          liquid,
          dry_run: dryRun,
        };

        if (decision.action === "hold" || decision.budgetCents === fromBudget) {
          campaignScaleTicks.push(tick);
          continue;
        }

        if (!dryRun) {
          const token = await tokenFor(c.consultant_id);
          if (!token) {
            tick.error = "no_meta_token";
            campaignScaleTicks.push(tick);
            continue;
          }
          try {
            await postBudget(c.fb_campaign_id, decision.budgetCents, token);
            await admin.from("facebook_campaigns").update({
              daily_budget_cents: decision.budgetCents,
              brain_scale_last_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq("id", c.id);

            const cityLabel = campaignCityLabel(c.name, c.cities);
            const text = decision.action === "scale_up"
              ? formatAnchorScaleUpWhatsApp({
                fromCents: fromBudget,
                toCents: decision.budgetCents,
                stepPct,
                walletLiquidCents: liquid,
                cplCents: cpl,
                conversations: conv,
                spendCents: spend,
                targetCplCents: Number(c.brain_scale_target_cpl_cents) || 200,
                reason: decision.reason,
                cityLabel,
              })
              : formatAnchorScaleDownWhatsApp({
                fromCents: fromBudget,
                toCents: decision.budgetCents,
                stepPct,
                walletLiquidCents: liquid,
                cplCents: cpl,
                conversations: conv,
                spendCents: spend,
                targetCplCents: Number(c.brain_scale_target_cpl_cents) || 200,
                reason: decision.reason,
                cityLabel,
              });
            const ok = await notifyAnchorBudgetScale(c.consultant_id, text);
            tick.notify_ok = ok;
          } catch (e) {
            tick.error = (e as Error).message;
          }
        }
        campaignScaleTicks.push(tick);
      }
    } catch (e) {
      campaignScaleTicks.push({ error: (e as Error).message });
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
        brain_ticks: brainTicks,
        campaign_scale_ticks: campaignScaleTicks,
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
