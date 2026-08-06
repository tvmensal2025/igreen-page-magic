import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  aggregateMetaMetrics,
  buildCampaignSnapshot,
  type BuildSnapshotInput,
  buildWalletState,
} from "./brain-snapshot.ts";
import { aggregateAttribution } from "./brain-attribution.ts";
import { evaluateBrainDataQuality } from "./brain-data-quality.ts";

const CAMP = "11111111-1111-1111-1111-111111111111";

const QUALITY = evaluateBrainDataQuality({
  nowMs: Date.parse("2026-08-06T12:00:00Z"),
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
});

function snapshotInput(over: Partial<BuildSnapshotInput> = {}): BuildSnapshotInput {
  return {
    measuredAtIso: "2026-08-06T12:00:00Z",
    campaign: {
      id: CAMP,
      consultantId: "c1",
      name: "IGREEN-ANCORA-UDI",
      status: "active",
      fbCampaignId: "120200",
      dailyBudgetCents: 3000,
      isAnchor: true,
      ageHours: 120,
      rejectionReason: null,
      brainScaleEnabled: false,
      lastExecutionAtIso: null,
    },
    meta: aggregateMetaMetrics([
      { spend_cents: 3000, messaging_conversations_started: 4, clicks: 40, impressions: 5000 },
      { spend_cents: 3000, messaging_conversations_started: 6, clicks: 60, impressions: 5000 },
    ]),
    attribution: aggregateAttribution([
      { id: "l1", source_campaign_id: CAMP, source_ad_id: "1", status: "approved" },
      { id: "l2", source_campaign_id: CAMP, ctwa_clid: "x", status: "pending" },
    ]),
    wallet: buildWalletState({ liquidCents: 50000, activeDailyBudgetCents: 3000 }),
    dataQuality: QUALITY,
    targetCplCents: 750,
    ...over,
  };
}

Deno.test("métricas agregam soma e recalculam CTR/CPM", () => {
  const m = aggregateMetaMetrics([
    { spend_cents: 1000, messaging_conversations_started: 2, clicks: 50, impressions: 10000 },
    { spend_cents: 1000, messaging_conversations_started: 2, clicks: 50, impressions: 10000 },
  ]);
  assertEquals(m.spendCents, 2000);
  assertEquals(m.conversations, 4);
  assertEquals(m.cplCents, 500);
  assertEquals(m.ctrBps, 50);
  assertEquals(m.cpmCents, 100);
});

Deno.test("sem conversa o CPL é nulo, não zero", () => {
  assertEquals(aggregateMetaMetrics([{ spend_cents: 5000 }]).cplCents, null);
});

Deno.test("linhas vazias não quebram a agregação", () => {
  const m = aggregateMetaMetrics([{}, { spend_cents: null, clicks: "abc" }]);
  assertEquals(m.spendCents, 0);
  assertEquals(m.ctrBps, 0);
});

Deno.test("runway usa a taxa da plataforma", () => {
  const w = buildWalletState({ liquidCents: 36000, activeDailyBudgetCents: 3000 });
  assertEquals(w.dailyBurnWithFeeCents, 3600);
  assertEquals(w.runwayDays, 10);
});

Deno.test("sem queima o runway não divide por zero", () => {
  assertEquals(
    buildWalletState({ liquidCents: 100, activeDailyBudgetCents: 0 }).runwayDays,
    999,
  );
});

Deno.test("snapshot carrega medição, comercial e qualidade", async () => {
  const snap = await buildCampaignSnapshot(snapshotInput());
  assertEquals(snap.meta.conversations, 10);
  assertEquals(snap.commercial.leadsTrusted, 2);
  assertEquals(snap.commercial.approvedTrusted, 1);
  assertEquals(snap.dataQuality.state, "fresh");
  assertEquals(snap.schemaVersion, 1);
});

Deno.test("mesma amostra produz a mesma versão", async () => {
  const a = await buildCampaignSnapshot(snapshotInput());
  const b = await buildCampaignSnapshot(snapshotInput());
  assertEquals(a.version, b.version);
});

Deno.test("relógio andando não cria versão nova", async () => {
  const a = await buildCampaignSnapshot(snapshotInput());
  const b = await buildCampaignSnapshot(
    snapshotInput({ measuredAtIso: "2026-08-06T23:59:00Z" }),
  );
  assertEquals(a.version, b.version);
});

Deno.test("dado novo muda a versão", async () => {
  const base = await buildCampaignSnapshot(snapshotInput());
  const maisConversa = await buildCampaignSnapshot(snapshotInput({
    meta: aggregateMetaMetrics([
      { spend_cents: 6000, messaging_conversations_started: 11, clicks: 100, impressions: 10000 },
    ]),
  }));
  assertNotEquals(base.version, maisConversa.version);
});

Deno.test("budget diferente muda a versão", async () => {
  const base = await buildCampaignSnapshot(snapshotInput());
  const outro = await buildCampaignSnapshot(snapshotInput({
    campaign: { ...snapshotInput().campaign, dailyBudgetCents: 4000 },
  }));
  assertNotEquals(base.version, outro.version);
});

Deno.test("lead novo atribuído muda a versão", async () => {
  const base = await buildCampaignSnapshot(snapshotInput());
  const comLead = await buildCampaignSnapshot(snapshotInput({
    attribution: aggregateAttribution([
      { id: "l1", source_campaign_id: CAMP, source_ad_id: "1", status: "approved" },
      { id: "l2", source_campaign_id: CAMP, ctwa_clid: "x", status: "pending" },
      { id: "l3", source_campaign_id: CAMP, source_ad_id: "2", status: "pending" },
    ]),
  }));
  assertNotEquals(base.version, comLead.version);
});
