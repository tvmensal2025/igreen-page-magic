import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveCampaignEffectiveStatus } from "./campaign-effective-status.ts";

Deno.test("active quando campanha+adset ACTIVE e pelo menos 1 ad ACTIVE", () => {
  const r = resolveCampaignEffectiveStatus(
    { effective_status: "ACTIVE" },
    [{ effective_status: "ACTIVE" }],
    [{ effective_status: "PAUSED" }, { effective_status: "ACTIVE" }],
  );
  assertEquals(r.localStatus, "active");
});

Deno.test("pending_review se nenhum ad ACTIVE", () => {
  const r = resolveCampaignEffectiveStatus(
    { effective_status: "ACTIVE" },
    [{ effective_status: "ACTIVE" }],
    [{ effective_status: "PAUSED" }, { effective_status: "PAUSED" }],
  );
  assertEquals(r.localStatus, "pending_review");
});

Deno.test("paused se campanha PAUSED", () => {
  const r = resolveCampaignEffectiveStatus(
    { effective_status: "PAUSED" },
    [{ effective_status: "ACTIVE" }],
    [{ effective_status: "ACTIVE" }],
  );
  assertEquals(r.localStatus, "paused");
});
