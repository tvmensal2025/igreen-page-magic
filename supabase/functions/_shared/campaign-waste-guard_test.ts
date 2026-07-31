import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateAdWaste,
  evaluateCampaignWaste,
  isTooNewForWaste,
  WASTE_ZERO_CLICK_SPEND_CENTS,
  WASTE_ZERO_CONV_SPEND_CENTS,
} from "./campaign-waste-guard.ts";
import { isConsultantLocked } from "./campaign-pause.ts";

Deno.test("pausa campanha com gasto sem conversa", () => {
  const v = evaluateCampaignWaste({
    spendCents: WASTE_ZERO_CONV_SPEND_CENTS,
    conversations: 0,
    clicks: 5,
  });
  assertEquals(v.action, "pause_campaign");
});

Deno.test("âncora não pausa em R$10 zero-conv", () => {
  const v = evaluateCampaignWaste({
    spendCents: WASTE_ZERO_CONV_SPEND_CENTS,
    conversations: 0,
    clicks: 5,
    isAnchor: true,
  });
  assertEquals(v.action, "none");
});

Deno.test("âncora pausa em R$40 zero-conv", () => {
  const v = evaluateCampaignWaste({
    spendCents: 4000,
    conversations: 0,
    clicks: 5,
    isAnchor: true,
  });
  assertEquals(v.action, "pause_campaign");
});

Deno.test("pausa campanha com gasto sem clique", () => {
  const v = evaluateCampaignWaste({
    spendCents: WASTE_ZERO_CLICK_SPEND_CENTS,
    conversations: 0,
    clicks: 0,
  });
  assertEquals(v.action, "pause_campaign");
  if (v.action === "pause_campaign") assertEquals(v.rule, "zero_click");
});

Deno.test("não pausa com conversa", () => {
  const v = evaluateCampaignWaste({
    spendCents: 50000,
    conversations: 2,
    clicks: 10,
  });
  assertEquals(v.action, "none");
});

Deno.test("ad zumbi", () => {
  const v = evaluateAdWaste({ fbAdId: "x", spendCents: 1200, conversations: 0 });
  assertEquals(v.action, "pause_ad");
});

Deno.test("AUTO_PERF_PAUSE trava reativação", () => {
  assertEquals(
    isConsultantLocked("AUTO_PERF_PAUSE: Waste guard: R$ 10.00 sem conversa — só reativa no Play"),
    true,
  );
});

Deno.test("isTooNewForWaste respeita idade mínima e force", () => {
  const now = Date.now();
  assertEquals(
    isTooNewForWaste(new Date(now - 30 * 60 * 1000).toISOString(), { nowMs: now }),
    true,
  );
  assertEquals(
    isTooNewForWaste(new Date(now - 3 * 60 * 60 * 1000).toISOString(), { nowMs: now }),
    false,
  );
  assertEquals(
    isTooNewForWaste(new Date(now - 30 * 60 * 1000).toISOString(), { force: true, nowMs: now }),
    false,
  );
});
