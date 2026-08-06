import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type BrainDataQualityInput,
  evaluateBrainDataQuality,
} from "./brain-data-quality.ts";

const NOW = Date.parse("2026-08-06T12:00:00Z");

function input(over: Partial<BrainDataQualityInput> = {}): BrainDataQualityInput {
  return {
    nowMs: NOW,
    lastMetaSyncAtIso: "2026-08-06T10:00:00Z",
    windowStart: "2026-08-04",
    windowEnd: "2026-08-06",
    campaignsFound: 2,
    metricRowsFound: 4,
    expectedMetricRows: 4,
    hasCommercialData: true,
    duplicatesIgnored: 0,
    activeCampaignsWithoutMetrics: 0,
    maxMetricsAgeHours: 26,
    ...over,
  };
}

Deno.test("dados recentes e completos liberam ação financeira", () => {
  const q = evaluateBrainDataQuality(input());
  assertEquals(q.state, "fresh");
  assertEquals(q.allowsFinancialAction, true);
  assertEquals(q.completenessPct, 100);
  assertEquals(q.windowDays, 2);
});

Deno.test("métricas antigas bloqueiam execução", () => {
  const q = evaluateBrainDataQuality(
    input({ lastMetaSyncAtIso: "2026-08-04T01:00:00Z" }),
  );
  assertEquals(q.state, "stale");
  assertEquals(q.allowsFinancialAction, false);
});

Deno.test("métricas incompletas bloqueiam execução", () => {
  const q = evaluateBrainDataQuality(
    input({ metricRowsFound: 1, expectedMetricRows: 10 }),
  );
  assertEquals(q.state, "incomplete");
  assertEquals(q.completenessPct, 10);
  assertEquals(q.allowsFinancialAction, false);
});

Deno.test("campanha ativa sem métrica é lacuna, não dado completo", () => {
  const q = evaluateBrainDataQuality(input({ activeCampaignsWithoutMetrics: 1 }));
  assertEquals(q.state, "incomplete");
  assertEquals(q.gapsDetected, 1);
});

Deno.test("duplicata vira conflito e bloqueia", () => {
  const q = evaluateBrainDataQuality(input({ duplicatesIgnored: 3 }));
  assertEquals(q.state, "conflicting");
  assertEquals(q.allowsFinancialAction, false);
  assertEquals(q.conflicts[0], "linhas_duplicadas:3");
});

Deno.test("conflito informado pelo chamador tem precedência", () => {
  const q = evaluateBrainDataQuality(
    input({ conflicts: ["conversas_maior_que_cliques"] }),
  );
  assertEquals(q.state, "conflicting");
});

Deno.test("sem métrica na janela é indisponível", () => {
  assertEquals(
    evaluateBrainDataQuality(input({ metricRowsFound: 0 })).state,
    "unavailable",
  );
  assertEquals(
    evaluateBrainDataQuality(input({ campaignsFound: 0 })).state,
    "unavailable",
  );
});

Deno.test("sem horário de sincronização não dá para confiar na janela", () => {
  const q = evaluateBrainDataQuality(input({ lastMetaSyncAtIso: null }));
  assertEquals(q.state, "unavailable");
  assertEquals(q.metricsAgeHours, null);
  assertEquals(q.allowsFinancialAction, false);
});

// A Meta não emite linha de insights para dia sem entrega. Sem distinguir isso
// de falha de sincronização, o Cérebro acusa "dados indisponíveis" para uma
// conta que apenas não está anunciando.

Deno.test("sem entrega, mas com sync confirmado, o dado existe e vale zero", () => {
  const q = evaluateBrainDataQuality(
    input({
      metricRowsFound: 0,
      lastMetaSyncAtIso: null,
      syncConfirmedAtIso: "2026-08-06T11:30:00Z",
    }),
  );
  assertEquals(q.state, "fresh");
  assertEquals(q.hasDelivery, false);
  assertEquals(q.reasons.includes("sem_entrega_na_janela"), true);
});

Deno.test("entrega parcial com sync confirmado não é dado faltando", () => {
  const q = evaluateBrainDataQuality(
    input({
      metricRowsFound: 1,
      expectedMetricRows: 10,
      syncConfirmedAtIso: "2026-08-06T11:30:00Z",
    }),
  );
  assertEquals(q.state, "fresh");
  assertEquals(q.completenessPct, 100);
  assertEquals(q.hasDelivery, true);
});

Deno.test("sync confirmado antigo continua bloqueando", () => {
  const q = evaluateBrainDataQuality(
    input({
      metricRowsFound: 0,
      lastMetaSyncAtIso: null,
      syncConfirmedAtIso: "2026-08-03T11:30:00Z",
    }),
  );
  assertEquals(q.state, "stale");
  assertEquals(q.allowsFinancialAction, false);
});

Deno.test("sync que não passou pela campanha continua sendo lacuna", () => {
  const q = evaluateBrainDataQuality(
    input({
      activeCampaignsWithoutMetrics: 1,
      syncConfirmedAtIso: "2026-08-06T11:30:00Z",
    }),
  );
  assertEquals(q.state, "incomplete");
  assertEquals(q.gapsDetected, 1);
});

Deno.test("sem carimbo de sync o comportamento antigo é preservado", () => {
  assertEquals(
    evaluateBrainDataQuality(input({ metricRowsFound: 0 })).state,
    "unavailable",
  );
  assertEquals(
    evaluateBrainDataQuality(input({ metricRowsFound: 1, expectedMetricRows: 10 }))
      .state,
    "incomplete",
  );
});

Deno.test("ausência de dado comercial é registrada sem derrubar o estado", () => {
  const q = evaluateBrainDataQuality(input({ hasCommercialData: false }));
  assertEquals(q.state, "fresh");
  assertEquals(q.hasCommercialData, false);
  assertEquals(q.reasons.includes("sem_dado_comercial_na_janela"), true);
});
