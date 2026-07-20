import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { textMatchesCampaignSeed } from "./cadence-hooks.ts";
import { matchesMetaCtwaPhrase } from "./meta-ctwa-fallback.ts";

Deno.test("textMatchesCampaignSeed: frase CTWA da campanha Uberlândia", () => {
  const seed = "Oi! Quero saber como consigo pagar menos na conta de luz.";
  assertEquals(textMatchesCampaignSeed(seed, seed), true);
  assertEquals(
    textMatchesCampaignSeed(
      "Oi! Quero saber como consigo pagar menos na conta de luz.",
      seed,
    ),
    true,
  );
  // Digitado de verdade — não é o seed
  assertEquals(textMatchesCampaignSeed("Meu nome é João", seed), false);
  assertEquals(textMatchesCampaignSeed("oi", seed), false);
});

Deno.test("textMatchesCampaignSeed: ignora acento/pontuação", () => {
  assertEquals(
    textMatchesCampaignSeed(
      "Oi quero saber como consigo pagar menos na conta de luz",
      "Oi! Quero saber como consigo pagar menos na conta de luz.",
    ),
    true,
  );
});

Deno.test("matchesMetaCtwaPhrase: frases genéricas Meta ainda contam como seed", () => {
  assertEquals(matchesMetaCtwaPhrase("Olá, posso ter mais informações sobre isso?"), true);
  assertEquals(matchesMetaCtwaPhrase("Meu nome é Maria"), false);
});
