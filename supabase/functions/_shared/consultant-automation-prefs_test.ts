import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_CONSULTANT_AUTOMATION_PREFS,
  isConsultantAutoAllowed,
  stageGroupToPack,
} from "./consultant-automation-prefs.ts";

Deno.test("stageGroupToPack mapeia A/B/C", () => {
  assertEquals(stageGroupToPack("A"), "a");
  assertEquals(stageGroupToPack("B"), "b");
  assertEquals(stageGroupToPack("C"), "c");
});

Deno.test("isConsultantAutoAllowed fail-closed sem prefs", () => {
  assertEquals(isConsultantAutoAllowed(null, "a"), false);
  assertEquals(isConsultantAutoAllowed(undefined, "reminders"), false);
  assertEquals(isConsultantAutoAllowed(DEFAULT_CONSULTANT_AUTOMATION_PREFS, "b"), false);
});

Deno.test("isConsultantAutoAllowed respeita cada pack", () => {
  const prefs = {
    ...DEFAULT_CONSULTANT_AUTOMATION_PREFS,
    group_a_enabled: true,
    pos_venda_auto_enabled: true,
  };
  assertEquals(isConsultantAutoAllowed(prefs, "a"), true);
  assertEquals(isConsultantAutoAllowed(prefs, "b"), false);
  assertEquals(isConsultantAutoAllowed(prefs, "c"), false);
  assertEquals(isConsultantAutoAllowed(prefs, "pos_venda"), true);
  assertEquals(isConsultantAutoAllowed(prefs, "reminders"), false);
});
