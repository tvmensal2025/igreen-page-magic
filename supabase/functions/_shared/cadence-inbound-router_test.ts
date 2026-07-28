import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isCadenceReturnContext,
  resolveCadenceInboundRoute,
} from "./cadence-inbound-router.ts";

const baseCustomer = {
  id: "cust-1",
  name: "Maria Silva",
  origin_recovery: "cadence",
};

Deno.test("resolveCadenceInboundRoute: bill_mid → Grupo A a2 (re-pede valor)", () => {
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
  // Tempo passou: faixa NÃO grava valor — a2 pede de novo
  assertEquals(r?.updates.electricity_bill_value, null);
  assertEquals(r?.updates.name_source, "cadence"); // nome ok, não re-pede a1
});

Deno.test("resolveCadenceInboundRoute: bill_low → a2 sem gravar faixa 200", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    buttonId: "bill_low",
    isButton: true,
  });
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.updates.electricity_bill_value, null);
  assertEquals(r?.updates.conversation_step, null);
  assertEquals(r?.updates.name_source, "cadence");
});

Deno.test("resolveCadenceInboundRoute: texto 450 → a2 (valor limpo p/ re-pedir)", () => {
  const r = resolveCadenceInboundRoute({
    customer: baseCustomer,
    messageText: "450",
  });
  assertEquals(r?.reason, "cadence_typed_bill");
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.updates.electricity_bill_value, null);
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

Deno.test("isCadenceReturnContext: ponte Meta continua sendo retorno da cadência", () => {
  for (const stage of ["CLOSE_LOST", "RETARGET_META", "RETARGET_ADS_15D"]) {
    assertEquals(
      isCadenceReturnContext({
        customer: {},
        cadenceStage: stage,
      }),
      true,
    );
  }
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

Deno.test("isCadenceReturnContext: aguardando_avaliacao NÃO bloqueia retorno B/C", () => {
  assertEquals(
    isCadenceReturnContext({
      customer: { conversation_step: "aguardando_avaliacao_atendimento" },
      cadencePausedReason: "lead_responded:COLD_1",
    }),
    true,
  );
  assertEquals(
    isCadenceReturnContext({
      customer: { conversation_step: "atendimento_finalizado" },
      cadenceStage: "COLD_1",
    }),
    true,
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

Deno.test("digitar 'Conhecer mais' com valor salvo → a2 (re-pede valor)", () => {
  const r = resolveCadenceInboundRoute({
    customer: { ...baseCustomer, electricity_bill_value: 900 },
    messageText: "Conhecer mais",
  });
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.updates.electricity_bill_value, null);
  assertEquals(String(r?.reason || "").includes("educational_to_cadastro") || r?.reason === "cadence_cadastro_more_benefits" || String(r?.reason || "").includes("more_benefits"), true);
});

Deno.test("digitar 'Até R$300' limpa valor antigo e re-pede no a2", () => {
  const r = resolveCadenceInboundRoute({
    customer: { ...baseCustomer, electricity_bill_value: 900 },
    messageText: "Até R$300",
  });
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.updates.electricity_bill_value, null);
  assertEquals(r?.updates.name_source, "cadence");
});

Deno.test("Grupo C: 'pago 300 reais por mês' → a2 (não grava 300; re-pede)", () => {
  const r = resolveCadenceInboundRoute({
    customer: { name: "João", origin_recovery: "cadence" },
    messageText: "pago 300 reais por mês",
    cadencePausedReason: "lead_responded:RECALL_5M",
  });
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.updates.electricity_bill_value, null);
  assertEquals(r?.reason, "cadence_typed_bill");
});

Deno.test("meio do fluxo a3 (flow:uuid) → NÃO intercepta cadência", () => {
  const r = resolveCadenceInboundRoute({
    customer: {
      name: "Marilsa",
      origin_recovery: "cadence",
      conversation_step: "flow:975c4ab2-0b8c-4f10-89c3-09ed7eacc270",
      electricity_bill_value: 900,
    },
    messageText: "Conhecer mais",
    cadencePausedReason: "lead_responded:COLD_1",
  });
  assertEquals(r, null);
});

Deno.test("valor já salvo + texto ambíguo → a2 (re-pede valor)", () => {
  const r = resolveCadenceInboundRoute({
    customer: { ...baseCustomer, electricity_bill_value: 450 },
    messageText: "ok",
  });
  assertEquals(r?.continueBotFlow, true);
  assertEquals(r?.reason, "cadence_known_bill_forward");
  assertEquals(r?.updates.electricity_bill_value, null);
});

Deno.test("nome digitado no a1 (flow) NUNCA vira handoff de cadência", () => {
  const r = resolveCadenceInboundRoute({
    customer: {
      name: "Luciano",
      origin_recovery: "cadence",
      conversation_step: "flow:98287e05-a9e9-4490-bbcd-b87faf2956c9",
    },
    messageText: "Luciano",
  });
  assertEquals(r, null);
});

Deno.test("buttonId human DENTRO do fluxo A → não intercepta (flow engine decide)", () => {
  const r = resolveCadenceInboundRoute({
    customer: {
      name: "Luciano",
      origin_recovery: "cadence",
      conversation_step: "flow:98287e05-a9e9-4490-bbcd-b87faf2956c9",
    },
    buttonId: "human",
    isButton: true,
  });
  assertEquals(r, null);
});

Deno.test("isCadenceReturnContext: dentro de ask_email/aguardando_conta → false", () => {
  assertEquals(
    isCadenceReturnContext({
      customer: { origin_recovery: "cadence", conversation_step: "aguardando_conta" },
      messageText: "segue a foto",
    }),
    false,
  );
  assertEquals(
    isCadenceReturnContext({
      customer: { origin_recovery: "cadence", conversation_step: "ask_email" },
      messageText: "luciano@gmail.com",
    }),
    false,
  );
});
