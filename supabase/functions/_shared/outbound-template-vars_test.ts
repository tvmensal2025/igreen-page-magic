import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyOutboundTemplateVars } from "./outbound-template-vars.ts";

Deno.test("roteiro pós-venda: Olá nome + saudação BRT + corpo", () => {
  const raw =
    "Olá, {{nome}} Tudo bem?\n\n{{saudacao}}\n\nJá faz cerca de 30 dias desde a aprovação.";
  // 15:00 UTC = 12:00 BRT → ainda manhã (<12? 12 is not <12, so tarde)
  // Use 10:00 BRT = 13:00 UTC
  const morning = new Date("2026-07-27T13:00:00.000Z");
  const out = applyOutboundTemplateVars(raw, {
    customerName: "Maria Silva",
    nameSource: "manual",
    now: morning,
  });
  assertEquals(out.includes("Olá, Maria Tudo bem?"), true);
  assertEquals(out.includes("Muito bom dia"), true);
  assertEquals(out.includes("Já faz cerca de 30 dias"), true);
});

Deno.test("roteiro pós-venda: tarde BRT", () => {
  const raw = "Olá, {{nome}} Tudo bem?\n\n{{saudacao}}\n\nCorpo.";
  // 18:00 UTC = 15:00 BRT → tarde
  const afternoon = new Date("2026-07-27T18:00:00.000Z");
  const out = applyOutboundTemplateVars(raw, {
    customerName: "João",
    nameSource: "manual",
    now: afternoon,
  });
  assertEquals(out.includes("Muito boa tarde"), true);
});

Deno.test("sem nome confiável: limpa Olá, Tudo bem?", () => {
  const raw = "Olá, {{nome}} Tudo bem?\n\n{{saudacao}}\n\nCorpo.";
  const out = applyOutboundTemplateVars(raw, {
    customerName: "Ixi Kkk",
    nameSource: "whatsapp_profile",
    now: new Date("2026-07-27T13:00:00.000Z"),
  });
  assertEquals(out.startsWith("Olá. Tudo bem?"), true);
});
