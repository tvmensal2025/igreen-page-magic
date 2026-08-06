import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateOutcome,
  isWindowRecorded,
  mergeOutcomeMetrics,
  type OutcomeMetricsJson,
  type OutcomeSample,
  pendingOutcomeWindow,
  sampleFromMeasured,
} from "./brain-outcome.ts";

const DECIDED = "2026-08-01T12:00:00Z";
const DECIDED_MS = Date.parse(DECIDED);
const H = 3_600_000;

function sample(over: Partial<OutcomeSample> = {}): OutcomeSample {
  return {
    spendCents: 10000,
    conversations: 10,
    cplCents: 1000,
    leadsTrusted: 4,
    approvedTrusted: 1,
    ...over,
  };
}

function evaluate(
  before: OutcomeSample,
  after: OutcomeSample,
  window: "24h" | "72h" | "7d" = "24h",
) {
  return evaluateOutcome({ window, before, after, nowMs: DECIDED_MS + 25 * H });
}

// ─────────────────────────── Janelas ───────────────────────────

Deno.test("cada janela vence no seu tempo", () => {
  const pend = (hours: number, existing?: OutcomeMetricsJson) =>
    pendingOutcomeWindow({
      decidedAtIso: DECIDED,
      nowMs: DECIDED_MS + hours * H,
      existing,
    });

  assertEquals(pend(23), null, "antes de 24h nada vence");
  assertEquals(pend(24), "24h");
  assertEquals(pend(71), "24h");
  assertEquals(pend(72), "72h", "fila atrasada pega a maior janela vencida");
  assertEquals(pend(168), "7d");
});

Deno.test("janela já registrada não volta para a fila", () => {
  const done: OutcomeMetricsJson = {
    "24h": {
      window: "24h",
      state: "improved",
      reason: "x",
      before: sample(),
      after: sample(),
      cplDeltaPct: -20,
      evaluatedAtIso: DECIDED,
    },
  };
  assertEquals(
    pendingOutcomeWindow({ decidedAtIso: DECIDED, nowMs: DECIDED_MS + 30 * H, existing: done }),
    null,
  );
  assertEquals(
    pendingOutcomeWindow({ decidedAtIso: DECIDED, nowMs: DECIDED_MS + 80 * H, existing: done }),
    "72h",
  );
  assertEquals(isWindowRecorded(done, "24h"), true);
  assertEquals(isWindowRecorded(done, "72h"), false);
});

Deno.test("retry não sobrescreve a leitura original da janela", () => {
  const first = evaluate(sample(), sample({ cplCents: 700 }));
  const merged = mergeOutcomeMetrics(null, first);
  const second = evaluate(sample(), sample({ cplCents: 5000 }));
  const again = mergeOutcomeMetrics(merged, second);

  assertEquals(again["24h"]?.state, first.state);
  assertEquals(again["24h"]?.reason, first.reason, "a primeira leitura é a que vale");
});

Deno.test("as três janelas convivem no mesmo registro", () => {
  let metrics: OutcomeMetricsJson = {};
  for (const w of ["24h", "72h", "7d"] as const) {
    metrics = mergeOutcomeMetrics(
      metrics,
      evaluate(sample(), sample({ cplCents: 700 }), w),
    );
  }
  assertEquals(Object.keys(metrics).sort(), ["24h", "72h", "7d"]);
});

// ─────────────────────────── Classificação ───────────────────────────

Deno.test("sem entrega na janela seguinte é dado insuficiente", () => {
  const r = evaluate(
    sample(),
    sample({ spendCents: 0, conversations: 0, cplCents: null }),
  );
  assertEquals(r.state, "insufficient_data");
  assert(r.reason.includes("nenhuma entrega"));
});

Deno.test("cliente aprovado prevalece sobre conversa barata", () => {
  // Custo por conversa piorou 100%, mas apareceu cliente aprovado.
  const r = evaluate(
    sample({ approvedTrusted: 1 }),
    sample({ cplCents: 2000, approvedTrusted: 3 }),
  );
  assertEquals(r.state, "improved");
  assert(r.reason.includes("cliente"));
});

Deno.test("custo por conversa caindo é melhora", () => {
  const r = evaluate(sample(), sample({ cplCents: 700 }));
  assertEquals(r.state, "improved");
  assertEquals(r.cplDeltaPct, -30);
});

Deno.test("custo por conversa subindo sem ganho comercial é piora", () => {
  const r = evaluate(sample(), sample({ cplCents: 1500 }));
  assertEquals(r.state, "worsened");
  assertEquals(r.cplDeltaPct, 50);
});

Deno.test("variação pequena é ruído, não resultado", () => {
  const r = evaluate(sample(), sample({ cplCents: 1050 }));
  assertEquals(r.state, "neutral");
});

Deno.test("amostra pequena dos dois lados é inconclusivo", () => {
  const r = evaluate(
    sample({ conversations: 1, cplCents: 900 }),
    sample({ conversations: 2, cplCents: 400, leadsTrusted: 4 }),
  );
  assertEquals(r.state, "inconclusive");
  assert(r.reason.includes("amostra pequena"));
});

Deno.test("amostra pequena com lead novo já conta como melhora", () => {
  const r = evaluate(
    sample({ conversations: 1, leadsTrusted: 0 }),
    sample({ conversations: 2, leadsTrusted: 2 }),
  );
  assertEquals(r.state, "improved");
});

Deno.test("cliente não é contado duas vezes entre janelas", () => {
  // O mesmo cliente aprovado nas duas medições não gera "melhorou".
  const r = evaluate(
    sample({ approvedTrusted: 2 }),
    sample({ approvedTrusted: 2, cplCents: 1010 }),
  );
  assertEquals(r.state, "neutral");
});

Deno.test("sem custo comparável em uma das janelas é inconclusivo", () => {
  const r = evaluate(
    sample({ cplCents: null }),
    sample({ cplCents: 900, approvedTrusted: 1 }),
  );
  assertEquals(r.state, "inconclusive");
  assertEquals(r.cplDeltaPct, null);
});

Deno.test("amostra congelada da decisão é lida sem quebrar", () => {
  assertEquals(sampleFromMeasured(null), {
    spendCents: 0,
    conversations: 0,
    cplCents: null,
    leadsTrusted: 0,
    approvedTrusted: 0,
  });
  const s = sampleFromMeasured({
    spendCents: 5000,
    conversations: 8,
    cplCents: 625,
    leadsTrusted: 3,
    approvedTrusted: 1,
    support: "meta_only",
  });
  assertEquals(s.cplCents, 625);
  assertEquals(s.leadsTrusted, 3);
});
