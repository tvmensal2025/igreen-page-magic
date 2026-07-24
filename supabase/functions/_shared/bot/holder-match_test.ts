import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkHolderMatch, nameLevSim, normalizeHolderName } from "./holder-match.ts";

Deno.test("normalizeHolderName remove acento", () => {
  assertEquals(normalizeHolderName("José Ávila"), "jose avila");
});

Deno.test("nameLevSim idêntico", () => {
  assertEquals(nameLevSim("Maria Silva", "Maria Silva"), 1);
});

Deno.test("checkHolderMatch missing side = match", () => {
  assertEquals(checkHolderMatch("Maria", null).match, true);
  assertEquals(checkHolderMatch(null, "Maria").reason, "missing_one_side");
});

Deno.test("checkHolderMatch first+last", () => {
  const r = checkHolderMatch("Maria da Silva Santos", "Maria Santos");
  assertEquals(r.match, true);
});

Deno.test("checkHolderMatch diferente", () => {
  const r = checkHolderMatch("Joao Pereira", "Carlos Souza");
  assertEquals(r.match, false);
});
