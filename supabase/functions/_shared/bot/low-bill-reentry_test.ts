import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { evaluateLowBillReentry, parseBillValueFromText } from "./low-bill-reentry.ts";

const paused = { bot_paused_reason: "low_bill_value" };

Deno.test("parseBillValueFromText: formatos BR", () => {
  assertEquals(parseBillValueFromText("R$ 1.250,90"), 1250.9);
  assertEquals(parseBillValueFromText("agora pago 600 por mes"), 600);
  assertEquals(parseBillValueFromText("sem numero"), null);
});

Deno.test("valor novo acima do mínimo reativa", () => {
  const r = evaluateLowBillReentry(paused, "minha conta agora é 620");
  assertEquals(r.reactivate, true);
  assertEquals(r.billValue, 620);
});

Deno.test("valor novo abaixo do mínimo NÃO reativa", () => {
  assertEquals(evaluateLowBillReentry(paused, "continua 80 reais").reactivate, false);
});

Deno.test("intenção de cadastro reativa sem valor", () => {
  const r = evaluateLowBillReentry(paused, "quero cadastrar agora");
  assertEquals(r.reactivate, true);
  assertEquals(r.reason, "cadastro_intent");
});

Deno.test("handoff humano e DNC nunca reativam", () => {
  assertEquals(
    evaluateLowBillReentry({ ...paused, assigned_human_id: "u1" }, "conta 700").reactivate,
    false,
  );
  assertEquals(
    evaluateLowBillReentry({ ...paused, do_not_contact: true }, "conta 700").reactivate,
    false,
  );
});

Deno.test("outra pausa (humano assumiu) não é afetada", () => {
  assertEquals(
    evaluateLowBillReentry({ bot_paused_reason: "humano_assumiu" }, "conta 700").reactivate,
    false,
  );
});
