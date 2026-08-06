/**
 * Backtest e modo sombra: o que precisa ser garantido é o que NÃO acontece.
 * Nenhuma chamada de rede (Meta) e, no backtest, nenhuma escrita no banco.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { measureConsultantCampaigns } from "./brain-measure.ts";
import { decideCampaign } from "./brain-decide.ts";
import { recordRecommendation } from "./brain-decision-store.ts";

const CONSULTANT = "11111111-1111-1111-1111-111111111111";
const CAMPAIGN = "22222222-2222-2222-2222-222222222222";
const NOW = Date.parse("2026-08-06T12:00:00Z");

type Write = { table: string; op: string };

function fakeAdmin(writes: Write[], overrides: Record<string, unknown> = {}) {
  const recent = new Date(NOW - 3 * 3_600_000).toISOString();
  const tables: Record<string, { single?: unknown; rows?: unknown[] }> = {
    consultant_ad_settings: { single: { brain_config: {} } },
    consultant_wallet: { single: { balance_cents: 200_000, debt_cents: 0 } },
    facebook_campaigns: {
      rows: [{
        id: CAMPAIGN,
        name: "Campanha B",
        consultant_id: CONSULTANT,
        status: "active",
        fb_campaign_id: "120200",
        daily_budget_cents: 3000,
        rejection_reason: null,
        started_at: new Date(NOW - 10 * 86_400_000).toISOString(),
        created_at: new Date(NOW - 10 * 86_400_000).toISOString(),
        brain_scale_enabled: false,
        brain_scale_last_at: null,
        brain_scale_target_cpl_cents: 200,
      }],
    },
    facebook_metrics_daily: {
      rows: [
        {
          campaign_id: CAMPAIGN,
          date: "2026-08-05",
          spend_cents: 3000,
          messaging_conversations_started: 20,
          clicks: 90,
          impressions: 9000,
          frequency_x100: 120,
          updated_at: recent,
        },
        {
          campaign_id: CAMPAIGN,
          date: "2026-08-06",
          spend_cents: 3000,
          messaging_conversations_started: 20,
          clicks: 95,
          impressions: 9500,
          frequency_x100: 125,
          updated_at: recent,
        },
      ],
    },
    customers: {
      rows: Array.from({ length: 8 }, (_, i) => ({
        id: `cust-${i}`,
        source_campaign_id: CAMPAIGN,
        source_ad_id: `ad-${i}`,
        status: i < 3 ? "approved" : "pending",
        portal_submitted_at: i < 5 ? new Date(NOW).toISOString() : null,
        created_at: new Date(NOW - 3_600_000).toISOString(),
      })),
    },
    ads_brain_decisions: { rows: [] },
    ad_recommendations: { rows: [] },
    ...overrides as Record<string, { single?: unknown; rows?: unknown[] }>,
  };

  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      for (const m of ["select", "eq", "in", "gte", "lt", "or", "order", "limit"]) {
        q[m] = chain;
      }
      for (const m of ["insert", "update", "upsert", "delete"]) {
        q[m] = () => {
          writes.push({ table, op: m });
          return q;
        };
      }
      q.maybeSingle = () =>
        Promise.resolve({ data: tables[table]?.single ?? null, error: null });
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: tables[table]?.rows ?? [], error: null }).then(
          res,
          rej,
        );
      return q;
    },
  };
}

/** Qualquer `fetch` durante o teste é falha: Cérebro não fala com a Meta. */
async function withoutNetwork<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    throw new Error("chamada de rede proibida no backtest/shadow");
  }) as typeof fetch;
  try {
    const out = await fn();
    assertEquals(calls, 0, "nenhuma chamada de rede pode acontecer");
    return out;
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("backtest: mede e decide sem escrever no banco nem chamar a Meta", async () => {
  const writes: Write[] = [];
  const decision = await withoutNetwork(async () => {
    const measured = await measureConsultantCampaigns(fakeAdmin(writes), {
      consultantId: CONSULTANT,
      nowMs: NOW,
      windowDays: 2,
    });
    assertEquals(measured.snapshots.length, 1);
    return decideCampaign({
      snapshot: measured.snapshots[0],
      policy: measured.policy,
      brainConfig: measured.brainConfig,
      nowMs: NOW,
      secondWindow: measured.secondWindowByCampaign.get(CAMPAIGN),
      usedSnapshotVersions: [],
    });
  });

  assertEquals(writes.length, 0);
  assertEquals(decision.action, "increase_budget");
  // Padrão seguro: recomenda, mas não executa.
  assertEquals(decision.canExecute, false);
  assert(decision.stepPct > 0 && decision.stepPct <= 10);
});

Deno.test("shadow: registra recomendação e ainda assim não chama a Meta", async () => {
  const writes: Write[] = [];
  const admin = fakeAdmin(writes);
  await withoutNetwork(async () => {
    const measured = await measureConsultantCampaigns(admin, {
      consultantId: CONSULTANT,
      nowMs: NOW,
      windowDays: 2,
    });
    const d = decideCampaign({
      snapshot: measured.snapshots[0],
      policy: measured.policy,
      brainConfig: measured.brainConfig,
      nowMs: NOW,
      usedSnapshotVersions: [],
    });
    await recordRecommendation(admin, d);
  });

  assertEquals(writes.length, 1);
  assertEquals(writes[0].table, "ads_brain_decisions");
  assertEquals(writes[0].op, "upsert");
});

Deno.test("medição não usa o legado R$ 2 da coluna da campanha", async () => {
  const writes: Write[] = [];
  const admin = fakeAdmin(writes, {
    facebook_campaigns: {
      rows: [{
        id: CAMPAIGN,
        name: "Campanha legado",
        consultant_id: CONSULTANT,
        status: "active",
        fb_campaign_id: "1",
        daily_budget_cents: 3000,
        started_at: new Date(NOW - 10 * 86_400_000).toISOString(),
        brain_scale_enabled: true,
        brain_scale_target_cpl_cents: 200,
      }],
    },
  });
  const measured = await measureConsultantCampaigns(admin, {
    consultantId: CONSULTANT,
    nowMs: NOW,
    windowDays: 2,
  });
  assertEquals(measured.snapshots[0].targetCplCents, 750);
});

Deno.test("métricas velhas bloqueiam ação financeira ponta a ponta", async () => {
  const writes: Write[] = [];
  const velho = new Date(NOW - 60 * 3_600_000).toISOString();
  const admin = fakeAdmin(writes, {
    facebook_metrics_daily: {
      rows: [
        {
          campaign_id: CAMPAIGN,
          date: "2026-08-05",
          spend_cents: 3000,
          messaging_conversations_started: 20,
          clicks: 90,
          impressions: 9000,
          updated_at: velho,
        },
        {
          campaign_id: CAMPAIGN,
          date: "2026-08-06",
          spend_cents: 3000,
          messaging_conversations_started: 20,
          clicks: 95,
          impressions: 9500,
          updated_at: velho,
        },
      ],
    },
  });
  const measured = await measureConsultantCampaigns(admin, {
    consultantId: CONSULTANT,
    nowMs: NOW,
    windowDays: 2,
  });
  assertEquals(measured.dataQuality.state, "stale");

  const d = decideCampaign({
    snapshot: measured.snapshots[0],
    policy: measured.policy,
    brainConfig: measured.brainConfig,
    nowMs: NOW,
    usedSnapshotVersions: [],
  });
  assertEquals(d.action, "hold");
  assertEquals(d.canExecute, false);
  assert(d.blockers.some((b) => b.code === "dados_stale"));
});

Deno.test("mesma amostra não autoriza um segundo aumento", async () => {
  const writes: Write[] = [];
  const admin = fakeAdmin(writes);
  const measured = await measureConsultantCampaigns(admin, {
    consultantId: CONSULTANT,
    nowMs: NOW,
    windowDays: 2,
  });
  const snapshot = measured.snapshots[0];
  const segunda = decideCampaign({
    snapshot,
    policy: measured.policy,
    brainConfig: measured.brainConfig,
    nowMs: NOW,
    usedSnapshotVersions: [snapshot.version],
  });
  assertEquals(segunda.action, "hold");
  assert(segunda.blockers.some((b) => b.code === "snapshot_ja_utilizado"));
});
