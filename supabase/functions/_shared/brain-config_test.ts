import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_BRAIN_CONFIG,
  isAdsActionAllowedForConfig,
  isAdsExpansiveMutationAllowed,
  normalizeBrainConfig,
  resolveAdsAutomationMode,
} from "./brain-config.ts";

Deno.test("config padrão do Cérebro permanece inerte", () => {
  assertFalse(DEFAULT_BRAIN_CONFIG.autopilot);
  assertEquals(DEFAULT_BRAIN_CONFIG.automation_mode, "disabled");
  assertEquals(DEFAULT_BRAIN_CONFIG.kill_switch, true);

  const normalized = normalizeBrainConfig(null);
  assertFalse(normalized.autopilot);
  assertEquals(normalized.automation_mode, "disabled");
  assertEquals(normalized.kill_switch, true);
  assertFalse(isAdsExpansiveMutationAllowed(null));
});

Deno.test("config ausente não desliga as pausas de proteção", () => {
  // Regra de produto: cobrar/limitar gasto já ocorrido não depende do modo.
  assertEquals(isAdsActionAllowedForConfig(null, "pause_balance"), true);
  assertEquals(isAdsActionAllowedForConfig(null, "pause_schedule"), true);
  assertEquals(isAdsActionAllowedForConfig(null, "pause_waste"), true);
  // Já expansão e criação seguem bloqueadas.
  assertFalse(isAdsActionAllowedForConfig(null, "budget_scale"));
  assertFalse(isAdsActionAllowedForConfig(null, "create_object"));
});

Deno.test("autopilot legado sozinho nunca autoriza mutação", () => {
  const legacy = { autopilot: true };

  assertEquals(resolveAdsAutomationMode(legacy), "disabled");
  assertEquals(normalizeBrainConfig(legacy).kill_switch, true);
  assertFalse(isAdsExpansiveMutationAllowed(legacy));
});

Deno.test("shadow observa, mas não muta", () => {
  assertFalse(isAdsExpansiveMutationAllowed({
    autopilot: true,
    automation_mode: "shadow",
    kill_switch: false,
  }));
});

Deno.test("modo explícito ainda exige autopilot e kill switch desligado", () => {
  assertFalse(isAdsExpansiveMutationAllowed({
    autopilot: false,
    automation_mode: "limited",
    kill_switch: false,
  }));
  assertFalse(isAdsExpansiveMutationAllowed({
    autopilot: true,
    automation_mode: "full",
    kill_switch: true,
  }));
  assertEquals(
    isAdsExpansiveMutationAllowed({
      autopilot: true,
      automation_mode: "limited",
      kill_switch: false,
    }),
    true,
  );
});
