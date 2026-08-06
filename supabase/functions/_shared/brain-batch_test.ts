/**
 * Lote automático: roda sem painel, não fala com a Meta e não duplica nada.
 *
 * O banco falso aqui imita o que importa para o teste: o UNIQUE de
 * `idempotency_key` em `ads_brain_decisions` e o de `dedup_key` em
 * `ad_recommendations`. Sem isso, "não duplica" seria só uma afirmação.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  listEligibleConsultants,
  runOutcomeEvaluation,
  runScheduledShadow,
} from "./brain-batch.ts";

const CONSULTANT_A = "11111111-1111-4111-8111-111111111111";
const CONSULTANT_B = "22222222-2222-4222-8222-222222222222";
const CAMP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAMP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-08-06T12:00:00Z");
const RECENT = new Date(NOW - 20 * 60_000).toISOString();

type Row = Record<string, unknown>;

type FakeDb = {
  campaigns: Row[];
  metrics: Row[];
  customers: Row[];
  decisions: Row[];
  recommendations: Row[];
  settings: Row | null;
  wallet: Row | null;
  /** Campanhas cuja gravação de decisão deve explodir. */
  failOnCampaign?: Set<string>;
  /** Consultores cuja medição deve explodir. */
  failOnConsultant?: Set<string>;
};

function campaign(over: Partial<Row> = {}): Row {
  return {
    id: CAMP_A,
    name: "Âncora",
    consultant_id: CONSULTANT_A,
    status: "active",
    fb_campaign_id: "120200",
    daily_budget_cents: 2300,
    rejection_reason: null,
    started_at: new Date(NOW - 12 * 86_400_000).toISOString(),
    created_at: new Date(NOW - 12 * 86_400_000).toISOString(),
    updated_at: RECENT,
    brain_scale_enabled: false,
    brain_scale_last_at: null,
    brain_scale_target_cpl_cents: 200,
    ...over,
  };
}

/**
 * Cliente Supabase falso com UNIQUE de verdade nas duas chaves.
 * Só implementa o que o lote usa.
 */
function fakeDb(seed: Partial<FakeDb> = {}) {
  const db: FakeDb = {
    campaigns: seed.campaigns ?? [campaign()],
    metrics: seed.metrics ?? [],
    customers: seed.customers ?? [],
    decisions: seed.decisions ?? [],
    recommendations: seed.recommendations ?? [],
    settings: seed.settings ?? { brain_config: null },
    wallet: seed.wallet ?? { balance_cents: 500000, debt_cents: 0 },
    failOnCampaign: seed.failOnCampaign,
    failOnConsultant: seed.failOnConsultant,
  };
  const stats = { inserts: 0, uniqueRejections: 0 };

  const client = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let pendingWrite: { op: string; row: Row; onConflict?: string } | null = null;

      const rowsFor = (): Row[] => {
        if (table === "facebook_campaigns") {
          if (db.failOnCampaign?.size) {
            for (const f of filters) {
              if (f[0] === "in" && f[1] === "campaign_id") { /* noop */ }
            }
          }
          return db.campaigns;
        }
        if (table === "facebook_metrics_daily") return db.metrics;
        if (table === "customers") return db.customers;
        if (table === "ads_brain_decisions") return db.decisions;
        if (table === "ad_recommendations") return db.recommendations;
        return [];
      };

      const applyFilters = (rows: Row[]): Row[] =>
        rows.filter((r) =>
          filters.every(([op, col, val]) => {
            if (op === "eq") return String(r[col] ?? "") === String(val);
            if (op === "in") return (val as unknown[]).map(String).includes(String(r[col]));
            if (op === "is") return r[col] == null;
            return true;
          })
        );

      const q: Record<string, unknown> = {};
      for (const m of ["select", "order", "gte", "lte", "lt", "or", "limit"]) {
        q[m] = () => q;
      }
      for (const m of ["eq", "in", "is"]) {
        q[m] = (col: string, val: unknown) => {
          filters.push([m, col, val]);
          return q;
        };
      }

      const runWrite = (): { data: Row | null; error: unknown } => {
        if (!pendingWrite) return { data: null, error: null };
        const { row, onConflict } = pendingWrite;
        if (table === "ads_brain_decisions") {
          if (db.failOnCampaign?.has(String(row.campaign_id))) {
            throw new Error("falha simulada ao gravar decisão");
          }
          const clash = db.decisions.some((d) =>
            d.idempotency_key === row.idempotency_key
          );
          if (clash && onConflict) {
            stats.uniqueRejections++;
            return { data: null, error: null };
          }
          const saved = { id: `dec-${db.decisions.length + 1}`, ...row };
          db.decisions.push(saved);
          stats.inserts++;
          return { data: { id: saved.id }, error: null };
        }
        if (table === "ad_recommendations") {
          const clash = db.recommendations.some((r) =>
            r.dedup_key && r.dedup_key === row.dedup_key
          );
          if (clash && onConflict) {
            stats.uniqueRejections++;
            return { data: null, error: null };
          }
          const saved = { id: `rec-${db.recommendations.length + 1}`, ...row };
          db.recommendations.push(saved);
          stats.inserts++;
          return { data: { id: saved.id }, error: null };
        }
        return { data: null, error: null };
      };

      for (const m of ["insert", "upsert"]) {
        q[m] = (row: Row, opts?: { onConflict?: string }) => {
          pendingWrite = { op: m, row, onConflict: opts?.onConflict };
          return q;
        };
      }
      q.update = (patch: Row) => {
        pendingWrite = { op: "update", row: patch };
        return q;
      };

      q.maybeSingle = () => {
        if (pendingWrite?.op === "update") {
          const target = applyFilters(db.decisions);
          if (!target.length) return Promise.resolve({ data: null, error: null });
          Object.assign(target[0], pendingWrite.row);
          return Promise.resolve({ data: { id: target[0].id }, error: null });
        }
        if (pendingWrite) {
          try {
            return Promise.resolve(runWrite());
          } catch (e) {
            return Promise.reject(e);
          }
        }
        if (table === "consultant_ad_settings") {
          const alvo = filters.find(([op, col]) => op === "eq" && col === "consultant_id");
          if (alvo && db.failOnConsultant?.has(String(alvo[2]))) {
            return Promise.reject(new Error("configuração ilegível deste consultor"));
          }
          return Promise.resolve({ data: db.settings, error: null });
        }
        if (table === "consultant_wallet") {
          return Promise.resolve({ data: db.wallet, error: null });
        }
        return Promise.resolve({ data: applyFilters(rowsFor())[0] ?? null, error: null });
      };
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (pendingWrite) {
          try {
            return Promise.resolve(runWrite()).then(res, rej);
          } catch (e) {
            return Promise.reject(e).then(res, rej);
          }
        }
        if (table === "facebook_campaigns" && db.failOnCampaign?.size) {
          const rows = applyFilters(db.campaigns);
          const boom = rows.find((r) => db.failOnCampaign?.has(String(r.id)));
          if (boom && filters.some(([op, col]) => op === "eq" && col === "consultant_id")) {
            // A leitura passa; a explosão acontece na hora de gravar.
          }
        }
        return Promise.resolve({ data: applyFilters(rowsFor()), error: null })
          .then(res, rej);
      };
      return q;
    },
  };

  return { client, db, stats };
}

/** Qualquer `fetch` durante o lote é falha. */
async function withoutNetwork<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    throw new Error("o lote não pode falar com a Meta");
  }) as typeof fetch;
  try {
    const out = await fn();
    assertEquals(calls, 0, "nenhuma chamada de rede pode acontecer no lote");
    return out;
  } finally {
    globalThis.fetch = original;
  }
}

// ───────────────────────── Execução sem painel ─────────────────────────

Deno.test("lote roda sem painel, persiste decisão e não chama a Meta", async () => {
  const { client, db } = fakeDb();
  const result = await withoutNetwork(() =>
    runScheduledShadow(client, { nowMs: NOW, windowDays: 2 })
  );

  assertEquals(result.calledMeta, false);
  assertEquals(result.changedCampaign, false);
  assertEquals(result.consultantsProcessed, 1);
  assertEquals(result.campaignsEvaluated, 1);
  assertEquals(result.decisionsPersisted, 1);
  assertEquals(result.failures, 0);
  assertEquals(db.decisions.length, 1);
  assert(result.correlationId.startsWith("shadow-"));
  // Correlation ID viaja junto com a decisão, para o painel ligar as duas coisas.
  assertEquals(
    (db.decisions[0].measured as Record<string, unknown>).correlationId,
    result.correlationId,
  );
});

Deno.test("campanha sem entrega fica em hold e não abre recomendação", async () => {
  const { client, db } = fakeDb();
  const result = await withoutNetwork(() =>
    runScheduledShadow(client, { nowMs: NOW, windowDays: 2 })
  );
  assertEquals(result.holds, 1);
  assertEquals(result.inboxCreated, 0, "hold não vira tarefa para o consultor");
  assertEquals(db.recommendations.length, 0);
  assertEquals(db.decisions[0].action, "hold");
});

Deno.test("mesma amostra duas vezes não duplica decisão", async () => {
  const { client, db, stats } = fakeDb();
  const first = await runScheduledShadow(client, { nowMs: NOW, windowDays: 2 });
  const second = await runScheduledShadow(client, { nowMs: NOW, windowDays: 2 });

  assertEquals(first.decisionsPersisted, 1);
  assertEquals(second.decisionsPersisted, 0);
  assertEquals(second.duplicatesSkipped, 1);
  assertEquals(db.decisions.length, 1, "o UNIQUE segurou a segunda gravação");
  assert(stats.uniqueRejections >= 1);
});

Deno.test("duas execuções concorrentes não duplicam", async () => {
  const { client, db } = fakeDb();
  const [a, b] = await Promise.all([
    runScheduledShadow(client, { nowMs: NOW, windowDays: 2, correlationId: "corr-a" }),
    runScheduledShadow(client, { nowMs: NOW, windowDays: 2, correlationId: "corr-b" }),
  ]);
  assertEquals(db.decisions.length, 1);
  assertEquals(a.decisionsPersisted + b.decisionsPersisted, 1);
  assertEquals(a.duplicatesSkipped + b.duplicatesSkipped, 1);
});

Deno.test("falha em uma campanha não interrompe as demais", async () => {
  const { client, db } = fakeDb({
    campaigns: [
      campaign({ id: CAMP_A }),
      campaign({ id: CAMP_B, name: "Explorer" }),
    ],
    failOnCampaign: new Set([CAMP_B]),
  });

  const result = await runScheduledShadow(client, { nowMs: NOW, windowDays: 2 });

  assertEquals(result.campaignsEvaluated, 2, "as duas foram avaliadas");
  assertEquals(result.failures, 1, "só a gravação da ruim falhou");
  assertEquals(result.decisionsPersisted, 1);
  assertEquals(db.decisions.length, 1, "a campanha boa gravou mesmo assim");
  assertEquals(String(db.decisions[0].campaign_id), CAMP_A);

  const erro = result.consultants[0].campaigns.find((c) => c.campaignId === CAMP_B);
  assert(erro?.error?.includes("falha simulada"));
  const ok = result.consultants[0].campaigns.find((c) => c.campaignId === CAMP_A);
  assertEquals(ok?.persisted, true);
  assertEquals(ok?.error, null);
});

Deno.test("consultor com medição quebrada não derruba o lote", async () => {
  const { client, db } = fakeDb({
    campaigns: [
      campaign({ id: CAMP_A, consultant_id: CONSULTANT_A }),
      campaign({ id: CAMP_B, consultant_id: CONSULTANT_B, name: "Outra" }),
    ],
    failOnConsultant: new Set([CONSULTANT_A]),
  });

  const result = await runScheduledShadow(client, { nowMs: NOW, windowDays: 2 });

  assertEquals(result.consultantsProcessed, 2);
  assertEquals(result.failures, 1);
  const quebrado = result.consultants.find((c) => c.consultantId === CONSULTANT_A);
  assertEquals(quebrado?.campaignsEvaluated, 0);
  assert(quebrado?.error?.includes("configuração ilegível"));

  const saudavel = result.consultants.find((c) => c.consultantId === CONSULTANT_B);
  assertEquals(saudavel?.campaignsEvaluated, 1);
  assertEquals(saudavel?.error, null);
  assertEquals(db.decisions.length, 1, "o consultor saudável foi registrado");
});

Deno.test("consultor sem campanha viva não gera trabalho", async () => {
  const { client } = fakeDb({ campaigns: [] });
  assertEquals(await listEligibleConsultants(client), []);
  const result = await runScheduledShadow(client, { nowMs: NOW });
  assertEquals(result.consultantsProcessed, 0);
  assertEquals(result.campaignsEvaluated, 0);
  assertEquals(result.failures, 0, "lote vazio é sucesso, não erro");
});

Deno.test("dois consultores são processados de forma independente", async () => {
  const { client, db } = fakeDb({
    campaigns: [
      campaign({ id: CAMP_A, consultant_id: CONSULTANT_A }),
      campaign({ id: CAMP_B, consultant_id: CONSULTANT_B, name: "Outra" }),
    ],
  });
  const result = await runScheduledShadow(client, { nowMs: NOW, windowDays: 2 });
  assertEquals(result.consultantsProcessed, 2);
  assertEquals(new Set(db.decisions.map((d) => d.consultant_id)).size, 2);
  // Chaves diferentes por tenant: um não bloqueia o outro.
  assertEquals(
    new Set(db.decisions.map((d) => d.idempotency_key)).size,
    2,
  );
});

Deno.test("histórico ausente fica visível em vez de falhar calado", async () => {
  const { client } = fakeDb();
  const brokenClient = {
    from(table: string) {
      const q = client.from(table);
      if (table === "ads_brain_decisions") {
        const failing: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "is", "gte", "lte", "lt", "order", "limit", "upsert", "insert", "update"]) {
          failing[m] = () => failing;
        }
        const err = { code: "42P01", message: 'relation "ads_brain_decisions" does not exist' };
        failing.maybeSingle = () => Promise.resolve({ data: null, error: err });
        failing.single = failing.maybeSingle;
        failing.then = (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: err }).then(res);
        return failing;
      }
      return q;
    },
  };

  const result = await runScheduledShadow(brokenClient, { nowMs: NOW, windowDays: 2 });
  assertEquals(result.storageMissing, true);
  assertEquals(result.calledMeta, false);
  assert(result.campaignsEvaluated >= 1, "continua decidindo mesmo sem histórico");
});

// ───────────────────────── Desfechos ─────────────────────────

function decisionRow(over: Partial<Row> = {}): Row {
  return {
    id: "dec-1",
    consultant_id: CONSULTANT_A,
    campaign_id: CAMP_A,
    action: "hold",
    decided_at: new Date(NOW - 30 * 3_600_000).toISOString(),
    measured: {
      spendCents: 10000,
      conversations: 10,
      cplCents: 1000,
      leadsTrusted: 3,
      approvedTrusted: 1,
    },
    outcome_metrics: null,
    outcome_evaluated_at: null,
    idempotency_key: "k1",
    ...over,
  };
}

Deno.test("desfecho de 24h é gravado uma vez só", async () => {
  const { client, db } = fakeDb({ decisions: [decisionRow()] });

  const first = await withoutNetwork(() =>
    runOutcomeEvaluation(client, { nowMs: NOW })
  );
  assertEquals(first.calledMeta, false);
  assertEquals(first.evaluated, 1);
  assertEquals(first.recorded, 1);
  assertEquals(first.items[0].window, "24h");

  const saved = db.decisions[0];
  assert(saved.outcome_metrics, "desfecho ficou salvo no jsonb existente");
  assertEquals(Object.keys(saved.outcome_metrics as object), ["24h"]);

  // Retry na mesma janela não grava de novo.
  const second = await runOutcomeEvaluation(client, { nowMs: NOW });
  assertEquals(second.recorded, 0);
  assertEquals(Object.keys(db.decisions[0].outcome_metrics as object), ["24h"]);
});

Deno.test("sem entrega depois da decisão o desfecho é dados insuficientes", async () => {
  const { client, db } = fakeDb({ decisions: [decisionRow()] });
  const r = await runOutcomeEvaluation(client, { nowMs: NOW });
  assertEquals(r.items[0].state.startsWith("insufficient_data"), true);
  const metrics = db.decisions[0].outcome_metrics as Record<string, { state: string }>;
  assertEquals(metrics["24h"].state, "insufficient_data");
});

Deno.test("decisão nova demais não entra na fila de desfecho", async () => {
  const { client } = fakeDb({
    decisions: [decisionRow({ decided_at: new Date(NOW - 3 * 3_600_000).toISOString() })],
  });
  const r = await runOutcomeEvaluation(client, { nowMs: NOW });
  assertEquals(r.evaluated, 0);
  assertEquals(r.recorded, 0);
});

Deno.test("janelas de 72h e 7d são gravadas separadamente", async () => {
  const { client, db } = fakeDb({
    decisions: [decisionRow({ decided_at: new Date(NOW - 80 * 3_600_000).toISOString() })],
  });

  await runOutcomeEvaluation(client, { nowMs: NOW });
  assertEquals(Object.keys(db.decisions[0].outcome_metrics as object), ["72h"]);

  // Uma semana depois, a janela de 7d entra sem apagar a anterior.
  await runOutcomeEvaluation(client, { nowMs: NOW + 100 * 3_600_000 });
  assertEquals(
    Object.keys(db.decisions[0].outcome_metrics as object).sort(),
    ["72h", "7d"],
  );
});

Deno.test("tabela de histórico ausente não quebra a avaliação", async () => {
  const failing: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte", "order", "limit"]) {
    failing[m] = () => failing;
  }
  const err = { code: "42P01", message: "does not exist" };
  failing.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: err }).then(res);

  const r = await runOutcomeEvaluation({ from: () => failing }, { nowMs: NOW });
  assertEquals(r.storageMissing, true);
  assertEquals(r.recorded, 0);
  assertEquals(r.calledMeta, false);
});
