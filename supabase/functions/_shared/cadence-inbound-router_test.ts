import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BILL_BUTTON_VALUES,
  isCadenceReturnContext,
  resolveCadenceInboundRoute,
} from "./cadence-inbound-router.ts";

const baseCustomer = {
  id: "cust-1",
  name: "Maria Silva",
  origin_recovery: "cadence",
};

Deno.test("resolveCadenceInboundRoute: bill_mid → passo 3 (fluxo conversacional)", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    buttonId: "bill_mid",
    isButton: true,
  });
  assertEquals(r?.handled, true);
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.reply, undefined);
  assertEquals(r?.updates.flow_variant, "A");
  assertEquals(r?.updates.conversation_step, null);
  assertEquals(r?.updates.electricity_bill_value, BILL_BUTTON_VALUES.bill_mid);
  assertEquals(r?.updates.name_source, "cadence");
});

Deno.test("resolveCadenceInboundRoute: bill_low → passo 3 com valor 200", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    buttonId: "bill_low",
    isButton: true,
  });
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.updates.electricity_bill_value, BILL_BUTTON_VALUES.bill_low);
  assertEquals(r?.updates.conversation_step, null);
});

Deno.test("resolveCadenceInboundRoute: texto 450 → passo 3 (fluxo conversacional)", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    messageText: "450",
  });
  assertEquals(r?.reason, "cadence_typed_bill");
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.updates.electricity_bill_value, 450);
  assertEquals(r?.updates.conversation_step, null);
});

Deno.test("resolveCadenceInboundRoute: valor baixo → valor_baixo", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    messageText: "80",
  });
  assertEquals(r?.reason, "cadence_low_bill");
  assertEquals(r?.updates.conversation_step, "valor_baixo");
});

Deno.test("resolveCadenceInboundRoute: stop → opt-out", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    buttonId: "stop",
    isButton: true,
  });
  assertEquals(r?.updates.do_not_contact, true);
});

Deno.test("resolveCadenceInboundRoute: foto → continueBotFlow OCR", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    isFile: true,
    hasImage: true,
  });
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.updates.conversation_step, "aguardando_conta");
});

Deno.test("resolveCadenceInboundRoute: analyze → fluxo conversacional", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    buttonId: "analyze",
    isButton: true,
  });
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.updates.conversation_step, null);
});

Deno.test("resolveCadenceInboundRoute: oi ambíguo → nudge com botões", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    messageText: "oi",
  });
  assertEquals(r?.handled, true);
  assertEquals((r?.buttons?.length ?? 0) > 0, true);
  assertEquals(r?.reason, "cadence_default_nudge");
});

Deno.test("resolveCadenceInboundRoute: fora de contexto cadência → null", () => {
  const r = resolveCadenceInboundRoute({
    customer: { name: "João" },
    messageText: "oi",
  });
  assertEquals(r, null);
});

Deno.test("isCadenceReturnContext: paused_reason lead_responded B/C", () => {
  assertEquals(
    isCadenceReturnContext({
      customer: {},
      cadencePausedReason: "lead_responded:RECALL_60D",
    }),
    true,
  );
  assertEquals(
    isCadenceReturnContext({
      customer: {},
      cadencePausedReason: "lead_responded:COLD_1",
    }),
    true,
  );
});

Deno.test("isCadenceReturnContext: GREETED/NEW/AI_QUALIFYING NÃO é retorno B/C", () => {
  assertEquals(
    isCadenceReturnContext({
      customer: { origin_recovery: "cadence" },
      cadencePausedReason: "lead_responded:GREETED",
    }),
    false,
  );
  assertEquals(
    isCadenceReturnContext({
      customer: { origin_recovery: "cadence" },
      cadencePausedReason: "lead_responded:NEW",
    }),
    false,
  );
  assertEquals(
    isCadenceReturnContext({
      customer: { origin_recovery: "cadence" },
      cadencePausedReason: "lead_responded:AI_QUALIFYING",
    }),
    false,
  );
});

Deno.test("resolveCadenceInboundRoute: oi com origin_recovery mas GREETED → null (Grupo A)", () => {
  const r = resolveCadenceInboundRoute({
    customer: { name: "Marilsa", origin_recovery: "cadence" },
    messageText: "oi",
    cadencePausedReason: "lead_responded:GREETED",
    cadenceStage: "PAUSED",
  });
  assertEquals(r, null);
});

Deno.test("resolveCadenceInboundRoute: economy → educativo + faixas", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    buttonId: "economy",
    isButton: true,
  });
  assertEquals(r?.reason, "cadence_educational_economy");
  assertEquals(r?.buttons?.[0]?.id, "bill_low");
});
