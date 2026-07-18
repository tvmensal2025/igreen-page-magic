/**
 * Testes puros do filtro de público por DDD (piloto).
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideAudienceDdd, extractDdd } from "./audience-ddd.ts";

Deno.test("extractDdd — formatos BR comuns", () => {
  assertEquals(extractDdd("5534999887766"), "34");
  assertEquals(extractDdd("34999887766"), "34");
  assertEquals(extractDdd("55 34 99988-7766"), "34");
  assertEquals(extractDdd("11987654321"), "11");
  assertEquals(extractDdd(""), "??");
});

Deno.test("decideAudienceDdd — enforced DDD 34", () => {
  const ok = decideAudienceDdd("5534999887766", { mode: "enforced", allowedDdds: ["34"] });
  assertEquals(ok.allowed, true);
  assertEquals(ok.reason, "ok");

  const out = decideAudienceDdd("5511987654321", { mode: "enforced", allowedDdds: ["34"] });
  assertEquals(out.allowed, false);
  assertEquals(out.reason, "outside_ddd");
  assertEquals(out.ddd, "11");

  const bad = decideAudienceDdd("123", { mode: "enforced", allowedDdds: ["34"] });
  assertEquals(bad.allowed, false);
  assertEquals(bad.reason, "invalid_phone");
});

Deno.test("decideAudienceDdd — shadow observa mas não bloqueia", () => {
  const r = decideAudienceDdd("5511987654321", { mode: "shadow", allowedDdds: ["34"] });
  assertEquals(r.allowed, true);
  assertEquals(r.reason, "shadow_observe");
});

Deno.test("decideAudienceDdd — off libera tudo", () => {
  const r = decideAudienceDdd("5511987654321", { mode: "off", allowedDdds: ["34"] });
  assertEquals(r.allowed, true);
  assertEquals(r.reason, "mode_off");
});
