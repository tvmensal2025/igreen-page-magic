import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickPreferredInboundCustomer } from "./inbound-customer-resolve.ts";

Deno.test("pickPreferredInboundCustomer: carteira vence lead no mesmo número", () => {
  const picked = pickPreferredInboundCustomer([
    {
      id: "lead",
      customer_origin: "whatsapp_lead",
      status: "pending",
      created_at: "2026-07-28T10:00:00Z",
    },
    {
      id: "wallet",
      customer_origin: "igreen_sync",
      status: "approved",
      created_at: "2026-01-01T10:00:00Z",
    },
  ]);
  assertEquals(picked?.id, "wallet");
});

Deno.test("pickPreferredInboundCustomer: vazio → null", () => {
  assertEquals(pickPreferredInboundCustomer([]), null);
});
