import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CANONICAL_FLOW_VARIANT,
  needsCanonicalFlowVariantRepair,
  resolveCanonicalFlowVariant,
} from "./canonical-flow-variant.ts";

Deno.test("resolveCanonicalFlowVariant sempre A", () => {
  assertEquals(resolveCanonicalFlowVariant(null), "A");
  assertEquals(resolveCanonicalFlowVariant(undefined), "A");
  assertEquals(resolveCanonicalFlowVariant("A"), "A");
  assertEquals(resolveCanonicalFlowVariant("F"), "A");
  assertEquals(resolveCanonicalFlowVariant("D"), "A");
  assertEquals(resolveCanonicalFlowVariant("M"), "A");
  assertEquals(resolveCanonicalFlowVariant("a"), "A");
  assertEquals(CANONICAL_FLOW_VARIANT, "A");
});

Deno.test("needsCanonicalFlowVariantRepair", () => {
  assertEquals(needsCanonicalFlowVariantRepair("A"), false);
  assertEquals(needsCanonicalFlowVariantRepair("a"), false);
  assertEquals(needsCanonicalFlowVariantRepair("F"), true);
  assertEquals(needsCanonicalFlowVariantRepair(null), true);
  assertEquals(needsCanonicalFlowVariantRepair(""), true);
});
