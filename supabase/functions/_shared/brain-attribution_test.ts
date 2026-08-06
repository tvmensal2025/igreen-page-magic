import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  aggregateAttribution,
  type AttributableCustomer,
  classifyAttribution,
  totalsForCampaign,
} from "./brain-attribution.ts";

const CAMP = "11111111-1111-1111-1111-111111111111";

function lead(over: Partial<AttributableCustomer>): AttributableCustomer {
  return { id: crypto.randomUUID(), source_campaign_id: CAMP, ...over };
}

Deno.test("atribuição forte: ad_id confirmado é alta confiança", () => {
  const v = classifyAttribution(lead({ source_ad_id: "23851234" }));
  assertEquals(v.confidence, "high");
  assertEquals(v.campaignId, CAMP);
  assertEquals(v.signals.includes("source_ad_id"), true);
});

Deno.test("atribuição: ctwa_clid sem ad_id é confiança média", () => {
  assertEquals(classifyAttribution(lead({ ctwa_clid: "abc" })).confidence, "medium");
  assertEquals(
    classifyAttribution(lead({ source_ctwa_clid: "abc" })).confidence,
    "medium",
  );
});

Deno.test("atribuição ambígua: campanha sem sinal Meta é confiança baixa", () => {
  const v = classifyAttribution(lead({ lead_source: "meta_ads" }));
  assertEquals(v.confidence, "low");
  assertEquals(v.reason, "campanha_sem_sinal_forte_meta");
});

Deno.test("atribuição: sem campanha é não atribuído", () => {
  assertEquals(
    classifyAttribution(lead({ source_campaign_id: null })).confidence,
    "unattributed",
  );
  assertEquals(classifyAttribution(null).confidence, "unattributed");
});

Deno.test("string vazia em source_campaign_id não vira campanha", () => {
  assertEquals(
    classifyAttribution(lead({ source_campaign_id: "   " })).confidence,
    "unattributed",
  );
});

Deno.test("cliente não é contado duas vezes", () => {
  const same = lead({ source_ad_id: "1", status: "approved" });
  const agg = aggregateAttribution([same, same, same]);
  const totals = totalsForCampaign(agg, CAMP);
  assertEquals(totals.leadsHigh, 1);
  assertEquals(totals.approvedTrusted, 1);
  assertEquals(agg.duplicatesIgnored, 2);
  assertEquals(agg.totalConsidered, 1);
});

Deno.test("aprovado com atribuição fraca não entra na base confiável", () => {
  const agg = aggregateAttribution([
    lead({ source_ad_id: "1", status: "approved" }),
    lead({ status: "approved" }),
  ]);
  const totals = totalsForCampaign(agg, CAMP);
  assertEquals(totals.approvedTrusted, 1);
  assertEquals(totals.approvedLowConfidence, 1);
  assertEquals(totals.leadsTrusted, 1);
  assertEquals(totals.leadsLow, 1);
});

Deno.test("leads sem campanha entram no balde de não atribuídos", () => {
  const agg = aggregateAttribution([
    lead({ source_campaign_id: null }),
    lead({ source_campaign_id: null }),
    lead({ ctwa_clid: "x" }),
  ]);
  assertEquals(agg.unattributed, 2);
  assertEquals(totalsForCampaign(agg, CAMP).leadsMedium, 1);
});

Deno.test("cadastro enviado conta por portal_submitted_at ou status", () => {
  const agg = aggregateAttribution([
    lead({ source_ad_id: "1", portal_submitted_at: "2026-08-01T10:00:00Z" }),
    lead({ ctwa_clid: "x", status: "cadastro_em_analise" }),
    lead({ source_ad_id: "2", status: "new" }),
  ]);
  assertEquals(totalsForCampaign(agg, CAMP).registrationsTrusted, 2);
});

Deno.test("campanha sem resultado devolve totais zerados", () => {
  const totals = totalsForCampaign(aggregateAttribution([]), "outra");
  assertEquals(totals.leadsTrusted, 0);
  assertEquals(totals.approvedTrusted, 0);
});
