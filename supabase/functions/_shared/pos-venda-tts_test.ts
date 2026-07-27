import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { saudacaoBucketBRT, textForTts, templateNeedsPersonalizedTts } from "./pos-venda-tts.ts";
import { clampToPosVendaSendWindow } from "./pos-venda-send-window.ts";

Deno.test("saudacaoBucketBRT faixas", () => {
  // 10:00 BRT = 13:00 UTC
  assertEquals(saudacaoBucketBRT(new Date("2026-07-27T13:00:00.000Z")), "manha");
  // 15:00 BRT = 18:00 UTC
  assertEquals(saudacaoBucketBRT(new Date("2026-07-27T18:00:00.000Z")), "tarde");
  // 20:00 BRT = 23:00 UTC
  assertEquals(saudacaoBucketBRT(new Date("2026-07-27T23:00:00.000Z")), "noite");
});

Deno.test("textForTts abre Olá Nome! Tudo bem?", () => {
  const out = textForTts("Olá, Maria Tudo bem?\n\nMuito boa tarde\n\nCorpo.");
  assertEquals(out.includes("Olá, Maria! Tudo bem?"), true);
  assertEquals(out.includes("Muito boa tarde"), true);
});

Deno.test("templateNeedsPersonalizedTts", () => {
  assertEquals(templateNeedsPersonalizedTts("Olá, {{nome}} Tudo bem?\n\n{{saudacao}}"), true);
  assertEquals(templateNeedsPersonalizedTts("só corpo fixo"), false);
});

Deno.test("clampToPosVendaSendWindow empurra domingo", () => {
  // Domingo 2026-07-26 15:00 BRT
  const sunday = new Date("2026-07-26T18:00:00.000Z");
  const clamped = clampToPosVendaSendWindow(sunday, sunday);
  // Segunda 08:05 BRT
  assertEquals(saudacaoBucketBRT(clamped), "manha");
});
