/**
 * Deno test: 9º dígito no destino SMS Velip.
 * Rodar: deno test supabase/functions/_shared/voice-dialer/velip_sms_dest_test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ensureBrazilMobileNine,
  isPermanentSmsFailure,
  toVelipBRDest,
  toVelipSmsDest,
} from "./velip.ts";

Deno.test("ensureBrazilMobileNine insere 9 em celular antigo", () => {
  assertEquals(ensureBrazilMobileNine("553497081920"), "5534997081920");
  assertEquals(ensureBrazilMobileNine("5511989000650"), "5511989000650"); // já tem 9
  assertEquals(ensureBrazilMobileNine("553434123456"), "553434123456"); // fixo 2–5
});

Deno.test("toVelipSmsDest / toVelipBRDest normalizam e completam 9", () => {
  assertEquals(toVelipSmsDest("34 9708-1920"), "5534997081920");
  assertEquals(toVelipSmsDest("34997081920"), "5534997081920");
  assertEquals(toVelipSmsDest("+55 (34) 99708-1920"), "5534997081920");
  // Voz usa toVelipBRDest — mesmo destino celular.
  assertEquals(toVelipBRDest("553497081920"), "5534997081920");
  assertEquals(toVelipBRDest("5534997081920"), "5534997081920");
});

Deno.test("isPermanentSmsFailure detecta Velip #240, #203 e #270 (blocked text)", () => {
  assertEquals(isPermanentSmsFailure("velip:Mobile is not valid#240"), true);
  assertEquals(isPermanentSmsFailure("velip:number invalid#203"), true);
  assertEquals(isPermanentSmsFailure("velip:Blocked text#270"), true);
  assertEquals(isPermanentSmsFailure("velip:blocked text"), true);
  assertEquals(isPermanentSmsFailure("sms_skip_landline"), true);
  assertEquals(isPermanentSmsFailure("velip:timeout"), false);
});
