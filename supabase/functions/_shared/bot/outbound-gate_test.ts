import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getE2eOutboundAllowlist,
  isPhoneAllowedForE2eStrict,
} from "./outbound-gate.ts";

Deno.test("E2E allowlist defaults include the two live test phones", () => {
  const list = getE2eOutboundAllowlist();
  assertEquals(list.includes("5511989000650"), true);
  assertEquals(list.includes("5511973125846"), true);
});

Deno.test("isPhoneAllowedForE2eStrict accepts allowlist + sandbox range", () => {
  assertEquals(isPhoneAllowedForE2eStrict("5511989000650"), true);
  assertEquals(isPhoneAllowedForE2eStrict("11989000650"), true);
  assertEquals(isPhoneAllowedForE2eStrict("5511973125846"), true);
  assertEquals(isPhoneAllowedForE2eStrict("55000001234567"), true);
  assertEquals(isPhoneAllowedForE2eStrict("5511999999999"), false);
  assertEquals(isPhoneAllowedForE2eStrict(null), false);
});
