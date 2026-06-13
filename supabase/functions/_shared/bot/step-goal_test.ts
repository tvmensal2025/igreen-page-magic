import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractQuestionTail,
  goalFromStepRow,
  goalFromStepType,
  legacyStepTail,
  normalizeStepKey,
} from "./step-goal.ts";

Deno.test("normalizeStepKey: remove prefixo flow:", () => {
  assertEquals(normalizeStepKey("flow:d_welcome"), "d_welcome");
  assertEquals(normalizeStepKey("ask_phone_confirm"), "ask_phone_confirm");
});

Deno.test("legacyStepTail: passos legados", () => {
  const t = legacyStepTail("ask_phone_confirm", { name: "CLAUDIA SILVA" });
  assertEquals(t.includes("telefone"), true);
  assertEquals(t.startsWith("CLAUDIA,"), true);
});

Deno.test("goalFromStepType: capture e confirm", () => {
  assertEquals(goalFromStepType("capture_conta", { name: "João" }).includes("conta de luz"), true);
  assertEquals(goalFromStepType("confirm_phone", { name: "Ana" }).includes("telefone"), true);
});

Deno.test("goalFromStepRow: message_text do Flow Builder", () => {
  const row = {
    step_type: "message",
    message_text: "Oi {nome}! Quer saber como funciona o desconto?",
    captures: [],
  };
  const g = goalFromStepRow(row, { name: "Maria Santos" });
  assertEquals(g.includes("desconto"), true);
  assertEquals(g.includes("?"), true);
});

Deno.test("goalFromStepRow: botões em captures", () => {
  const row = {
    step_type: "message",
    message_text: "",
    captures: [{
      field: "_buttons",
      value: [{ id: "a", title: "Quero cadastrar" }, { id: "b", title: "Tenho dúvidas" }],
    }],
  };
  const g = goalFromStepRow(row, {});
  assertEquals(g.includes("1. Quero cadastrar"), true);
  assertEquals(g.includes("2. Tenho dúvidas"), true);
});

Deno.test("extractQuestionTail: última pergunta", () => {
  assertEquals(
    extractQuestionTail("Texto longo.\n\nMe confirma seu telefone?"),
    "Me confirma seu telefone?",
  );
});
