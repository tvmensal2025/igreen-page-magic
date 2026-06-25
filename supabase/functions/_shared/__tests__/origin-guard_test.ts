import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isLeadEligible,
  isWalletCustomer,
  LEAD_ORIGIN_FILTER,
} from "../origin-guard.ts";

Deno.test("isLeadEligible: leads e manual são elegíveis", () => {
  assert(isLeadEligible("whatsapp_lead"));
  assert(isLeadEligible("manual"));
});

Deno.test("isLeadEligible: null/undefined tratado como lead (registros antigos)", () => {
  assert(isLeadEligible(null));
  assert(isLeadEligible(undefined));
  assert(isLeadEligible(""));
});

Deno.test("isLeadEligible: carteira nunca é elegível", () => {
  assertEquals(isLeadEligible("igreen_sync"), false);
  assertEquals(isLeadEligible("igreen_extension"), false);
});

Deno.test("isWalletCustomer: identifica carteira corretamente", () => {
  assert(isWalletCustomer("igreen_sync"));
  assert(isWalletCustomer("igreen_extension"));
  assertEquals(isWalletCustomer("whatsapp_lead"), false);
  assertEquals(isWalletCustomer(null), false);
});

Deno.test("LEAD_ORIGIN_FILTER: string pronta para PostgREST .or()", () => {
  assertEquals(
    LEAD_ORIGIN_FILTER,
    "customer_origin.in.(whatsapp_lead,manual),customer_origin.is.null",
  );
});
