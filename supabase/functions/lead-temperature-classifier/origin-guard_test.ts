import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isLeadClassifiable } from "./origin-guard.ts";

// Regra de negócio: clientes sincronizados do portal iGreen (igreen_sync) são
// carteira validada/reprovada/devolutiva e NÃO entram em temperatura de lead.
// Leads do WhatsApp (whatsapp_lead / manual / null) entram normalmente.

Deno.test("isLeadClassifiable: igreen_sync é barrado", () => {
  assertEquals(isLeadClassifiable("igreen_sync"), false);
});

Deno.test("isLeadClassifiable: whatsapp_lead é classificável", () => {
  assertEquals(isLeadClassifiable("whatsapp_lead"), true);
});

Deno.test("isLeadClassifiable: manual é classificável", () => {
  assertEquals(isLeadClassifiable("manual"), true);
});

Deno.test("isLeadClassifiable: null/undefined tratado como lead (default whatsapp_lead)", () => {
  assertEquals(isLeadClassifiable(null), true);
  assertEquals(isLeadClassifiable(undefined), true);
});
