/**
 * Cérebro de campanhas — rank + decisões + config UI + aplicar rotação.
 * Auth: service_role OU consultor (só as próprias).
 *
 * Body:
 *  { action?: "rank" | "save" | "apply", consultant_id?, brain?: BrainConfigPartial }
 */
import { adminClient, authConsultant } from "../_shared/fb-graph.ts";
import { buildCors } from "../_shared/cors.ts";
import { isServiceRoleAuth } from "../_shared/service-role-auth.ts";
import { AUTO_PERF_PAUSE_PREFIX } from "../_shared/campaign-waste-guard.ts";
import {
  type BrainConfig,
  DEFAULT_BRAIN_CONFIG,
  isAdsExpansiveMutationAllowed,
  normalizeBrainConfig,
  slugifyCityName,
} from "../_shared/brain-config.ts";
import { LEGACY_ANCHOR_CAMPAIGN_ID } from "../_shared/ads-anchor.ts";

// Fonte única do id legado (ver `_shared/ads-anchor.ts`).
const ANCHOR_ID = LEGACY_ANCHOR_CAMPAIGN_ID;

function j(req: Request, body: unknown, status = 200) {
  const cors = buildCors(req, "x-service-secret");
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function cityScore(input: {
  spend48: number;
  conv48: number;
  clicks48: number;
  impressions48: number;
  anchorCpl: number | null;
}): number {
  let score = 50;
  const cpl = input.conv48 > 0 ? input.spend48 / input.conv48 : null;
  if (cpl != null && input.anchorCpl != null && input.anchorCpl > 0) {
    score += clamp(30 * (input.anchorCpl / cpl), 0, 35);
  } else if (input.spend48 >= 1000 && input.conv48 === 0) {
    score -= 40;
  }
  score += Math.min(15, input.conv48 * 3);
  const ctrBps = input.impressions48 > 0
    ? Math.round(input.clicks48 * 10000 / input.impressions48)
    : 0;
  score += Math.min(10, ctrBps / 20);
  if (input.spend48 >= 800 && ctrBps < 60) score -= 20;
  return clamp(Math.round(score), 0, 100);
}

function slugOf(c: { name?: string; cities?: any[] }): string {
  const fromName = String(c.name || "").match(/MG-ROT-([a-z0-9-]+)/i);
  if (fromName?.[1]) return fromName[1].toLowerCase();
  return slugifyCityName(String(c.cities?.[0]?.name || ""));
}

async function loadCfg(
  admin: ReturnType<typeof adminClient>,
  consultantId: string,
): Promise<BrainConfig> {
  const { data } = await admin
    .from("consultant_ad_settings")
    .select("brain_config, age_min, age_max")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  const cfg = normalizeBrainConfig(data?.brain_config || DEFAULT_BRAIN_CONFIG);
  if (data?.age_min != null) cfg.age_min = Number(data.age_min) || cfg.age_min;
  if (data?.age_max != null) cfg.age_max = Number(data.age_max) || cfg.age_max;
  return cfg;
}

Deno.serve(async (req) => {
  const cors = buildCors(req, "x-service-secret");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    let consultantId = typeof body?.consultant_id === "string"
      ? body.consultant_id
      : "";
    const action = String(body?.action || "rank");

    if (isServiceRoleAuth(req)) {
      if (!consultantId) {
        return j(req, { error: "consultant_id obrigatório" }, 400);
      }
    } else {
      const auth = await authConsultant(req);
      if (!auth) return j(req, { error: "Unauthorized" }, 401);
      consultantId = auth.id;
    }

    const admin = adminClient();

    // ── SAVE config (UI) ──────────────────────────────────────────
    if (action === "save" || action === "apply") {
      const next = normalizeBrainConfig({
        ...(await loadCfg(admin, consultantId)),
        ...(body?.brain && typeof body.brain === "object" ? body.brain : {}),
      });
      // Contenção: a UI salva estratégia (budget, cidades, idade, CPL alvo),
      // mas NÃO decide autonomia por aqui.
      //
      // Os três campos de autonomia são PRESERVADOS como estão no banco, e não
      // forçados a inerte: forçar apagaria em silêncio uma habilitação feita
      // deliberadamente por um operador via SQL. A tela não promove nem
      // rebaixa — quem manda é o valor persistido (default = inerte).
      next.preferred_slugs = next.preferred_slugs.slice(0, next.max_explorers);
      const stored = normalizeBrainConfig(await loadCfg(admin, consultantId));
      const requestedAutonomy = {
        autopilot: next.autopilot,
        automation_mode: next.automation_mode,
        kill_switch: next.kill_switch,
      };
      next.autopilot = stored.autopilot;
      next.automation_mode = stored.automation_mode;
      next.kill_switch = stored.kill_switch;
      // Devolvido à UI para ela não mentir dizendo "salvo" sobre o que foi
      // ignorado por não ser decisão desta tela.
      const autonomyForced = requestedAutonomy.autopilot !== stored.autopilot ||
        requestedAutonomy.automation_mode !== stored.automation_mode ||
        requestedAutonomy.kill_switch !== stored.kill_switch;

      await admin.from("consultant_ad_settings").upsert({
        consultant_id: consultantId,
        age_min: next.age_min,
        age_max: next.age_max,
        brain_config: next,
        updated_at: new Date().toISOString(),
      }, { onConflict: "consultant_id" });

      let applyResult: unknown = null;
      if (action === "apply") {
        // `apply` NÃO dispara o rotator daqui. Fazer isso service-to-service
        // apagaria o sinal de "decisão humana" que a policy usa para liberar
        // criação/targeting — o clique do consultor deve ir direto ao rotator.
        applyResult = {
          skipped: isAdsExpansiveMutationAllowed(next)
            ? "apply_requires_direct_rotator_call"
            : "ads_automation_disabled",
          hint: "chame facebook-mg-city-rotator com o JWT do consultor",
        };
      }

      // fall through to rank with saved cfg
      body._saved = next;
      body._apply = applyResult;
      body._autonomy_forced_inert = autonomyForced;
    }

    const cfg = await loadCfg(admin, consultantId);
    const since48 = new Date(Date.now() - 2 * 86400_000).toISOString().slice(
      0,
      10,
    );

    const [{ data: camps }, { data: wallet }, { data: metrics }] = await Promise
      .all([
        admin.from("facebook_campaigns")
          .select(
            "id, name, status, cities, daily_budget_cents, rejection_reason, tracking_protocol, created_at, age_min, age_max, age_min_preferred",
          )
          .eq("consultant_id", consultantId)
          .or(`id.eq.${ANCHOR_ID},name.ilike.MG-ROT-%`),
        admin.from("consultant_wallet")
          .select("balance_cents,debt_cents")
          .eq("consultant_id", consultantId)
          .maybeSingle(),
        admin.from("facebook_metrics_daily")
          .select(
            "campaign_id, spend_cents, messaging_conversations_started, clicks, impressions",
          )
          .gte("date", since48),
      ]);

    const mBy = new Map<
      string,
      { spend: number; conv: number; clicks: number; impressions: number }
    >();
    for (const row of (metrics || []) as any[]) {
      const cur = mBy.get(row.campaign_id) ||
        { spend: 0, conv: 0, clicks: 0, impressions: 0 };
      cur.spend += Number(row.spend_cents || 0);
      cur.conv += Number(row.messaging_conversations_started || 0);
      cur.clicks += Number(row.clicks || 0);
      cur.impressions += Number(row.impressions || 0);
      mBy.set(row.campaign_id, cur);
    }

    const anchorM = mBy.get(ANCHOR_ID) ||
      { spend: 0, conv: 0, clicks: 0, impressions: 0 };
    const anchorCpl = anchorM.conv > 0
      ? Math.round(anchorM.spend / anchorM.conv)
      : null;

    const cities = ((camps || []) as any[]).map((c) => {
      const m = mBy.get(c.id) ||
        { spend: 0, conv: 0, clicks: 0, impressions: 0 };
      const cpl = m.conv > 0 ? Math.round(m.spend / m.conv) : null;
      const isAnchor = c.id === ANCHOR_ID;
      const reason = String(c.rejection_reason || "");
      let role = "fila";
      if (isAnchor) role = "ancora";
      else if (c.status === "active" || c.status === "pending_review") {
        role = "exploradora";
      } else if (reason.startsWith("ROTATION_QUEUE: duplicata")) {
        role = "duplicata";
      } else if (reason.startsWith(AUTO_PERF_PAUSE_PREFIX)) {
        role = "morta_waste";
      } else if (reason.startsWith("ROTATION_QUEUE:")) role = "fila";

      return {
        id: c.id,
        name: c.cities?.[0]?.name || c.name,
        slug: isAnchor ? "uberlandia" : slugOf(c),
        protocol: c.tracking_protocol,
        role,
        status: c.status,
        budget_cents: Number(c.daily_budget_cents || 0),
        spend_48h_cents: m.spend,
        conv_48h: m.conv,
        clicks_48h: m.clicks,
        cpl_cents: cpl,
        age_min_hard: Number(c.age_min || 25),
        age_max_hard: Number(c.age_max || 65),
        age_min_preferred: c.age_min_preferred != null
          ? Number(c.age_min_preferred)
          : cfg.age_min,
        age_range_ok: c.age_min_preferred != null &&
          Number(c.age_min_preferred) >= cfg.age_min,
        score: cityScore({
          spend48: m.spend,
          conv48: m.conv,
          clicks48: m.clicks,
          impressions48: m.impressions,
          anchorCpl,
        }),
        rejection_reason: c.rejection_reason,
      };
    }).sort((a, b) => b.score - a.score);

    const active = cities.filter((c) =>
      c.status === "active" || c.status === "pending_review"
    );
    const dailyBurn = active.reduce((s, c) => s + c.budget_cents, 0);
    const feeBurn = Math.round(dailyBurn * 1.2);
    const liquid = Math.max(
      0,
      Number(wallet?.balance_cents || 0) - Number(wallet?.debt_cents || 0),
    );
    const runwayDays = feeBurn > 0 ? Number((liquid / feeBurn).toFixed(1)) : 99;
    const moneyAtRisk = cities
      .filter((c) =>
        (c.status === "active" || c.status === "pending_review") &&
        c.conv_48h === 0 && c.spend_48h_cents > 0
      )
      .reduce((s, c) => s + c.spend_48h_cents, 0);

    const greenShare = active.length
      ? active.filter((c) => c.score >= 60).length / active.length
      : 0;
    let health = 55;
    health += Math.round(greenShare * 25);
    health += runwayDays >= 3 ? 10 : runwayDays >= 1.5 ? 5 : -15;
    health -= moneyAtRisk >= 1500 ? 20 : moneyAtRisk >= 800 ? 10 : 0;
    health = clamp(health, 0, 100);

    // Rotation board — o que está no ar / entra / sai
    const preferred = cfg.preferred_slugs.slice(0, cfg.max_explorers);
    const preferredSet = new Set(preferred);
    const explorers = cities.filter((c) =>
      c.role === "exploradora" ||
      (c.role === "fila" || c.role === "morta_waste")
    );
    const activeExplorers = cities.filter((c) => c.role === "exploradora");
    const queueCities = cities.filter((c) => c.role === "fila");
    const willPause = activeExplorers.filter((c) =>
      c.slug && !preferredSet.has(c.slug)
    );
    const willOpen = preferred
      .filter((slug) => !activeExplorers.some((c) => c.slug === slug))
      .map((slug) => {
        const found = cities.find((c) => c.slug === slug);
        return {
          slug,
          name: found?.name || slug,
          id: found?.id || null,
          status: found?.status || "missing",
        };
      });

    type Dec = {
      type: string;
      title: string;
      message: string;
      severity: string;
      impact_cents_per_day: number;
      action_label: string;
      action_payload: Record<string, unknown>;
    };
    const decisions: Dec[] = [];

    for (const c of active) {
      if (c.role === "ancora") continue;
      if (c.spend_48h_cents >= 1000 && c.conv_48h === 0) {
        decisions.push({
          type: "brain_pause_waste",
          title: `Pausar ${c.name} — gasto sem conversa`,
          message: `R$ ${
            (c.spend_48h_cents / 100).toFixed(2)
          } em 48h com 0 conversas. Waste guard recomenda pausa.`,
          severity: "critical",
          impact_cents_per_day: c.budget_cents,
          action_label: "Pausar agora",
          action_payload: { kind: "pause_campaign", campaign_id: c.id },
        });
      }
    }

    if (activeExplorers.length >= 1) {
      const worst = [...activeExplorers].sort((a, b) => a.score - b.score)[0];
      const next = queueCities[0];
      if (worst && next && worst.score < 45) {
        decisions.push({
          type: "brain_swap_explorer",
          title: `Trocar ${worst.name} → ${next.name}`,
          message:
            `${worst.name} score ${worst.score}. Próxima na fila: ${next.name}.`,
          severity: "warning",
          impact_cents_per_day: 0,
          action_label: "Trocar exploradora",
          action_payload: {
            kind: "swap_explorer",
            pause_campaign_id: worst.id,
            activate_campaign_id: next.id,
          },
        });
      }
    }

    if (runwayDays < cfg.min_runway_days) {
      decisions.push({
        type: "brain_refill_warning",
        title: "Recarregue a carteira",
        message: `Runway ~${runwayDays} dia(s) no ritmo atual (R$ ${
          (feeBurn / 100).toFixed(0)
        }/dia c/ taxa). Mínimo configurado: ${cfg.min_runway_days}d.`,
        severity: "warning",
        impact_cents_per_day: 0,
        action_label: "Ver carteira",
        action_payload: { kind: "open_wallet" },
      });
    }

    for (const d of decisions) {
      const { data: existing } = await admin.from("ad_recommendations")
        .select("id")
        .eq("consultant_id", consultantId)
        .eq("type", d.type)
        .eq("title", d.title)
        .is("dismissed_at", null)
        .is("applied_at", null)
        .limit(1);
      if (existing?.length) continue;
      await admin.from("ad_recommendations").insert({
        consultant_id: consultantId,
        type: d.type,
        title: d.title,
        message: d.message,
        severity: d.severity,
        action_label: d.action_label,
        action_payload: d.action_payload,
      });
    }

    const plannedDaily = cfg.anchor_budget_cents +
      cfg.explorer_budget_cents * cfg.max_explorers;

    return j(req, {
      ok: true,
      health_score: health,
      runway_days: runwayDays,
      money_at_risk_cents: moneyAtRisk,
      daily_burn_cents: dailyBurn,
      daily_burn_with_fee_cents: feeBurn,
      liquid_cents: liquid,
      anchor_cpl_cents: anchorCpl,
      cities,
      decisions,
      brain: cfg,
      age: {
        hard_min: 25,
        hard_max: 65,
        preference_min: cfg.age_min,
        preference_max: cfg.age_max,
        note:
          "Meta Advantage+: hard 25–65. Preferência vai em age_range na API.",
        live_with_preference: active.filter((c) => c.age_range_ok).length,
        live_total: active.length,
      },
      rotation: {
        total_slots: 1 + cfg.max_explorers,
        preferred,
        on_air: active.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          role: c.role,
          budget_cents: c.budget_cents,
          score: c.score,
        })),
        will_open: willOpen,
        will_pause: willPause.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
        })),
        queue: queueCities.slice(0, 20).map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          score: c.score,
        })),
        planned_daily_burn_cents: plannedDaily,
        planned_daily_with_fee_cents: Math.round(plannedDaily * 1.2),
      },
      insight_udi: {
        first_multi: {
          protocol: "FB-77735",
          note:
            "Campanha 08/07 multi-cidade (UDI+Uberaba+BH). Gasto ~R$22, 3 conversas, CPL ~R$7,33. Não é a âncora atual.",
        },
        anchor_winner: {
          protocol: "2026-0014",
          note:
            "Remarketing Uberlândia 19/07 — CPL ~R$1,91 (37 conversas). Esta é a âncora que não mexemos no criativo.",
        },
      },
      apply_result: body._apply ?? null,
      // Avisa a UI quando os campos de autonomia foram forçados ao estado
      // inerte, para a tela não exibir "salvo" sobre algo que não valeu.
      autonomy_forced_inert: body._autonomy_forced_inert ?? false,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return j(req, { error: (e as Error).message }, 500);
  }
});
