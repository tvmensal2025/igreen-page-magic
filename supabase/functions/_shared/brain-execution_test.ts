import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildIdempotencyKey,
  classifyDecisionOutcome,
  idempotencyKeyForDecision,
  interpretMetaCall,
  type LiveCampaignState,
  revalidateBeforeExecution,
  shouldMarkExecuted,
  shouldRetry,
} from "./brain-execution.ts";
import { reserveExecution } from "./brain-decision-store.ts";
import type { BrainDecision } from "./brain-decide.ts";
import { resolveBrainDecisionPolicy } from "./brain-policy.ts";

const POLICY = resolveBrainDecisionPolicy({});
const NOW = Date.parse("2026-08-06T12:00:00Z");

function decision(over: Partial<BrainDecision> = {}): BrainDecision {
  return {
    campaignId: "camp-1",
    consultantId: "c1",
    snapshotVersion: "v-abc",
    decidedAtIso: "2026-08-06T11:55:00Z",
    action: "increase_budget",
    actionKind: "increase_budget",
    currentBudgetCents: 3000,
    proposedBudgetCents: 3300,
    stepPct: 10,
    confidence: "high",
    sample: {
      quality: "reliable",
      confidence: "high",
      score: 0.92,
      factors: [],
      missing: [],
    },
    health: {
      data: {
        level: "excellent",
        notes: [],
        freshnessState: "fresh",
        completenessPct: 100,
        attributionTrustRatio: 1,
      },
      meta: {
        level: "good",
        notes: [],
        spendCents: 30000,
        conversations: 45,
        cplCents: 666,
        cplVsTargetPct: 89,
        ctrBps: 500,
        cpmCents: 225,
        frequencyX100: 120,
      },
      commercial: {
        level: "good",
        notes: [],
        leadsTrusted: 18,
        registrationsTrusted: 10,
        approvedTrusted: 6,
        approvedLowConfidence: 0,
        conversionRatePct: 33.3,
        costPerLeadCents: 1666,
        cacCents: 5000,
        hasEnoughData: true,
      },
    },
    support: {
      support: "commercial_attribution_full",
      confidenceCeiling: "high",
      allowsCommercialWin: true,
      allowsExpansive: true,
      signals: ["fb_campaign_id", "source_ad_id"],
      reason: "18 lead(s) com anúncio confirmado e sem duplicidade",
    },
    wasteGuardMode: "recommend",
    reason: "aumentar 10%",
    blockers: [],
    nextEvaluation: "após 24h",
    canRecommend: true,
    canExecute: true,
    measured: {
      spendCents: 30000,
      conversations: 45,
      cplCents: 666,
      leadsTrusted: 18,
      registrationsTrusted: 10,
      approvedTrusted: 6,
      runwayDays: 20,
      windowStart: "2026-08-04",
      windowEnd: "2026-08-06",
      dataQualityState: "fresh",
    },
    ...over,
  };
}

function live(over: Partial<LiveCampaignState> = {}): LiveCampaignState {
  return {
    status: "active",
    dailyBudgetCents: 3000,
    fbCampaignId: "120200",
    lastExecutionAtIso: null,
    ...over,
  };
}

// ───────────────────────── Idempotência ─────────────────────────

Deno.test("mesma transição gera a mesma chave", async () => {
  const a = await idempotencyKeyForDecision(decision());
  const b = await idempotencyKeyForDecision(decision());
  assertEquals(a, b);
});

Deno.test("transição diferente gera chave diferente", async () => {
  const a = await idempotencyKeyForDecision(decision());
  const b = await idempotencyKeyForDecision(
    decision({ currentBudgetCents: 3300, proposedBudgetCents: 3630 }),
  );
  assertNotEquals(a, b);
});

Deno.test("snapshot diferente gera chave diferente", async () => {
  const a = await idempotencyKeyForDecision(decision());
  const b = await idempotencyKeyForDecision(decision({ snapshotVersion: "v-xyz" }));
  assertNotEquals(a, b);
});

Deno.test("chave não depende da ordem dos campos", async () => {
  const a = await buildIdempotencyKey({
    consultantId: "c1",
    campaignId: "c",
    actionKind: "increase_budget",
    snapshotVersion: "v",
    fromBudgetCents: 100,
    toBudgetCents: 110,
  });
  const b = await buildIdempotencyKey({
    toBudgetCents: 110,
    fromBudgetCents: 100,
    snapshotVersion: "v",
    actionKind: "increase_budget",
    campaignId: "c",
    consultantId: "c1",
  } as never);
  assertEquals(a, b);
});

Deno.test("chave isola tenant: mesma campanha, outro consultor", async () => {
  const base = {
    campaignId: "camp-1",
    actionKind: "increase_budget",
    snapshotVersion: "v",
    fromBudgetCents: 100,
    toBudgetCents: 110,
  };
  const a = await buildIdempotencyKey({ ...base, consultantId: "c1" });
  const b = await buildIdempotencyKey({ ...base, consultantId: "c2" });
  assertNotEquals(a, b);
  // E a decisão carrega o tenant até a chave — a reserva de um consultor não
  // pode consumir o UNIQUE global e travar a execução de outro.
  assertNotEquals(
    await idempotencyKeyForDecision(decision()),
    await idempotencyKeyForDecision(decision({ consultantId: "outro" })),
  );
});

// ──────────────── Reserva atômica (duas instâncias) ────────────────

/** Simula o UNIQUE de `idempotency_key` no banco. */
function fakeClientWithUniqueKey() {
  const inserted = new Set<string>();
  return {
    from() {
      let row: Record<string, unknown> = {};
      const api = {
        insert(payload: Record<string, unknown>) {
          row = payload;
          return api;
        },
        select() {
          return api;
        },
        maybeSingle() {
          const key = String(row.idempotency_key);
          if (inserted.has(key)) return Promise.resolve({ data: null, error: null });
          inserted.add(key);
          return Promise.resolve({ data: { id: `id-${inserted.size}` }, error: null });
        },
      };
      return api;
    },
  };
}

Deno.test("duas instâncias concorrentes: só uma reserva a execução", async () => {
  const client = fakeClientWithUniqueKey();
  const d = decision();
  const [a, b] = await Promise.all([
    reserveExecution(client, d),
    reserveExecution(client, d),
  ]);
  assertEquals([a.reserved, b.reserved].filter(Boolean).length, 1);
  const perdedor = a.reserved ? b : a;
  assertEquals(perdedor.reason, "ja_reservada");
});

Deno.test("retry da mesma decisão não reserva de novo", async () => {
  const client = fakeClientWithUniqueKey();
  const d = decision();
  assertEquals((await reserveExecution(client, d)).reserved, true);
  assertEquals((await reserveExecution(client, d)).reserved, false);
});

Deno.test("tabela ausente não derruba o fluxo", async () => {
  const client = {
    from() {
      const api = {
        insert: () => api,
        select: () => api,
        maybeSingle: () =>
          Promise.resolve({
            data: null,
            error: { code: "42P01", message: 'relation "x" does not exist' },
          }),
      };
      return api;
    },
  };
  const r = await reserveExecution(client, decision());
  assertEquals(r.reserved, false);
  assertEquals(r.reason, "tabela_ausente");
});

// ─────────────────────── Revalidação ───────────────────────

Deno.test("estado coerente libera a escrita", () => {
  const r = revalidateBeforeExecution({
    decision: decision(),
    live: live(),
    policy: POLICY,
    nowMs: NOW,
  });
  assertEquals(r.ok, true);
});

Deno.test("orçamento mudou entre medir e executar: não escreve", () => {
  const r = revalidateBeforeExecution({
    decision: decision(),
    live: live({ dailyBudgetCents: 3300 }),
    policy: POLICY,
    nowMs: NOW,
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "orcamento_divergente");
});

Deno.test("campanha pausada no Ads Manager: não aumenta", () => {
  const r = revalidateBeforeExecution({
    decision: decision(),
    live: live({ status: "paused" }),
    policy: POLICY,
    nowMs: NOW,
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "campanha_nao_ativa");
});

Deno.test("campanha já pausada não é pausada de novo", () => {
  const r = revalidateBeforeExecution({
    decision: decision({ action: "pause_waste", actionKind: "pause_waste" }),
    live: live({ status: "paused" }),
    policy: POLICY,
    nowMs: NOW,
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "ja_pausada");
});

Deno.test("outro tick executou há pouco: respeita o intervalo mínimo", () => {
  const r = revalidateBeforeExecution({
    decision: decision(),
    live: live({ lastExecutionAtIso: "2026-08-06T06:00:00Z" }),
    policy: POLICY,
    nowMs: NOW,
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "intervalo_minimo");
});

Deno.test("decisão velha não é executada", () => {
  const r = revalidateBeforeExecution({
    decision: decision({ decidedAtIso: "2026-08-06T09:00:00Z" }),
    live: live(),
    policy: POLICY,
    nowMs: NOW,
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "decisao_velha");
});

Deno.test("decisão bloqueada ou sem autorização nunca chega à Meta", () => {
  const bloqueada = revalidateBeforeExecution({
    decision: decision({
      blockers: [{ code: "carteira_insuficiente", message: "x" }],
    }),
    live: live(),
    policy: POLICY,
    nowMs: NOW,
  });
  assertEquals(bloqueada.ok, false);
  const semAuth = revalidateBeforeExecution({
    decision: decision({ canExecute: false }),
    live: live(),
    policy: POLICY,
    nowMs: NOW,
  });
  assertEquals(semAuth.ok, false);
  if (!semAuth.ok) assertEquals(semAuth.code, "decisao_nao_autorizada");
});

Deno.test("campanha sem id na Meta não é executada", () => {
  const r = revalidateBeforeExecution({
    decision: decision(),
    live: live({ fbCampaignId: null }),
    policy: POLICY,
    nowMs: NOW,
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "sem_id_meta");
});

// ──────────────────── Resposta da Meta ────────────────────

Deno.test("erro da Meta não vira sucesso local", () => {
  const outcome = interpretMetaCall({
    ok: false,
    httpStatus: 400,
    body: "Invalid parameter",
  });
  assertEquals(outcome.status, "error");
  assertEquals(shouldMarkExecuted(outcome), false);
  assertEquals(shouldRetry(outcome), false);
});

Deno.test("timeout não vira sucesso e permite retry protegido", () => {
  const outcome = interpretMetaCall({
    ok: false,
    error: new Error("request timed out"),
  });
  assertEquals(outcome.status, "timeout");
  assertEquals(shouldMarkExecuted(outcome), false);
  assertEquals(shouldRetry(outcome), true);
});

Deno.test("429 e 5xx são retentáveis, 4xx de negócio não", () => {
  assertEquals(shouldRetry(interpretMetaCall({ ok: false, httpStatus: 429 })), true);
  assertEquals(shouldRetry(interpretMetaCall({ ok: false, httpStatus: 503 })), true);
  assertEquals(shouldRetry(interpretMetaCall({ ok: false, httpStatus: 403 })), false);
});

Deno.test("sucesso confirmado marca executado", () => {
  const outcome = interpretMetaCall({ ok: true, body: { success: true } });
  assertEquals(outcome.status, "success");
  assertEquals(shouldMarkExecuted(outcome), true);
});

// ─────────────── Resultado posterior da decisão ───────────────

Deno.test("amostra curta em qualquer janela é dado insuficiente", () => {
  const r = classifyDecisionOutcome({
    before: { cplCents: 700, conversations: 2, approved: 0 },
    after: { cplCents: 500, conversations: 40, approved: 3 },
    minConversations: 8,
  });
  assertEquals(r.outcome, "insufficient_data");
  assertEquals(r.deltaPct, null);
});

Deno.test("CPL caindo é melhora", () => {
  const r = classifyDecisionOutcome({
    before: { cplCents: 1000, conversations: 20, approved: 2 },
    after: { cplCents: 700, conversations: 30, approved: 4 },
    minConversations: 8,
  });
  assertEquals(r.outcome, "improved");
  assertEquals(r.deltaPct, -30);
});

Deno.test("variação pequena é ruído, não vitória", () => {
  const r = classifyDecisionOutcome({
    before: { cplCents: 1000, conversations: 20, approved: 2 },
    after: { cplCents: 1050, conversations: 25, approved: 2 },
    minConversations: 8,
  });
  assertEquals(r.outcome, "neutral");
});

Deno.test("CPL pior com mais clientes aprovados não conta como piora", () => {
  const r = classifyDecisionOutcome({
    before: { cplCents: 700, conversations: 20, approved: 1 },
    after: { cplCents: 1000, conversations: 30, approved: 5 },
    minConversations: 8,
  });
  assertEquals(r.outcome, "neutral");
  assertEquals(r.reason.includes("aprovados"), true);
});

Deno.test("CPL pior sem ganho comercial é piora", () => {
  const r = classifyDecisionOutcome({
    before: { cplCents: 700, conversations: 20, approved: 3 },
    after: { cplCents: 1200, conversations: 30, approved: 3 },
    minConversations: 8,
  });
  assertEquals(r.outcome, "worsened");
});

Deno.test("sem CPL em uma das janelas é inconclusivo", () => {
  const r = classifyDecisionOutcome({
    before: { cplCents: null, conversations: 20, approved: 0 },
    after: { cplCents: 700, conversations: 20, approved: 0 },
    minConversations: 8,
  });
  assertEquals(r.outcome, "inconclusive");
});
