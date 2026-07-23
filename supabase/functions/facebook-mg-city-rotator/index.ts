/**
 * Rotação MG inteira — âncora Uberlândia + N exploradoras.
 *
 * Body:
 *  {
 *    seed?: boolean,
 *    activate_next?: boolean,
 *    ensure_active_slots?: boolean,
 *    target_budget_cents?: number,
 *    preferred_slugs?: string[],
 *    dry_run?: boolean,
 *    consultant_id?: string
 *  }
 */
import {
  adminClient,
  corsHeaders,
  FB_GRAPH,
  fbFetch,
  loadPlatformAccount,
} from "../_shared/fb-graph.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { isAutoPerfPause, isManualPause, isManualStop } from "../_shared/campaign-pause.ts";
import {
  normalizeBrainConfig,
  type BrainConfig,
} from "../_shared/brain-config.ts";
import { pickAdCopyForCity } from "../_shared/ad-copy-bank.ts";
import {
  decideAnchorBudgetScale,
  formatAnchorScaleDownWhatsApp,
  formatAnchorScaleUpWhatsApp,
} from "../_shared/brain-budget-scale.ts";
import { notifyConsultant, notifyAnchorBudgetScale } from "../_shared/notify-consultant.ts";

const CONSULTANT_ID = "0c2711ad-4836-41e6-afba-edd94f698ae3";
const ANCHOR_CAMPAIGN_ID = "a0189d12-413a-477d-b903-1bca7a61f44a";
/** Fallback se brain_config vazio — UI sobrescreve via consultant_ad_settings. */
const FALLBACK_MAX_EXPLORERS = 4;
const DEFAULT_BUDGET_CENTS = 1000; // R$ 10
const ROTATION_PREFIX = "ROTATION_QUEUE:";
const DUP_PREFIX = "ROTATION_QUEUE: duplicata";
/** Imagem vencedora fixa — diferenciação no leilão é só texto (banco 100×3). */
const WINNER_PHOTO =
  "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/consultant-photos/0c2711ad-4836-41e6-afba-edd94f698ae3/ads/1783509775658-1000668870.png";
const PLACEMENTS = ["fb:feed", "fb:story", "fb:marketplace", "fb:search", "ig:stream", "ig:story", "ig:reels"];

/** MG inteira — prioridade Triângulo → RMBH → eixos. BH por último. Uberlândia = âncora. */
const MG_QUEUE: Array<{ name: string; key?: string; ddd: number; slug: string }> = [
  { name: "Uberaba", key: "273168", ddd: 34, slug: "uberaba" },
  { name: "Contagem", ddd: 31, slug: "contagem" },
  { name: "Patos de Minas", ddd: 34, slug: "patos-de-minas" },
  { name: "Betim", key: "244810", ddd: 31, slug: "betim" },
  { name: "Araguari", ddd: 34, slug: "araguari" },
  { name: "Ituiutaba", ddd: 34, slug: "ituiutaba" },
  { name: "Juiz de Fora", ddd: 32, slug: "juiz-de-fora" },
  { name: "Divinópolis", key: "250827", ddd: 37, slug: "divinopolis" },
  { name: "Sete Lagoas", ddd: 31, slug: "sete-lagoas" },
  { name: "Pouso Alegre", ddd: 35, slug: "pouso-alegre" },
  { name: "Poços de Caldas", ddd: 35, slug: "pocos-de-caldas" },
  { name: "Varginha", ddd: 35, slug: "varginha" },
  { name: "Montes Claros", ddd: 38, slug: "montes-claros" },
  { name: "Ipatinga", ddd: 31, slug: "ipatinga" },
  { name: "Governador Valadares", ddd: 33, slug: "gov-valadares" },
  { name: "Teófilo Otoni", ddd: 33, slug: "teofilo-otoni" },
  { name: "Santa Luzia", ddd: 31, slug: "santa-luzia" },
  { name: "Ribeirão das Neves", ddd: 31, slug: "ribeirao-das-neves" },
  { name: "Ibirité", ddd: 31, slug: "ibirite" },
  { name: "Belo Horizonte", key: "244661", ddd: 31, slug: "bh" },
];

const DEFAULT_PREFERRED = ["uberaba", "contagem", "betim", "patos-de-minas"];

async function loadBrain(admin: ReturnType<typeof adminClient>, consultantId: string): Promise<BrainConfig> {
  const { data } = await admin
    .from("consultant_ad_settings")
    .select("brain_config, age_min, age_max")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  const cfg = normalizeBrainConfig(data?.brain_config);
  if (data?.age_min != null) cfg.age_min = Number(data.age_min) || cfg.age_min;
  if (data?.age_max != null) cfg.age_max = Number(data.age_max) || cfg.age_max;
  return cfg;
}

function buildQueue(cfg: BrainConfig) {
  const base = [...MG_QUEUE];
  const have = new Set(base.map((c) => c.slug));
  for (const extra of cfg.extra_cities) {
    if (have.has(extra.slug)) continue;
    base.push({
      name: extra.name,
      slug: extra.slug,
      ddd: extra.ddd,
      key: extra.key,
    });
    have.add(extra.slug);
  }
  return base;
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function slugOf(c: { name: string; cities?: any[] }): string {
  const fromName = String(c.name || "").match(/MG-ROT-([a-z0-9-]+)/i);
  if (fromName?.[1]) return fromName[1].toLowerCase();
  const city = String(c.cities?.[0]?.name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return city;
}

async function resolveCityKey(
  name: string,
  known: string | undefined,
  token: string,
  admin: ReturnType<typeof adminClient>,
): Promise<string | null> {
  if (known) return known;
  const { data: cached } = await admin
    .from("fb_city_cache")
    .select("fb_key, region")
    .eq("uf", "MG")
    .eq("name", name)
    .maybeSingle();
  if (cached?.fb_key && /minas/i.test(String(cached.region || ""))) return cached.fb_key;

  const url =
    `${FB_GRAPH}/search?location_types=["city"]&type=adgeolocation&country_code=BR` +
    `&q=${encodeURIComponent(name)}&limit=15&access_token=${encodeURIComponent(token)}`;
  const json = await fbFetch(url);
  const hit = (json?.data || []).find((h: any) =>
    String(h.region || "").toLowerCase().includes("minas") &&
    String(h.name || "").toLowerCase() === name.toLowerCase()
  ) || (json?.data || []).find((h: any) => String(h.region || "").toLowerCase().includes("minas"));
  if (!hit?.key) return null;
  await admin.from("fb_city_cache").upsert({
    name,
    uf: "MG",
    fb_key: String(hit.key),
    region: hit.region || "Minas Gerais",
    region_id: hit.region_id || null,
    country_code: "BR",
  }, { onConflict: "name,uf" });
  return String(hit.key);
}

async function postStatus(id: string, status: "PAUSED" | "ACTIVE", token: string) {
  const r = await fetch(`${FB_GRAPH}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ status, access_token: token }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Meta ${id}: ${r.status} ${body.slice(0, 240)}`);
}

async function postBudget(fbCampaignId: string, dailyBudgetCents: number, token: string) {
  const r = await fetch(`${FB_GRAPH}/${fbCampaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      daily_budget: String(dailyBudgetCents),
      access_token: token,
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`budget ${fbCampaignId}: ${r.status} ${body.slice(0, 240)}`);
}

/** Aplica age_range preferido nos AdSets (Advantage+). Hard age_min fica ≤25.
 *  Idempotente: não POST se targeting já está no alvo (evita resetar aprendizado na Meta). */
async function patchAdsetAgeRange(
  adsetId: string,
  agePref: number,
  token: string,
): Promise<{ ok: boolean; detail: string; skipped?: boolean }> {
  const getUrl = `${FB_GRAPH}/${adsetId}?fields=targeting&access_token=${encodeURIComponent(token)}`;
  const getRes = await fetch(getUrl);
  const getJson = await getRes.json().catch(() => ({}));
  if (!getRes.ok) {
    return { ok: false, detail: `GET ${adsetId}: ${JSON.stringify(getJson).slice(0, 180)}` };
  }
  const current = getJson.targeting || {};
  const hardMin = Math.min(25, agePref);
  const curRange = Array.isArray(current.age_range) ? current.age_range : null;
  const curAuto = Number(current?.targeting_automation?.advantage_audience ?? 0);
  const alreadyOk =
    Number(current.age_min) === hardMin &&
    Number(current.age_max) === 65 &&
    curRange != null &&
    Number(curRange[0]) === agePref &&
    Number(curRange[1]) === 65 &&
    curAuto === 1;
  if (alreadyOk) {
    return { ok: true, skipped: true, detail: `noop age_range=[${agePref},65]` };
  }

  const targeting = { ...current };
  targeting.age_min = hardMin;
  targeting.age_max = 65;
  targeting.age_range = [agePref, 65];
  const auto = { ...(targeting.targeting_automation || {}) };
  auto.advantage_audience = 1;
  targeting.targeting_automation = auto;

  const r = await fetch(`${FB_GRAPH}/${adsetId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      targeting: JSON.stringify(targeting),
      access_token: token,
    }),
  });
  const body = await r.text();
  if (!r.ok) return { ok: false, detail: `PATCH ${adsetId}: ${r.status} ${body.slice(0, 200)}` };
  return { ok: true, detail: `age_range=[${agePref},65]` };
}

function isQueued(reason: string | null | undefined): boolean {
  if (!reason) return false;
  if (String(reason).startsWith(DUP_PREFIX)) return false;
  if (isManualPause(reason) || isManualStop(reason) || isAutoPerfPause(reason)) return false;
  return String(reason).startsWith(ROTATION_PREFIX);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const isCron = isServiceRoleAuth(req) || (!authHeader && !!req.headers.get("apikey"));
    if (!isCron) return j({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const ensureSlots = Boolean(body?.ensure_active_slots);
    const seed = ensureSlots ? Boolean(body?.seed) : body?.seed !== false;
    const activateNext = ensureSlots ? false : body?.activate_next !== false;
    const dryRun = Boolean(body?.dry_run);
    const consultantId = String(body?.consultant_id || CONSULTANT_ID);

    const admin = adminClient();
    const cfg = await loadBrain(admin, consultantId);
    const MAX_EXPLORERS = cfg.max_explorers || FALLBACK_MAX_EXPLORERS;
    const explorerBudget = Math.max(
      517,
      Number(body?.target_budget_cents || cfg.explorer_budget_cents || DEFAULT_BUDGET_CENTS),
    );
    const anchorBudget = Math.max(517, Number(body?.anchor_budget_cents || cfg.anchor_budget_cents || explorerBudget));
    const preferred: string[] = Array.isArray(body?.preferred_slugs) && body.preferred_slugs.length
      ? body.preferred_slugs.map((s: string) => String(s).toLowerCase())
      : (cfg.preferred_slugs?.length ? cfg.preferred_slugs : DEFAULT_PREFERRED).slice(0, MAX_EXPLORERS);
    const cityQueue = buildQueue(cfg);
    const ageMinPref = cfg.age_min || 30;
    const ageMaxPref = cfg.age_max || 65;

    const platform = await loadPlatformAccount();
    if (!platform?.token) return j({ error: "Sem token Meta plataforma" }, 502);
    const token = platform.token;

    const { data: wallet } = await admin
      .from("consultant_wallet")
      .select("balance_cents,debt_cents,auto_pause_at_cents")
      .eq("consultant_id", consultantId)
      .maybeSingle();
    const balance = Number(wallet?.balance_cents || 0);
    const debt = Number(wallet?.debt_cents || 0);
    const liquid = Math.max(0, balance - debt);
    const autoPauseAt = Number(wallet?.auto_pause_at_cents || 500);

    const log: Array<Record<string, unknown>> = [];
    const created: Array<Record<string, unknown>> = [];

    // Marca duplicatas Ipatinga (mantém o mais antigo)
    {
      const { data: ipas } = await admin
        .from("facebook_campaigns")
        .select("id, tracking_protocol, created_at, rejection_reason")
        .eq("consultant_id", consultantId)
        .ilike("name", "MG-ROT-ipatinga%")
        .order("created_at", { ascending: true });
      if ((ipas || []).length > 1) {
        for (const dup of (ipas || []).slice(1)) {
          if (String(dup.rejection_reason || "").startsWith(DUP_PREFIX)) continue;
          if (!dryRun) {
            await admin.from("facebook_campaigns").update({
              rejection_reason: `${DUP_PREFIX} — não rotacionar`,
              status: "paused",
              updated_at: new Date().toISOString(),
            }).eq("id", dup.id);
          }
          log.push({ action: "mark_duplicate", id: dup.id, protocol: dup.tracking_protocol });
        }
      }
    }

    // Seed (só faltantes; em ensure_slots default off pra não estourar timeout)
    if (seed) {
      const { data: existing } = await admin
        .from("facebook_campaigns")
        .select("id, name, status, cities, rejection_reason, initial_message")
        .eq("consultant_id", consultantId)
        .ilike("name", "MG-ROT-%");

      const have = new Set(
        (existing || []).map((c: any) => String(c.cities?.[0]?.name || "").toLowerCase()),
      );
      const usedInitial = (existing || [])
        .map((c: any) => String(c.initial_message || "").trim())
        .filter(Boolean);

      for (const city of cityQueue) {
        if (have.has(city.name.toLowerCase())) {
          log.push({ city: city.name, skipped: "already_seeded" });
          continue;
        }
        const key = await resolveCityKey(city.name, city.key, token, admin);
        if (!key) {
          log.push({ city: city.name, error: "city_key_unresolved" });
          continue;
        }
        const copy = pickAdCopyForCity({
          slug: city.slug,
          cityName: city.name,
          isAnchor: false,
          usedInitialMessages: usedInitial,
        });
        usedInitial.push(copy.initial_message);
        if (dryRun) {
          log.push({
            city: city.name,
            key,
            would: "create_queue_only",
            copy: {
              h: copy.headline_idx,
              p: copy.primary_idx,
              c: copy.ctwa_idx,
              msg: copy.initial_message.slice(0, 60),
            },
          });
          continue;
        }
        const createUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/facebook-create-campaign`;
        const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const payload = {
          consultant_id: consultantId,
          queue_only: true,
          name: `iGreen — ${city.name}`,
          name_prefix: `MG-ROT-${city.slug}`,
          is_remarketing: true,
          retarget_ddds: [city.ddd],
          cities: [{ key, name: city.name }],
          daily_budget_cents: explorerBudget,
          duration_days: null,
          age_min: ageMinPref,
          age_max: ageMaxPref,
          creative_mode: "photo",
          photos: [{ url: WINNER_PHOTO, format: "vertical" }],
          headline: copy.headline,
          description: copy.description,
          primary_text: copy.primary_text,
          distribuidora: "CEMIG",
          placement_mode: "manual",
          placements: PLACEMENTS,
          initial_message: copy.initial_message,
        };
        const r = await fetch(createUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sr}`,
            apikey: sr,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const resp = await r.json().catch(() => ({}));
        created.push({ city: city.name, status: r.status, resp, copy_idx: { h: copy.headline_idx, p: copy.primary_idx, c: copy.ctwa_idx } });
        log.push({ city: city.name, create_status: r.status, ok: r.ok, copy_fp: copy.fingerprint.slice(0, 80) });
        await new Promise((res) => setTimeout(res, 3500));
      }
    }

    // Âncora: budget alvo + escala automática por CPL (se autopilot)
    // Sem trava de 48h entre subidas — janela 48h só mede CPL; degrau a cada ~4h se CPL ok.
    {
      const { data: anchor } = await admin
        .from("facebook_campaigns")
        .select("id, fb_campaign_id, daily_budget_cents, status")
        .eq("id", ANCHOR_CAMPAIGN_ID)
        .maybeSingle();

      let desiredAnchorBudget = anchorBudget;
      let scaleMeta: {
        action: "hold" | "scale_up" | "scale_down";
        reason: string;
        cpl: number | null;
        conv: number;
        spend: number;
        from: number;
      } | null = null;

      if (cfg.autopilot && anchor?.id) {
        const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        const { data: metrics } = await admin
          .from("facebook_metrics_daily")
          .select("spend_cents, messaging_conversations_started")
          .eq("campaign_id", anchor.id)
          .gte("date", since);
        const spend = (metrics || []).reduce((s: number, r: any) => s + Number(r.spend_cents || 0), 0);
        const conv = (metrics || []).reduce(
          (s: number, r: any) => s + Number(r.messaging_conversations_started || 0),
          0,
        );
        const cpl = conv > 0 ? Math.round(spend / conv) : null;
        const fromBudget = Number(anchor.daily_budget_cents) || anchorBudget;
        const decision = decideAnchorBudgetScale({
          currentBudgetCents: fromBudget,
          maxBudgetCents: cfg.max_anchor_budget_cents || 50000,
          targetCplCents: cfg.target_cpl_cents || 200,
          recentCplCents: cpl,
          recentConversations: conv,
          recentSpendCents: spend,
          stepPct: cfg.scale_step_pct || 15,
          lastScaleAtIso: cfg.last_anchor_scale_at || null,
          minHoursBetweenScaleUps: 4,
        });
        if (decision.action === "scale_up" && liquid < decision.budgetCents) {
          desiredAnchorBudget = fromBudget;
          scaleMeta = {
            action: "hold",
            reason: `CPL ok, mas saldo R$ ${(liquid / 100).toFixed(2)} < orçamento R$ ${(decision.budgetCents / 100).toFixed(2)} — não sobe`,
            cpl,
            conv,
            spend,
            from: fromBudget,
          };
          log.push({
            action: "anchor_scale",
            decision: "hold",
            reason: scaleMeta.reason,
            cpl_cents: cpl,
            to: fromBudget,
            liquid_cents: liquid,
          });
        } else {
          desiredAnchorBudget = decision.budgetCents;
          scaleMeta = {
            action: decision.action,
            reason: decision.reason,
            cpl,
            conv,
            spend,
            from: fromBudget,
          };
          log.push({
            action: "anchor_scale",
            decision: decision.action,
            reason: decision.reason,
            cpl_cents: cpl,
            to: desiredAnchorBudget,
          });
          // Persiste o alvo escalado + timestamp (próximos ciclos herdam)
          if (decision.action !== "hold" && !dryRun) {
            const nextCfg = {
              ...cfg,
              anchor_budget_cents: desiredAnchorBudget,
              last_anchor_scale_at: new Date().toISOString(),
            };
            await admin.from("consultant_ad_settings").update({
              brain_config: nextCfg,
              updated_at: new Date().toISOString(),
            }).eq("consultant_id", consultantId);
          }
        }
      }

      if (anchor?.fb_campaign_id && Number(anchor.daily_budget_cents) !== desiredAnchorBudget) {
        if (!dryRun) {
          await postBudget(anchor.fb_campaign_id, desiredAnchorBudget, token);
          await admin.from("facebook_campaigns").update({
            daily_budget_cents: desiredAnchorBudget,
            age_min: Math.min(ageMinPref, 25),
            age_max: 65,
            updated_at: new Date().toISOString(),
          }).eq("id", anchor.id);
        }
        log.push({
          action: "anchor_budget",
          from: anchor.daily_budget_cents,
          to: desiredAnchorBudget,
        });

        // WhatsApp do consultor: mensagem formatada (sobe / desce)
        if (!dryRun && scaleMeta && (scaleMeta.action === "scale_up" || scaleMeta.action === "scale_down")) {
          const stepPct = cfg.scale_step_pct || 15;
          const targetCpl = cfg.target_cpl_cents || 200;
          const text = scaleMeta.action === "scale_up"
            ? formatAnchorScaleUpWhatsApp({
              fromCents: scaleMeta.from,
              toCents: desiredAnchorBudget,
              stepPct,
              walletLiquidCents: liquid,
              cplCents: scaleMeta.cpl,
              conversations: scaleMeta.conv,
              spendCents: scaleMeta.spend,
              targetCplCents: targetCpl,
              reason: scaleMeta.reason,
              cityLabel: "Uberlândia",
            })
            : formatAnchorScaleDownWhatsApp({
              fromCents: scaleMeta.from,
              toCents: desiredAnchorBudget,
              stepPct,
              walletLiquidCents: liquid,
              cplCents: scaleMeta.cpl,
              conversations: scaleMeta.conv,
              targetCplCents: targetCpl,
              reason: scaleMeta.reason,
              cityLabel: "Uberlândia",
            });
          try {
            const ok = await notifyAnchorBudgetScale(consultantId, text);
            log.push({ action: "anchor_scale_notify", ok, kind: scaleMeta.action });
          } catch (e) {
            log.push({ action: "anchor_scale_notify_error", error: (e as Error).message });
          }
        }
      }
    }

    const { data: explorers } = await admin
      .from("facebook_campaigns")
      .select("id, name, status, fb_campaign_id, fb_adset_ids, fb_ad_ids, rejection_reason, cities, daily_budget_cents, created_at, tracking_protocol")
      .eq("consultant_id", consultantId)
      .ilike("name", "MG-ROT-%")
      .order("created_at", { ascending: true });

    const all = (explorers || []) as any[];
    const activeExplorers = all.filter((c) => c.status === "active" || c.status === "pending_review");
    const queued = all.filter((c) => c.status === "paused" && isQueued(c.rejection_reason));

    async function activateCampaign(c: any, reason: string) {
      if (!c.fb_campaign_id) throw new Error("sem fb_campaign_id");
      await postBudget(c.fb_campaign_id, explorerBudget, token);
      for (const id of [...(c.fb_adset_ids || []), ...(c.fb_ad_ids || []), c.fb_campaign_id]) {
        await postStatus(id, "ACTIVE", token);
      }
      await admin.from("facebook_campaigns").update({
        status: "active",
        daily_budget_cents: explorerBudget,
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      }).eq("id", c.id);
      log.push({ action: "activate", id: c.id, city: c.cities?.[0]?.name, reason, budget: explorerBudget });
    }

    async function pauseToQueue(c: any, reason: string) {
      if (!c.fb_campaign_id) return;
      await postStatus(c.fb_campaign_id, "PAUSED", token);
      for (const id of [...(c.fb_adset_ids || []), ...(c.fb_ad_ids || [])]) {
        try { await postStatus(id, "PAUSED", token); } catch (_) { /* */ }
      }
      await admin.from("facebook_campaigns").update({
        status: "paused",
        rejection_reason: reason,
        updated_at: new Date().toISOString(),
      }).eq("id", c.id);
      log.push({ action: "pause_queue", id: c.id, city: c.cities?.[0]?.name });
    }

    // ensure_active_slots: exatamente preferred (até MAX) ativas @ budget
    let ensured: string[] = [];
    if (ensureSlots) {
      const bySlug = new Map(all.map((c) => [slugOf(c), c]));
      const want = preferred.slice(0, MAX_EXPLORERS);
      const wantSet = new Set(want);

      for (const c of activeExplorers) {
        const s = slugOf(c);
        if (!wantSet.has(s)) {
          if (!dryRun) await pauseToQueue(c, `${ROTATION_PREFIX} fora do slot preferido — voltou pra fila`);
        }
      }

      for (const slug of want) {
        let c = bySlug.get(slug);
        if (!c) {
          c = all.find((x) => slugOf(x) === slug || slugOf(x).includes(slug.replace(/-/g, "")));
        }
        if (!c) {
          log.push({ action: "missing_preferred", slug });
          continue;
        }
        if (dryRun) {
          ensured.push(slug);
          continue;
        }
        if (c.status !== "active") {
          await activateCampaign(c, "ensure_preferred");
        } else if (Number(c.daily_budget_cents) !== explorerBudget) {
          await postBudget(c.fb_campaign_id, explorerBudget, token);
          await admin.from("facebook_campaigns").update({
            daily_budget_cents: explorerBudget,
            updated_at: new Date().toISOString(),
          }).eq("id", c.id);
          log.push({ action: "budget_align", id: c.id, to: explorerBudget });
        }
        ensured.push(slug);
      }

      // Notifica só se houve mudança real (ativa/pausa/budget) — evita spam a cada 30 min
      const slotChanged = log.some((e: any) =>
        e?.action === "activate" || e?.action === "pause_queue" || e?.action === "budget_align"
      );
      if (slotChanged) {
        try {
          await notifyConsultant(
            consultantId,
            "info",
            `Cérebro MG — ${1 + ensured.length} praças no ar`,
            `Uberlândia (R$ ${(anchorBudget / 100).toFixed(0)}) + ${ensured.join(", ")} a R$ ${(explorerBudget / 100).toFixed(0)}/dia. Idade preferida ${ageMinPref}+.`,
          );
        } catch (_) { /* */ }
      }

      // Sync age_range preferido nos AdSets ativos (âncora + exploradoras)
      // Só PATCH na Meta se DB ainda não está alinhado OU Graph ainda diverge (idempotente).
      if (!dryRun && ageMinPref > 25) {
        const { data: liveForAge } = await admin
          .from("facebook_campaigns")
          .select("id, fb_adset_ids, cities, name, age_min_preferred")
          .eq("consultant_id", consultantId)
          .in("status", ["active", "pending_review"])
          .or(`id.eq.${ANCHOR_CAMPAIGN_ID},name.ilike.MG-ROT-%`);
        for (const camp of liveForAge || []) {
          const dbAligned = Number((camp as any).age_min_preferred) === ageMinPref;
          // DB já alinhado → não chama Graph (evita “reinício” / aprendizado a cada 30 min)
          if (dbAligned) {
            log.push({
              action: "age_range_noop",
              campaign_id: camp.id,
              city: camp.cities?.[0]?.name,
              detail: "db_aligned_skip",
            });
            continue;
          }
          for (const adsetId of (camp.fb_adset_ids || []) as string[]) {
            try {
              const res = await patchAdsetAgeRange(adsetId, ageMinPref, token);
              log.push({
                action: res.skipped ? "age_range_noop" : "age_range_patch",
                campaign_id: camp.id,
                city: camp.cities?.[0]?.name,
                adset: adsetId,
                ...res,
              });
              if (res.ok) {
                await admin.from("facebook_campaigns").update({
                  age_min_preferred: ageMinPref,
                  age_min: Math.min(25, ageMinPref),
                  age_max: 65,
                  ...(res.skipped ? {} : { updated_at: new Date().toISOString() }),
                }).eq("id", camp.id);
              }
            } catch (e) {
              log.push({
                action: "age_range_patch_error",
                campaign_id: camp.id,
                error: (e as Error).message,
              });
            }
          }
        }
      }
    } else {
      if (activeExplorers.length > MAX_EXPLORERS && !dryRun) {
        for (const c of activeExplorers.slice(MAX_EXPLORERS)) {
          await pauseToQueue(c, `${ROTATION_PREFIX} slot liberado — voltou pra fila`);
        }
      }
      const slotsFree = Math.max(0, MAX_EXPLORERS - Math.min(activeExplorers.length, MAX_EXPLORERS));
      const minToActivate = explorerBudget * 2 + autoPauseAt;
      if (activateNext && slotsFree > 0 && queued.length && liquid >= minToActivate && !dryRun) {
        await activateCampaign(queued[0], "activate_next");
        try {
          await notifyConsultant(
            consultantId,
            "info",
            "Rotação MG — nova cidade",
            `${queued[0].cities?.[0]?.name || queued[0].name} entrou no slot (R$ ${(explorerBudget / 100).toFixed(2)}/dia).`,
          );
        } catch (_) { /* */ }
      } else if (activateNext && slotsFree > 0 && queued.length && liquid < minToActivate) {
        log.push({ action: "skip_activate", reason: "saldo_baixo", liquid, need: minToActivate });
      }

      for (const c of activeExplorers.slice(0, MAX_EXPLORERS)) {
        if (Number(c.daily_budget_cents) === explorerBudget || !c.fb_campaign_id) continue;
        if (!dryRun) {
          await postBudget(c.fb_campaign_id, explorerBudget, token);
          await admin.from("facebook_campaigns").update({
            daily_budget_cents: explorerBudget,
            updated_at: new Date().toISOString(),
          }).eq("id", c.id);
        }
        log.push({ action: "budget_align_active", id: c.id, to: explorerBudget });
      }
    }

    const { data: anchor } = await admin
      .from("facebook_campaigns")
      .select("id, status, daily_budget_cents")
      .eq("id", ANCHOR_CAMPAIGN_ID)
      .maybeSingle();

    const { data: explorersAfter } = await admin
      .from("facebook_campaigns")
      .select("id, status, cities, daily_budget_cents, name")
      .eq("consultant_id", consultantId)
      .ilike("name", "MG-ROT-%");

    const activeAfter = (explorersAfter || []).filter((c: any) => c.status === "active" || c.status === "pending_review");
    const queuedAfter = (explorersAfter || []).filter((c: any) => c.status === "paused");

    return j({
      ok: true,
      dry_run: dryRun,
      brain: cfg,
      strategy: {
        model: "MG_inteiro_ancora_plus_explorers",
        max_explorers: MAX_EXPLORERS,
        anchor_budget_brl: anchorBudget / 100,
        explorer_budget_brl: explorerBudget / 100,
        age_min_preference: ageMinPref,
        queue_size: cityQueue.length,
        preferred,
      },
      wallet: { liquid_cents: liquid, auto_pause_at_cents: autoPauseAt },
      anchor,
      explorers: {
        total: (explorersAfter || []).length,
        active: activeAfter.length,
        queued: queuedAfter.length,
        active_cities: activeAfter.map((c: any) => c.cities?.[0]?.name),
      },
      ensured,
      created,
      log,
    });
  } catch (e) {
    return j({ error: (e as Error).message }, 500);
  }
});
