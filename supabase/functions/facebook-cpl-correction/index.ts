// Correção pontual CPL: pausa campanhas caras, deixa só o ad vencedor de
// Uberlândia ativo, baixa budget e restringe placements (sem FB Reels).
// Auth: service_role apenas.
import {
  adminClient,
  FB_GRAPH,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import { buildCors } from "../_shared/cors.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import {
  LEGACY_ANCHOR_CAMPAIGN_ID,
  LEGACY_MG_CONSULTANT_ID,
} from "../_shared/ads-anchor.ts";
// Fonte única dos ids legados (ver `_shared/ads-anchor.ts`).
const CONSULTANT_ID = LEGACY_MG_CONSULTANT_ID;
const UBERLANDIA_CAMPAIGN_ID = LEGACY_ANCHOR_CAMPAIGN_ID;
/** Ad vencedor (~R$ 1,11/conversa). */
const KEEP_AD_ID = "120246485792970645";
/** Budget alvo: R$ 18/dia (faixa 15–18 da estratégia). */
const TARGET_DAILY_BUDGET_CENTS = 1800;

const PAUSE_CAMPAIGN_IDS = [
  "f2477d65-07ed-4f8c-a0a3-0f59815bc081", // Uberaba
  "30f2f397-4b7e-4a7c-8798-4c390df3b55b", // BH
  "6d5d43b8-91bf-4883-8d53-4479859d8c47", // Brasilândia RM
  "c2530550-8281-468f-bb6b-16127ff2420d", // Horacio Brasilândia
];

function j(req: Request, body: unknown, status = 200) {
  const cors = buildCors(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function postMeta(
  id: string,
  fields: Record<string, string>,
  token: string,
): Promise<{ ok: boolean; body: string }> {
  const r = await fetch(`${FB_GRAPH}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, access_token: token }),
  });
  const body = await r.text();
  return { ok: r.ok, body: body.slice(0, 500) };
}

async function getMeta(
  id: string,
  fields: string,
  token: string,
): Promise<any> {
  const r = await fetch(
    `${FB_GRAPH}/${id}?fields=${encodeURIComponent(fields)}&access_token=${
      encodeURIComponent(token)
    }`,
  );
  if (!r.ok) {
    throw new Error(`GET ${id}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
  return r.json();
}

Deno.serve(async (req) => {
  const cors = buildCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!isServiceRoleAuth(req)) return j(req, { error: "unauthorized" }, 401);

  // Mutador pontual legado: preservado para auditoria, mas permanentemente
  // inerte até ser parametrizado e passar pela policy central.
  const legacyMutatorEnabled = false;
  if (!legacyMutatorEnabled) {
    return j(req, { ok: true, skipped: "legacy_mutator_disabled" });
  }

  const admin = adminClient();
  const platform = await loadPlatformAccount();
  if (!platform?.token) {
    return j(req, { error: "Sem token Meta da plataforma" }, 502);
  }
  const token = platform.token;

  const log: Array<Record<string, unknown>> = [];
  const pauseReason =
    "MANUAL_PAUSE: Correção CPL — só Uberlândia vencedor ativo; demais pausados";

  try {
    // 1) Pausar outras campanhas (Meta + DB)
    for (const campaignId of PAUSE_CAMPAIGN_IDS) {
      const { data: c } = await admin
        .from("facebook_campaigns")
        .select(
          "id, name, status, fb_campaign_id, fb_adset_ids, fb_ad_ids, consultant_id",
        )
        .eq("id", campaignId)
        .maybeSingle();
      if (!c || c.consultant_id !== CONSULTANT_ID) {
        log.push({
          step: "pause_campaign",
          campaignId,
          skipped: "not_found_or_wrong_consultant",
        });
        continue;
      }
      if (c.status === "paused" || c.status === "completed") {
        log.push({
          step: "pause_campaign",
          campaignId,
          skipped: "already_paused",
          status: c.status,
        });
        continue;
      }
      const metaErrors: string[] = [];
      if (c.fb_campaign_id) {
        const ids = [
          c.fb_campaign_id,
          ...((c.fb_adset_ids || []) as string[]),
          ...((c.fb_ad_ids || []) as string[]),
        ];
        // Campanha primeiro
        const campRes = await postMeta(
          c.fb_campaign_id,
          { status: "PAUSED" },
          token,
        );
        if (!campRes.ok) metaErrors.push(`campaign:${campRes.body}`);
        for (const adsetId of (c.fb_adset_ids || []) as string[]) {
          const r = await postMeta(adsetId, { status: "PAUSED" }, token);
          if (!r.ok) metaErrors.push(`adset ${adsetId}:${r.body}`);
        }
        for (const adId of (c.fb_ad_ids || []) as string[]) {
          const r = await postMeta(adId, { status: "PAUSED" }, token);
          if (!r.ok) metaErrors.push(`ad ${adId}:${r.body}`);
        }
        void ids;
      }
      if (metaErrors.length) {
        log.push({
          step: "pause_campaign",
          campaignId,
          name: c.name,
          error: metaErrors,
        });
        continue;
      }
      const { error: updErr } = await admin.from("facebook_campaigns").update({
        status: "paused",
        rejection_reason: pauseReason,
        updated_at: new Date().toISOString(),
      }).eq("id", c.id);
      log.push({
        step: "pause_campaign",
        campaignId,
        name: c.name,
        ok: !updErr,
        db_error: updErr?.message ?? null,
      });
    }

    // 2) Uberlândia: pausar ads que não são o vencedor; garantir vencedor ACTIVE
    const { data: udi } = await admin
      .from("facebook_campaigns")
      .select(
        "id, fb_campaign_id, fb_adset_ids, fb_ad_ids, daily_budget_cents, status",
      )
      .eq("id", UBERLANDIA_CAMPAIGN_ID)
      .maybeSingle();
    if (!udi?.fb_campaign_id) {
      return j(req, { error: "Campanha Uberlândia não encontrada", log }, 404);
    }

    const adIds = (udi.fb_ad_ids || []) as string[];
    const pauseAds = adIds.filter((id) => id !== KEEP_AD_ID);
    for (const adId of pauseAds) {
      const r = await postMeta(adId, { status: "PAUSED" }, token);
      log.push({
        step: "pause_ad",
        adId,
        ok: r.ok,
        body: r.ok ? null : r.body,
      });
      if (r.ok) {
        await admin.from("ad_creative_performance").update({
          paused_by_ai_at: new Date().toISOString(),
          is_loser: adId === "120246485792650645",
        }).eq("fb_ad_id", adId);
      }
    }
    const keepRes = await postMeta(KEEP_AD_ID, { status: "ACTIVE" }, token);
    log.push({
      step: "keep_ad_active",
      adId: KEEP_AD_ID,
      ok: keepRes.ok,
      body: keepRes.ok ? null : keepRes.body,
    });

    // Garantir campanha + adset ACTIVE
    for (const adsetId of (udi.fb_adset_ids || []) as string[]) {
      const r = await postMeta(adsetId, { status: "ACTIVE" }, token);
      log.push({
        step: "activate_adset",
        adsetId,
        ok: r.ok,
        body: r.ok ? null : r.body,
      });
    }
    const campAct = await postMeta(
      udi.fb_campaign_id,
      { status: "ACTIVE" },
      token,
    );
    log.push({
      step: "activate_campaign",
      ok: campAct.ok,
      body: campAct.ok ? null : campAct.body,
    });

    // 3) Budget R$ 18/dia
    const budgetRes = await postMeta(
      udi.fb_campaign_id,
      { daily_budget: String(TARGET_DAILY_BUDGET_CENTS) },
      token,
    );
    log.push({
      step: "set_budget",
      from: udi.daily_budget_cents,
      to: TARGET_DAILY_BUDGET_CENTS,
      ok: budgetRes.ok,
      body: budgetRes.ok ? null : budgetRes.body,
    });
    if (budgetRes.ok) {
      await admin.from("facebook_campaigns").update({
        daily_budget_cents: TARGET_DAILY_BUDGET_CENTS,
        status: "active",
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      }).eq("id", UBERLANDIA_CAMPAIGN_ID);
    }

    // 4) Placements manuais sem Facebook Reels (mantém Feed/Stories FB + IG)
    const adsetIds = (udi.fb_adset_ids || []) as string[];
    for (const adsetId of adsetIds) {
      try {
        const current = await getMeta(adsetId, "targeting", token);
        const targeting = { ...(current.targeting || {}) };
        targeting.publisher_platforms = ["facebook", "instagram"];
        // Sem Facebook Reels (waste observado). Mantém Feed/Stories/Marketplace/Search + IG.
        targeting.facebook_positions = [
          "feed",
          "story",
          "marketplace",
          "search",
        ];
        targeting.instagram_positions = ["stream", "story", "reels", "explore"];
        const r = await postMeta(adsetId, {
          targeting: JSON.stringify(targeting),
        }, token);
        log.push({
          step: "placements_no_fb_reels",
          adsetId,
          ok: r.ok,
          body: r.ok ? null : r.body,
        });
      } catch (e) {
        log.push({
          step: "placements_no_fb_reels",
          adsetId,
          ok: false,
          body: (e as Error).message,
        });
      }
    }

    // 5) Recomendação auditável
    await admin.from("ad_recommendations").insert({
      consultant_id: CONSULTANT_ID,
      type: "cpl_correction_applied",
      title: "Correção CPL aplicada: só Uberlândia vencedor",
      message:
        `Pausadas BH/Uberaba/Brasilândia. Em Uberlândia ficou só o ad ${KEEP_AD_ID}. Budget R$ ${
          (TARGET_DAILY_BUDGET_CENTS / 100).toFixed(2)
        }/dia. FB Reels removido.`,
      severity: "success",
      action_label: "Ver campanha",
      action_payload: {
        kind: "review_campaign",
        campaign_id: UBERLANDIA_CAMPAIGN_ID,
      },
      applied_at: new Date().toISOString(),
    });

    const failed = log.filter((x) => x.ok === false);
    return j(req, {
      ok: failed.length === 0,
      keep_ad: KEEP_AD_ID,
      budget_cents: TARGET_DAILY_BUDGET_CENTS,
      paused_campaigns: PAUSE_CAMPAIGN_IDS,
      failed_steps: failed.length,
      log,
    }, failed.length ? 207 : 200);
  } catch (e) {
    return j(req, { error: (e as Error).message, log }, 500);
  }
});
