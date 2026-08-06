import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCampaignSnapshot,
  type BuildSnapshotInput,
  buildWalletState,
  type CampaignBrainSnapshot,
  type CampaignMetaMetrics,
} from "./brain-snapshot.ts";
import {
  aggregateAttribution,
  type AttributableCustomer,
} from "./brain-attribution.ts";
import { evaluateBrainDataQuality } from "./brain-data-quality.ts";
import { resolveBrainDecisionPolicy } from "./brain-policy.ts";
import { decideCampaign, evaluateWalletForIncrease } from "./brain-decide.ts";
import { evaluateBrainHealth } from "./brain-health.ts";
import { evaluateSampleQuality, maxStepPctForConfidence } from "./brain-sample.ts";
import { evaluateAdaptiveCampaignWaste } from "./campaign-waste-guard.ts";

const CAMP = "11111111-1111-1111-1111-111111111111";
const NOW = Date.parse("2026-08-06T12:00:00Z");
const POLICY = resolveBrainDecisionPolicy({});

/** Config que autoriza execução real — usada só para provar os bloqueios. */
const FULLY_AUTHORIZED = {
  brain_mode: "automatic",
  kill_switch: false,
  autopilot: true,
  action_authorizations: {
    increase_budget: "execute",
    reduce_budget: "execute",
    pause_waste: "execute",
  },
};

function quality(over: Record<string, unknown> = {}) {
  return evaluateBrainDataQuality({
    nowMs: NOW,
    lastMetaSyncAtIso: "2026-08-06T10:00:00Z",
    windowStart: "2026-08-04",
    windowEnd: "2026-08-06",
    campaignsFound: 1,
    metricRowsFound: 2,
    expectedMetricRows: 2,
    hasCommercialData: true,
    duplicatesIgnored: 0,
    activeCampaignsWithoutMetrics: 0,
    maxMetricsAgeHours: 26,
    ...over,
  });
}

function meta(over: Partial<CampaignMetaMetrics> = {}): CampaignMetaMetrics {
  const spendCents = over.spendCents ?? 9000;
  const conversations = over.conversations ?? 15;
  return {
    spendCents,
    conversations,
    clicks: 200,
    impressions: 40000,
    cplCents: conversations > 0 ? Math.round(spendCents / conversations) : null,
    ctrBps: 500,
    cpmCents: 225,
    frequencyX100: 120,
    ...over,
  };
}

function leads(count: number, approved: number): AttributableCustomer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `lead-${i}`,
    source_campaign_id: CAMP,
    source_ad_id: `ad-${i}`,
    status: i < approved ? "approved" : "pending",
  }));
}

async function snapshot(
  over: Partial<BuildSnapshotInput> = {},
): Promise<CampaignBrainSnapshot> {
  const input: BuildSnapshotInput = {
    measuredAtIso: "2026-08-06T12:00:00Z",
    campaign: {
      id: CAMP,
      consultantId: "c1",
      name: "IGREEN-ANCORA-UDI",
      status: "active",
      fbCampaignId: "120200",
      dailyBudgetCents: 3000,
      isAnchor: true,
      ageHours: 240,
      rejectionReason: null,
      brainScaleEnabled: true,
      lastExecutionAtIso: null,
      ...(over.campaign ?? {}),
    },
    meta: over.meta ?? meta(),
    attribution: over.attribution ?? aggregateAttribution(leads(8, 4)),
    wallet: over.wallet ??
      buildWalletState({ liquidCents: 200000, activeDailyBudgetCents: 3000 }),
    dataQuality: over.dataQuality ?? quality(),
    targetCplCents: over.targetCplCents ?? 750,
    priorDecisions: over.priorDecisions,
  };
  return await buildCampaignSnapshot(input);
}

function decide(
  snap: CampaignBrainSnapshot,
  over: { brainConfig?: unknown; usedSnapshotVersions?: string[] } = {},
) {
  return decideCampaign({
    snapshot: snap,
    policy: POLICY,
    brainConfig: over.brainConfig ?? FULLY_AUTHORIZED,
    nowMs: NOW,
    usedSnapshotVersions: over.usedSnapshotVersions,
  });
}

// ─────────────────────── Saúdes separadas ───────────────────────

Deno.test("saúde Meta boa com comercial insuficiente não é vencedora", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 3000, conversations: 9 }),
    attribution: aggregateAttribution(leads(2, 0)),
  });
  const health = evaluateBrainHealth(snap, POLICY);
  assertEquals(health.meta.level, "excellent");
  assertEquals(health.commercial.level, "insufficient");
  assertEquals(health.commercial.hasEnoughData, false);
  assertEquals(health.data.level, "excellent");
});

Deno.test("saúde Meta ruim quando gasta sem conversa", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 5000, conversations: 0, cplCents: null }),
  });
  assertEquals(evaluateBrainHealth(snap, POLICY).meta.level, "poor");
});

Deno.test("saúde dos dados cai com atribuição fraca mesmo com métrica fresca", async () => {
  const snap = await snapshot({
    attribution: aggregateAttribution([
      { id: "a", source_campaign_id: CAMP, source_ad_id: "1" },
      { id: "b", source_campaign_id: CAMP },
      { id: "c", source_campaign_id: CAMP },
    ]),
  });
  const health = evaluateBrainHealth(snap, POLICY);
  assertEquals(health.data.level, "fair");
  assertEquals(health.data.freshnessState, "fresh");
});

Deno.test("CAC e conversão só usam a base confiável", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 12000, conversations: 20 }),
    attribution: aggregateAttribution([
      ...leads(8, 4),
      { id: "fraco", source_campaign_id: CAMP, status: "approved" },
    ]),
  });
  const c = evaluateBrainHealth(snap, POLICY).commercial;
  assertEquals(c.approvedTrusted, 4);
  assertEquals(c.approvedLowConfidence, 1);
  assertEquals(c.cacCents, 3000);
  assertEquals(c.conversionRatePct, 50);
});

// ─────────────────────────── Amostra ───────────────────────────

Deno.test("amostra insuficiente com poucas conversas", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 600, conversations: 2 }),
    attribution: aggregateAttribution(leads(1, 0)),
    campaign: { ageHours: 6 } as never,
  });
  const s = evaluateSampleQuality(snap, POLICY);
  assertEquals(s.quality, "insufficient");
  assertEquals(s.confidence, "low");
  assertEquals(maxStepPctForConfidence(s.confidence, POLICY), 0);
});

Deno.test("amostra confiável com volume, leads e dados bons", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 40 }),
    attribution: aggregateAttribution(leads(18, 6)),
  });
  const s = evaluateSampleQuality(snap, POLICY, { cplCents: 740 });
  assertEquals(s.quality, "reliable");
  assertEquals(["good", "high"].includes(s.confidence), true);
});

Deno.test("dado ruim derruba a amostra por porta dura", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 40 }),
    attribution: aggregateAttribution(leads(18, 6)),
    dataQuality: quality({ lastMetaSyncAtIso: "2026-08-01T00:00:00Z" }),
  });
  assertEquals(evaluateSampleQuality(snap, POLICY).quality, "insufficient");
});

Deno.test("degrau por confiança respeita os limites iniciais", () => {
  assertEquals(maxStepPctForConfidence("low", POLICY), 0);
  assertEquals(maxStepPctForConfidence("moderate", POLICY), 5);
  assertEquals(maxStepPctForConfidence("good", POLICY), 8);
  assertEquals(maxStepPctForConfidence("high", POLICY), 10);
});

Deno.test("teto da política corta o degrau da confiança", () => {
  const restrita = resolveBrainDecisionPolicy({
    decision_policy: { max_step_pct: 3 },
  });
  assertEquals(maxStepPctForConfidence("high", restrita), 3);
});

// ────────────────────── Waste adaptativo ──────────────────────

Deno.test("campanha nova não é pausada por gastar pouco em poucas horas", () => {
  const v = evaluateAdaptiveCampaignWaste({
    spendCents: 1200,
    conversations: 0,
    clicks: 3,
    campaignAgeHours: 4,
    targetCplCents: 750,
    hasCommercialResult: false,
    policy: POLICY,
  });
  assertEquals(v.action, "none");
  assertEquals(v.rule, "too_new");
});

Deno.test("limiar de desperdício escala com o CPL-alvo", () => {
  const alvoBaixo = evaluateAdaptiveCampaignWaste({
    spendCents: 1500,
    conversations: 0,
    clicks: 10,
    campaignAgeHours: 100,
    targetCplCents: 200,
    hasCommercialResult: false,
    policy: POLICY,
  });
  const alvoAlto = evaluateAdaptiveCampaignWaste({
    spendCents: 1500,
    conversations: 0,
    clicks: 10,
    campaignAgeHours: 100,
    targetCplCents: 1200,
    hasCommercialResult: false,
    policy: POLICY,
  });
  assertEquals(alvoBaixo.action, "recommend_pause");
  assertEquals(alvoAlto.action, "none");
  assertEquals(alvoAlto.thresholdCents, 3600);
});

Deno.test("campanha com resultado comercial nunca é desperdício", () => {
  const v = evaluateAdaptiveCampaignWaste({
    spendCents: 100000,
    conversations: 0,
    clicks: 0,
    campaignAgeHours: 500,
    targetCplCents: 750,
    hasCommercialResult: true,
    policy: POLICY,
  });
  assertEquals(v.action, "none");
  assertEquals(v.rule, "has_result");
});

Deno.test("adaptativo nunca devolve pausa direta, só recomendação", () => {
  const v = evaluateAdaptiveCampaignWaste({
    spendCents: 99999,
    conversations: 0,
    clicks: 0,
    campaignAgeHours: 999,
    targetCplCents: 750,
    hasCommercialResult: false,
    policy: POLICY,
  });
  assertEquals(v.action, "recommend_pause");
});

// ─────────────────────────── Decisão ───────────────────────────

Deno.test("dados antigos bloqueiam qualquer ação financeira", async () => {
  const snap = await snapshot({
    dataQuality: quality({ lastMetaSyncAtIso: "2026-08-01T00:00:00Z" }),
  });
  const d = decide(snap);
  assertEquals(d.action, "hold");
  assertEquals(d.canExecute, false);
  assertEquals(d.blockers[0].code, "dados_stale");
});

Deno.test("dados incompletos bloqueiam", async () => {
  const snap = await snapshot({
    dataQuality: quality({ metricRowsFound: 1, expectedMetricRows: 10 }),
  });
  const d = decide(snap);
  assertEquals(d.action, "hold");
  assertEquals(d.blockers[0].code, "dados_incomplete");
});

Deno.test("sem dado comercial não declara vencedor nem aumenta", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 3000, conversations: 9 }),
    attribution: aggregateAttribution(leads(2, 0)),
  });
  const d = decide(snap);
  assertEquals(d.action, "hold");
  assertEquals(d.canExecute, false);
  assertEquals(
    d.blockers.some((b) => b.code === "sem_dado_comercial"),
    true,
  );
});

Deno.test("amostra confiável e carteira folgada autorizam aumento", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 45 }),
    attribution: aggregateAttribution(leads(18, 6)),
    wallet: buildWalletState({
      liquidCents: 500000,
      activeDailyBudgetCents: 3000,
    }),
  });
  const d = decide(snap);
  assertEquals(d.action, "increase_budget");
  assertEquals(d.blockers.length, 0);
  assertEquals(d.stepPct <= 10, true);
  assertEquals(d.proposedBudgetCents! > d.currentBudgetCents, true);
});

Deno.test("aumento nunca passa de 10%", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 45 }),
    attribution: aggregateAttribution(leads(18, 6)),
    wallet: buildWalletState({
      liquidCents: 500000,
      activeDailyBudgetCents: 3000,
    }),
  });
  const d = decide(snap);
  assertEquals(d.proposedBudgetCents! <= Math.round(3000 * 1.1), true);
});

Deno.test("mesmo snapshot não autoriza um segundo aumento", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 45 }),
    attribution: aggregateAttribution(leads(18, 6)),
    wallet: buildWalletState({
      liquidCents: 500000,
      activeDailyBudgetCents: 3000,
    }),
  });
  const d = decide(snap, { usedSnapshotVersions: [snap.version] });
  assertEquals(d.action, "hold");
  assertEquals(
    d.blockers.some((b) => b.code === "snapshot_ja_utilizado"),
    true,
  );
});

Deno.test("intervalo mínimo de 24h bloqueia execução seguida", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 45 }),
    attribution: aggregateAttribution(leads(18, 6)),
    wallet: buildWalletState({
      liquidCents: 500000,
      activeDailyBudgetCents: 3000,
    }),
    campaign: { lastExecutionAtIso: "2026-08-06T06:00:00Z" } as never,
  });
  const d = decide(snap);
  assertEquals(d.action, "hold");
  assertEquals(d.blockers.some((b) => b.code === "intervalo_minimo"), true);
});

Deno.test("carteira insuficiente bloqueia e mostra saldo necessário", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 45 }),
    attribution: aggregateAttribution(leads(18, 6)),
    wallet: buildWalletState({ liquidCents: 500, activeDailyBudgetCents: 3000 }),
  });
  const d = decide(snap);
  assertEquals(d.action, "hold");
  const blocker = d.blockers.find((b) => b.code === "carteira_insuficiente");
  assertEquals(Boolean(blocker), true);
  assertEquals(blocker!.message.includes("necessários"), true);
});

Deno.test("campanha pausada não recebe aumento", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 45 }),
    attribution: aggregateAttribution(leads(18, 6)),
    wallet: buildWalletState({
      liquidCents: 500000,
      activeDailyBudgetCents: 3000,
    }),
    campaign: { status: "paused" } as never,
  });
  const d = decide(snap);
  assertEquals(d.action, "hold");
  assertEquals(d.blockers.some((b) => b.code === "campanha_nao_ativa"), true);
});

Deno.test("CPL muito acima do alvo recomenda reduzir", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 10 }),
  });
  const d = decide(snap);
  assertEquals(d.action, "reduce_budget");
  assertEquals(d.stepPct, 5);
  assertEquals(d.proposedBudgetCents, 2850);
});

Deno.test("waste guard em recommend não deixa executar a pausa", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 5000, conversations: 0, cplCents: null, clicks: 0 }),
    attribution: aggregateAttribution([]),
  });
  const d = decide(snap, {
    brainConfig: { ...FULLY_AUTHORIZED, waste_guard_mode: "recommend" },
  });
  assertEquals(d.action, "pause_waste");
  assertEquals(d.canRecommend, true);
  assertEquals(d.canExecute, false);
  assertEquals(d.blockers[0].code, "waste_guard_recommend");
});

Deno.test("waste guard em automatic libera a execução da pausa", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 5000, conversations: 0, cplCents: null, clicks: 0 }),
    attribution: aggregateAttribution([]),
  });
  const d = decide(snap, {
    brainConfig: { ...FULLY_AUTHORIZED, waste_guard_mode: "automatic" },
  });
  assertEquals(d.action, "pause_waste");
  assertEquals(d.canExecute, true);
});

Deno.test("waste guard off segura a decisão", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 5000, conversations: 0, cplCents: null, clicks: 0 }),
    attribution: aggregateAttribution([]),
  });
  const d = decide(snap, {
    brainConfig: { ...FULLY_AUTHORIZED, waste_guard_mode: "off" },
  });
  assertEquals(d.action, "hold");
  assertEquals(d.blockers[0].code, "waste_guard_off");
});

Deno.test("kill switch mantém a recomendação e corta a execução", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 45 }),
    attribution: aggregateAttribution(leads(18, 6)),
    wallet: buildWalletState({
      liquidCents: 500000,
      activeDailyBudgetCents: 3000,
    }),
  });
  const d = decide(snap, {
    brainConfig: { ...FULLY_AUTHORIZED, kill_switch: true },
  });
  assertEquals(d.action, "increase_budget");
  assertEquals(d.canRecommend, true);
  assertEquals(d.canExecute, false);
});

Deno.test("padrão seguro: sem autorização por ação, recomenda e não executa", async () => {
  const snap = await snapshot({
    meta: meta({ spendCents: 30000, conversations: 45 }),
    attribution: aggregateAttribution(leads(18, 6)),
    wallet: buildWalletState({
      liquidCents: 500000,
      activeDailyBudgetCents: 3000,
    }),
  });
  const d = decide(snap, { brainConfig: {} });
  assertEquals(d.action, "increase_budget");
  assertEquals(d.canExecute, false);
});

Deno.test("decisão é determinística para o mesmo snapshot", async () => {
  const snap = await snapshot();
  const a = decide(snap);
  const b = decide(snap);
  assertEquals(a.action, b.action);
  assertEquals(a.reason, b.reason);
  assertEquals(a.snapshotVersion, b.snapshotVersion);
});

Deno.test("decisão registra as métricas usadas para o histórico", async () => {
  const snap = await snapshot();
  const d = decide(snap);
  assertEquals(d.measured.conversations, 15);
  assertEquals(d.measured.leadsTrusted, 8);
  assertEquals(d.measured.approvedTrusted, 4);
  assertEquals(d.measured.windowStart, "2026-08-04");
  assertEquals(d.measured.dataQualityState, "fresh");
});

// ────────────────────────── Carteira ──────────────────────────

Deno.test("saldo necessário considera runway e queima projetada", () => {
  const v = evaluateWalletForIncrease({
    liquidCents: 100000,
    currentDailyBurnWithFeeCents: 3600,
    budgetDeltaCents: 300,
    minRunwayDays: 2,
  });
  assertEquals(v.requiredCents, 7920);
  assertEquals(v.ok, true);
});

Deno.test("runway projetado abaixo do mínimo reprova o aumento", () => {
  const v = evaluateWalletForIncrease({
    liquidCents: 4000,
    currentDailyBurnWithFeeCents: 3600,
    budgetDeltaCents: 300,
    minRunwayDays: 2,
  });
  assertEquals(v.ok, false);
  assertEquals(v.projectedRunwayDays < 2, true);
});
