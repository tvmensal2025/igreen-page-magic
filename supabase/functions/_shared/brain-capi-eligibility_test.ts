import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCapiPreviewPayload,
  evaluateCapiEligibility,
} from "./brain-capi-eligibility.ts";

const base = {
  id: "cust-1",
  source_campaign_id: "camp-1",
  source_ad_id: "ad-1",
  phone: "5531999990000",
  email: "lead@exemplo.com",
};

Deno.test("atribuição fraca nunca vira evento", () => {
  const v = evaluateCapiEligibility({
    customer: { ...base, source_ad_id: null, ctwa_clid: null },
    milestone: "cliente_aprovado",
    consultantId: "c1",
    objective: "conversions",
    hasConsentBasis: true,
  });
  assertEquals(v.eligible, false);
  assertEquals(v.use, "blocked");
  assertEquals(v.eventName, null);
});

Deno.test("sem base de consentimento bloqueia e pede revisão", () => {
  const v = evaluateCapiEligibility({
    customer: base,
    milestone: "lead_identificado",
    consultantId: "c1",
    objective: "leads",
    hasConsentBasis: false,
  });
  assertEquals(v.eligible, false);
  assertEquals(v.requiresReview, true);
});

Deno.test("sem telefone nem e-mail não há correspondência", () => {
  const v = evaluateCapiEligibility({
    customer: { ...base, phone: null, email: null },
    milestone: "lead_identificado",
    consultantId: "c1",
    objective: "leads",
    hasConsentBasis: true,
  });
  assertEquals(v.eligible, false);
  assert(v.reasons.some((r) => r.includes("correspondência")));
});

Deno.test("Click-to-WhatsApp: cliente aprovado é medição, nunca otimização", () => {
  const v = evaluateCapiEligibility({
    customer: base,
    milestone: "cliente_aprovado",
    consultantId: "c1",
    objective: "messages_ctwa",
    hasConsentBasis: true,
    dispatchEnabled: true,
  });
  assertEquals(v.use, "measurement");
  assertEquals(v.eventName, "CompleteRegistration");
});

Deno.test("objetivo de conversão aceita marco tardio como sinal", () => {
  const v = evaluateCapiEligibility({
    customer: base,
    milestone: "cliente_aprovado",
    consultantId: "c1",
    objective: "conversions",
    hasConsentBasis: true,
    dispatchEnabled: true,
  });
  assertEquals(v.use, "optimization");
  assertEquals(v.eligible, true);
});

Deno.test("envio desligado: prepara payload mas não libera envio", () => {
  const v = evaluateCapiEligibility({
    customer: base,
    milestone: "lead_identificado",
    consultantId: "c1",
    objective: "leads",
    hasConsentBasis: true,
  });
  assertEquals(v.eligible, false);
  assertEquals(v.requiresReview, true);
  assert(v.eventKey);
});

Deno.test("event_id é estável — retry do mesmo fato não infla conversão", () => {
  const a = evaluateCapiEligibility({
    customer: base,
    milestone: "cliente_aprovado",
    consultantId: "c1",
    objective: "conversions",
    hasConsentBasis: true,
  });
  const b = evaluateCapiEligibility({
    customer: base,
    milestone: "cliente_aprovado",
    consultantId: "c1",
    objective: "conversions",
    hasConsentBasis: true,
  });
  assertEquals(a.eventKey, b.eventKey);
  assertEquals(a.eventKey, "CompleteRegistration:cust-1");
});

Deno.test("payload de teste usa o mesmo formato do despachante real", () => {
  const v = evaluateCapiEligibility({
    customer: base,
    milestone: "cliente_ativo",
    consultantId: "c1",
    objective: "conversions",
    hasConsentBasis: true,
    dispatchEnabled: true,
  });
  const payload = buildCapiPreviewPayload({
    verdict: v,
    hashedUserData: { ph: ["hash"] },
    valueCents: 12000,
    eventTimeSeconds: 1780000000,
  });
  assert(payload);
  assertEquals(payload!.event_name, "Purchase");
  assertEquals(payload!.event_id, "Purchase:cust-1");
  assertEquals(
    (payload!.custom_data as Record<string, unknown>).value,
    120,
  );
});
