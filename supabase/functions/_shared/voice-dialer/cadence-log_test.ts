import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { customerIdFromCadenceVoiceLog } from "./cadence-log.ts";

const CUSTOMER_ID = "35bfbf76-0ff7-4cb8-9e54-c19017855b20";

Deno.test("customerIdFromCadenceVoiceLog aceita vínculo criado pela cadência", () => {
  assertEquals(
    customerIdFromCadenceVoiceLog({ source: "cadence", customer_id: CUSTOMER_ID }),
    CUSTOMER_ID,
  );
});

Deno.test("customerIdFromCadenceVoiceLog rejeita callback e UUID inválido", () => {
  assertEquals(customerIdFromCadenceVoiceLog({ source: "velip", customer_id: CUSTOMER_ID }), null);
  assertEquals(customerIdFromCadenceVoiceLog({ source: "cadence", customer_id: "cust-1" }), null);
  assertEquals(customerIdFromCadenceVoiceLog(null), null);
});
