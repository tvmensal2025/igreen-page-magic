import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  capConfidenceForSupport,
  classifyCampaignSupport,
  type SupportInput,
} from "./brain-campaign-support.ts";

function input(over: Partial<SupportInput> = {}): SupportInput {
  return {
    fbCampaignId: "120200123",
    rejectionReason: null,
    leadsHigh: 0,
    leadsMedium: 0,
    leadsLow: 0,
    duplicatesIgnored: 0,
    hasMetaDelivery: true,
    ...over,
  };
}

Deno.test("anúncio confirmado e sem duplicidade é atribuição completa", () => {
  const v = classifyCampaignSupport(input({ leadsHigh: 7 }));
  assertEquals(v.support, "commercial_attribution_full");
  assertEquals(v.confidenceCeiling, "high");
  assertEquals(v.allowsCommercialWin, true);
  assertEquals(v.allowsExpansive, true);
  assert(v.signals.includes("source_ad_id"));
});

Deno.test("clique CTWA sem anúncio confirmado é atribuição parcial", () => {
  const v = classifyCampaignSupport(input({ leadsMedium: 5 }));
  assertEquals(v.support, "commercial_attribution_partial");
  assertEquals(v.confidenceCeiling, "moderate");
  assertEquals(v.allowsExpansive, true);
  assert(v.signals.includes("ctwa_clid"));
});

Deno.test("duplicidade rebaixa atribuição completa para parcial", () => {
  const v = classifyCampaignSupport(input({ leadsHigh: 7, duplicatesIgnored: 2 }));
  assertEquals(v.support, "commercial_attribution_partial");
  assert(v.reason.includes("duplicado"));
});

Deno.test("lead sem sinal forte ainda é parcial, nunca completo", () => {
  const v = classifyCampaignSupport(input({ leadsLow: 9 }));
  assertEquals(v.support, "commercial_attribution_partial");
  assertEquals(v.confidenceCeiling, "moderate");
});

Deno.test("entrega sem lead no CRM é somente Meta", () => {
  const v = classifyCampaignSupport(input({ hasMetaDelivery: true }));
  assertEquals(v.support, "meta_only");
  assertEquals(v.allowsCommercialWin, false, "meta_only nunca é vencedora comercial");
  assertEquals(v.allowsExpansive, false);
  // `low` é o piso da escala e vale degrau 0%.
  assertEquals(v.confidenceCeiling, "low");
});

Deno.test("campanha sem espelho na Meta não é suportada", () => {
  const v = classifyCampaignSupport(input({ fbCampaignId: null, leadsHigh: 20 }));
  assertEquals(v.support, "unsupported");
  assertEquals(v.allowsExpansive, false);
  assertEquals(v.allowsCommercialWin, false);
});

Deno.test("campanha recusada pela Meta não é suportada", () => {
  const v = classifyCampaignSupport(
    input({ rejectionReason: "AD_POLICY_VIOLATION", leadsHigh: 4 }),
  );
  assertEquals(v.support, "unsupported");
  assert(v.reason.includes("AD_POLICY_VIOLATION"));
});

Deno.test("teto de confiança só reduz, nunca promove", () => {
  assertEquals(capConfidenceForSupport("high", "commercial_attribution_full"), "high");
  assertEquals(
    capConfidenceForSupport("high", "commercial_attribution_partial"),
    "moderate",
    "atribuição parcial reduz a confiança",
  );
  assertEquals(capConfidenceForSupport("high", "meta_only"), "low");
  assertEquals(capConfidenceForSupport("high", "unsupported"), "low");
  // Amostra fraca não sobe só porque a atribuição é boa.
  assertEquals(capConfidenceForSupport("low", "commercial_attribution_full"), "low");
  assertEquals(
    capConfidenceForSupport("moderate", "commercial_attribution_full"),
    "moderate",
  );
});
