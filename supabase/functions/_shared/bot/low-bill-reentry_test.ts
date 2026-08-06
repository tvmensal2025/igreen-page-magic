import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  evaluateLowBillCutoff,
  evaluateLowBillReentry,
  parseBillValueFromText,
} from "./low-bill-reentry.ts";

const paused = { bot_paused_reason: "low_bill_value" };

// Corte de entrada — E2E 2026-08 mostrou lead de R$ 60 indo até documento.
Deno.test("corte: abaixo do mínimo no passo do valor desqualifica", () => {
  const d = evaluateLowBillCutoff(true, 60);
  assertEquals(d.reject, true);
  if (!d.reject) return;
  assertEquals(d.updates.status, "rejected");
  assertEquals(d.updates.conversation_step, "valor_baixo");
  // Motivo precisa ser exatamente o que a reentrada reconhece.
  assertEquals(d.updates.bot_paused_reason, "low_bill_value");
  assertEquals(evaluateLowBillReentry({ bot_paused_reason: String(d.updates.bot_paused_reason) }, "agora minha conta é 600").reactivate, true);
});

Deno.test("corte: no mínimo ou acima segue o fluxo", () => {
  assertEquals(evaluateLowBillCutoff(true, 100).reject, false);
  assertEquals(evaluateLowBillCutoff(true, 350).reject, false);
});

Deno.test("corte: só vale no passo que pede o valor", () => {
  // "pago uns 50 de água" num passo qualquer não pode derrubar o lead.
  assertEquals(evaluateLowBillCutoff(false, 50).reject, false);
});

Deno.test("corte: sem valor capturado não decide nada", () => {
  assertEquals(evaluateLowBillCutoff(true, null).reject, false);
  assertEquals(evaluateLowBillCutoff(true, undefined).reject, false);
  assertEquals(evaluateLowBillCutoff(true, 0).reject, false);
});

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

Deno.test("parseBillValueFromText: ignora CEP, CPF, telefone e data", () => {
  assertEquals(parseBillValueFromText("meu cep é 38400-100"), null);
  assertEquals(parseBillValueFromText("cpf 12345678900"), null);
  assertEquals(parseBillValueFromText("meu numero 34999991920"), null);
  assertEquals(parseBillValueFromText("nasci em 10/05/1990"), null);
  assertEquals(parseBillValueFromText("agora veio R$ 780,50"), 780.5);
});

Deno.test("CEP não reativa lead de conta baixa", () => {
  assertEquals(evaluateLowBillReentry(paused, "meu cep é 38400-100").reactivate, false);
});
