import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AdsActionKind,
  type AdsPolicyInput,
  anyExpansiveAdsMutationAllowed,
  decideAdsAction,
  isAdsActionAllowed,
  isProtectiveAdsAction,
} from "./ad-automation-policy.ts";

/** Estado alvo pós-hardening: inerte no máximo. */
const INERT: AdsPolicyInput = {
  autopilot: false,
  automation_mode: "disabled",
  kill_switch: true,
};

const PROTECTIVE: AdsActionKind[] = [
  "pause_waste",
  "pause_balance",
  "pause_schedule",
];
const EXPANSIVE: AdsActionKind[] = [
  "activate",
  "budget_scale",
  "creative_rotate",
];
const HUMAN_ONLY: AdsActionKind[] = [
  "targeting_patch",
  "create_object",
  "audience_sync",
];

Deno.test("proteção roda mesmo com kill switch e modo disabled", () => {
  for (const action of PROTECTIVE) {
    const decision = decideAdsAction(INERT, action);
    assertEquals(
      decision.allowed,
      true,
      `${action} precisa rodar: pausar gasto nunca pode ser desligado pelo modo`,
    );
    assertEquals(decision.reason, `protective_always_on:${action}`);
    assertEquals(isProtectiveAdsAction(action), true);
  }
});

Deno.test("expansão é fail-closed no estado inerte", () => {
  for (const action of EXPANSIVE) {
    assertFalse(isAdsActionAllowed(INERT, action));
  }
  assertFalse(anyExpansiveAdsMutationAllowed(INERT));
});

Deno.test("human-only nunca é automático, mesmo em full sem kill switch", () => {
  const permissive: AdsPolicyInput = {
    autopilot: true,
    automation_mode: "full",
    kill_switch: false,
  };
  for (const action of HUMAN_ONLY) {
    const decision = decideAdsAction(permissive, action);
    assertFalse(decision.allowed);
    assertEquals(decision.reason, `human_only:${action}`);
    assertFalse(isProtectiveAdsAction(action));
  }
});

Deno.test("shadow observa, não muta — mas não desliga a proteção", () => {
  const shadow: AdsPolicyInput = {
    autopilot: true,
    automation_mode: "shadow",
    kill_switch: false,
  };
  assertFalse(isAdsActionAllowed(shadow, "budget_scale"));
  assertEquals(isAdsActionAllowed(shadow, "pause_balance"), true);
});

Deno.test("limited libera defesa e custo; rotação de criativo só em full", () => {
  const limited: AdsPolicyInput = {
    autopilot: true,
    automation_mode: "limited",
    kill_switch: false,
  };
  assertEquals(isAdsActionAllowed(limited, "activate"), true);
  assertEquals(isAdsActionAllowed(limited, "budget_scale"), true);
  assertFalse(isAdsActionAllowed(limited, "creative_rotate"));

  const full: AdsPolicyInput = { ...limited, automation_mode: "full" };
  assertEquals(isAdsActionAllowed(full, "creative_rotate"), true);
});

Deno.test("autopilot legado sozinho não libera expansão", () => {
  const legacy: AdsPolicyInput = {
    autopilot: true,
    automation_mode: "disabled",
    kill_switch: false,
  };
  assertFalse(anyExpansiveAdsMutationAllowed(legacy));
  assertFalse(isAdsActionAllowed(legacy, "budget_scale"));
  // E a proteção segue de pé.
  assertEquals(isAdsActionAllowed(legacy, "pause_waste"), true);
});
