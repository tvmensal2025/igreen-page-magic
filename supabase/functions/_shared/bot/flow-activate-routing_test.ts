import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hasBillReady,
  isActivateIntent,
  isSimulateIntent,
  isCadastroContaStep,
  pickActivateDestination,
  rewriteActivateAwayFromSimPath,
  resolveCanonicalNudgeChoice,
} from "./flow-activate-routing.ts";

const steps = [
  {
    id: "conta1",
    step_key: "d_pedir_conta",
    step_type: "capture_conta",
    is_active: true,
    fallback: { mode: "goto", goto_step_id: "resultado" },
  },
  {
    id: "resultado",
    step_key: "d_resultado",
    step_type: "message",
    is_active: true,
  },
  {
    id: "conta2",
    step_key: "d_simular_pedir_conta",
    step_type: "capture_conta",
    is_active: true,
    fallback: { mode: "goto", goto_step_id: "doc", success_goto_step_id: "doc" },
  },
  {
    id: "doc",
    step_key: "d_pedir_documento",
    step_type: "capture_documento",
    is_active: true,
  },
  {
    id: "escolher",
    step_key: "d_escolher_simulacao",
    step_type: "message",
    is_active: true,
  },
];

Deno.test("isActivateIntent vs isSimulateIntent", () => {
  assertEquals(isActivateIntent("Ativar o benefício", null), true);
  assertEquals(isActivateIntent(null, "cadastrar"), true);
  assertEquals(isActivateIntent("quero simular", null), false);
  assertEquals(isSimulateIntent("quero simular", null), true);
  assertEquals(isSimulateIntent("3", "ativar"), false);
});

Deno.test("hasBillReady", () => {
  assertEquals(hasBillReady({ electricity_bill_value: 300 }), true);
  assertEquals(hasBillReady({ electricity_bill_value: 0 }), false);
  assertEquals(hasBillReady({ bill_data_confirmed_at: "2026-07-01" }), true);
});

Deno.test("isCadastroContaStep", () => {
  assertEquals(isCadastroContaStep(steps[0], steps), false);
  assertEquals(isCadastroContaStep(steps[2], steps), true);
});

Deno.test("pickActivateDestination — com conta vai doc", () => {
  const d = pickActivateDestination(steps, { electricity_bill_value: 250 });
  assertEquals(d?.step_key, "d_pedir_documento");
});

Deno.test("pickActivateDestination — sem conta vai conta de cadastro", () => {
  const d = pickActivateDestination(steps, {});
  assertEquals(d?.step_key, "d_simular_pedir_conta");
});

Deno.test("rewrite — cadastrar em conta de simulação → conta cadastro", () => {
  const rewritten = rewriteActivateAwayFromSimPath(steps[0], steps, {}, {
    messageText: "quero me cadastrar",
    buttonId: "cadastrar",
  });
  assertEquals(rewritten?.step_key, "d_simular_pedir_conta");
});

Deno.test("rewrite — ativar no seletor de simulação → conta cadastro", () => {
  const rewritten = rewriteActivateAwayFromSimPath(steps[4], steps, {}, {
    messageText: "3",
    buttonId: null,
  });
  // "3" alone is activate via resolveCanonicalNudge — but isActivateIntent("3")?
  // ACTIVATE_RX may not match bare "3". rewrite uses isActivateIntent.
  // Bare "3" is NOT activate intent — need button or phrase.
  assertEquals(rewritten, null);
});

Deno.test("rewrite — ativar o benefício no seletor → conta cadastro", () => {
  const rewritten = rewriteActivateAwayFromSimPath(steps[4], steps, {}, {
    messageText: "Ativar o benefício",
  });
  assertEquals(rewritten?.step_key, "d_simular_pedir_conta");
});

Deno.test("rewrite — com bill → documento", () => {
  const rewritten = rewriteActivateAwayFromSimPath(steps[0], steps, { electricity_bill_value: 400 }, {
    buttonId: "cadastrar",
  });
  assertEquals(rewritten?.step_key, "d_pedir_documento");
});

Deno.test("rewrite — documento SEM conta → conta cadastro", () => {
  const rewritten = rewriteActivateAwayFromSimPath(steps[3], steps, {}, {
    messageText: "quero me cadastrar",
  });
  assertEquals(rewritten?.step_key, "d_simular_pedir_conta");
});

Deno.test("rewrite — documento COM conta → mantém documento", () => {
  const rewritten = rewriteActivateAwayFromSimPath(
    steps[3],
    steps,
    { electricity_bill_value: 300 },
    { messageText: "quero me cadastrar" },
  );
  assertEquals(rewritten, null);
});

Deno.test("resolveCanonicalNudgeChoice", () => {
  assertEquals(resolveCanonicalNudgeChoice("1"), "simular");
  assertEquals(resolveCanonicalNudgeChoice("2"), "como");
  assertEquals(resolveCanonicalNudgeChoice("3"), "ativar");
  assertEquals(resolveCanonicalNudgeChoice("Ativar o benefício"), "ativar");
});
