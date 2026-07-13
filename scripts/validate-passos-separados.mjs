/**
 * Validação dry dos passos SEPARADOS (boleto → confirmar → portal).
 * NÃO chama portal, WhatsApp nem banco — só ordem canônica.
 *
 *   node --test scripts/validate-passos-separados.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

function nextSeparatedCadastroStep(customer) {
  if (!customer || customer.contaunica_answered !== true) return "ask_contaunica";
  return "ask_finalizar";
}

function isPrePortalCadastroStep(step) {
  const s = String(step || "");
  return s === "ask_contaunica" || s === "ask_transferir_titularidade" || s === "ask_finalizar";
}

/** Simula resposta de boleto → próximo step (sem portal). */
function afterBoletoChoice(chooseUnificado) {
  const updates = {
    contaunica: chooseUnificado,
    transferir_titularidade: chooseUnificado,
    contaunica_answered: true,
    transferir_titularidade_answered: true,
  };
  const next = nextSeparatedCadastroStep(updates);
  return { updates, next, touchesPortal: next === "finalizando" };
}

/** Simula clicar Finalizar só depois do boleto. */
function afterFinalizarClick(customer) {
  if (customer.contaunica_answered !== true) {
    return { step: "ask_contaunica", touchesPortal: false };
  }
  return { step: "finalizando", touchesPortal: true }; // só aqui — teste não dispara
}

test("sem boleto → ask_contaunica (não finalizar/portal)", () => {
  assert.equal(nextSeparatedCadastroStep({}), "ask_contaunica");
  assert.equal(nextSeparatedCadastroStep({ contaunica_answered: false }), "ask_contaunica");
  assert.equal(nextSeparatedCadastroStep(null), "ask_contaunica");
});

test("com boleto respondido → ask_finalizar (ainda sem portal)", () => {
  assert.equal(nextSeparatedCadastroStep({ contaunica_answered: true }), "ask_finalizar");
  assert.equal(isPrePortalCadastroStep("ask_finalizar"), true);
});

test("após escolher unificado → ask_finalizar, NÃO finalizando", () => {
  const r = afterBoletoChoice(true);
  assert.equal(r.next, "ask_finalizar");
  assert.equal(r.touchesPortal, false);
  assert.equal(r.updates.contaunica, true);
});

test("após escolher separado → ask_finalizar, NÃO finalizando", () => {
  const r = afterBoletoChoice(false);
  assert.equal(r.next, "ask_finalizar");
  assert.equal(r.touchesPortal, false);
  assert.equal(r.updates.contaunica, false);
});

test("Finalizar sem boleto redireciona para ask_contaunica", () => {
  const r = afterFinalizarClick({ contaunica_answered: false });
  assert.equal(r.step, "ask_contaunica");
  assert.equal(r.touchesPortal, false);
});

test("Finalizar com boleto pode ir a finalizando (portal só depois — não executamos)", () => {
  const r = afterFinalizarClick({ contaunica_answered: true, contaunica: true });
  assert.equal(r.step, "finalizando");
  // dry: não disparamos dispatchPortalWorker
  assert.equal(r.touchesPortal, true);
});

test("ordem canônica completa dry", () => {
  const order = [];
  let c = { name: "Teste", email: "t@t.com", phone_contact_confirmed: true };

  // 1) chegar no fim dos dados → boleto
  let step = nextSeparatedCadastroStep(c);
  order.push(step);
  assert.equal(step, "ask_contaunica");

  // 2) responde boleto → confirmar
  c = { ...c, contaunica_answered: true, contaunica: true };
  step = nextSeparatedCadastroStep(c);
  order.push(step);
  assert.equal(step, "ask_finalizar");

  // 3) só no clique Finalizar → finalizando (sem chamar portal neste teste)
  const fin = afterFinalizarClick(c);
  order.push(fin.step);
  assert.deepEqual(order, ["ask_contaunica", "ask_finalizar", "finalizando"]);
});

test("isPrePortalCadastroStep cobre os dois gates", () => {
  assert.equal(isPrePortalCadastroStep("ask_contaunica"), true);
  assert.equal(isPrePortalCadastroStep("ask_finalizar"), true);
  assert.equal(isPrePortalCadastroStep("finalizando"), false);
  assert.equal(isPrePortalCadastroStep("portal_submitting"), false);
});
