import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ageInDays, buildCboReviewTitle, evaluateCboToAbo } from "./cbo-abo.ts";

const MATURE = {
  name: "MG Uberlândia",
  leadsCount: 25,
  cityCount: 3,
  ageDays: 10,
};

Deno.test("campanha madura com várias praças gera revisão humana", () => {
  const verdict = evaluateCboToAbo(MATURE);
  assertEquals(verdict.action, "recommend_review");
  if (verdict.action !== "recommend_review") return;
  assertEquals(verdict.title, buildCboReviewTitle("MG Uberlândia"));
  assertEquals(verdict.message.includes("25 resultados em 3 cidades"), true);
  // Deixa explícito que nada foi criado automaticamente.
  assertEquals(verdict.message.includes("nenhuma campanha nova"), true);
});

Deno.test("uma praça só nunca vira divisão por região", () => {
  const verdict = evaluateCboToAbo({ ...MATURE, cityCount: 1 });
  assertEquals(verdict, { action: "none", reason: "single_city" });
});

Deno.test("respeita fase de aprendizado antes de 7 dias", () => {
  const verdict = evaluateCboToAbo({ ...MATURE, ageDays: 6 });
  assertEquals(verdict, { action: "none", reason: "learning_phase" });
});

Deno.test("amostra pequena não recomenda", () => {
  const verdict = evaluateCboToAbo({ ...MATURE, leadsCount: 19 });
  assertEquals(verdict, { action: "none", reason: "insufficient_sample" });
});

Deno.test("valores inválidos caem no lado conservador", () => {
  const verdict = evaluateCboToAbo({
    name: "x",
    leadsCount: Number.NaN,
    cityCount: Number.NaN,
    ageDays: Number.NaN,
  });
  assertEquals(verdict.action, "none");
});

Deno.test("título é determinístico — serve de chave de deduplicação", () => {
  assertEquals(
    buildCboReviewTitle("Campanha A"),
    buildCboReviewTitle("Campanha A"),
  );
});

Deno.test("ageInDays conta dias completos e tolera entrada inválida", () => {
  const now = Date.parse("2026-07-24T12:00:00Z");
  assertEquals(ageInDays("2026-07-14T12:00:00Z", now), 10);
  assertEquals(ageInDays(null, now), 0);
  assertEquals(ageInDays("data-invalida", now), 0);
});
