// Tasks 21 + 22 (captacao-fluxo-d-conversao): testes dos helpers puros do
// cron de reaquecimento. O ciclo completo (chamadas a Supabase + Evolution)
// é coberto por smoke E2E em staging — aqui validamos só a parte determinística.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isInsideWindow, renderMessage } from "./index.ts";

Deno.test("renderMessage: substitui {{nome}} pelo primeiro nome", () => {
  const lead = {
    id: "x",
    consultant_id: "y",
    name: "Maria Silva Souza",
    phone_whatsapp: "5511999",
    conversation_step: "aguardando_conta",
    electricity_bill_value: 350.5,
    capture_mode: null,
    manual_override_reactivate: null,
  };
  const out = renderMessage("Oi {{nome}}, viu meu recado?", lead);
  assertEquals(out, "Oi Maria, viu meu recado?");
});

Deno.test("renderMessage: substitui {{valor_conta}} formatado pt-BR", () => {
  const lead = {
    id: "x",
    consultant_id: "y",
    name: "Maria",
    phone_whatsapp: "5511999",
    conversation_step: "aguardando_conta",
    electricity_bill_value: 1234.5,
    capture_mode: null,
    manual_override_reactivate: null,
  };
  const out = renderMessage("R$ {{valor_conta}} de conta", lead);
  // Aceita ambos formatos do toLocaleString (NBSP ou espaço normal).
  assert(/^R\$ 1[.,]234,50? de conta$/.test(out) || out === "R$ 1.234,50 de conta", `got: ${out}`);
});

Deno.test("renderMessage: variáveis ausentes viram string vazia", () => {
  const lead = {
    id: "x",
    consultant_id: "y",
    name: null,
    phone_whatsapp: "5511999",
    conversation_step: "aguardando_conta",
    electricity_bill_value: null,
    capture_mode: null,
    manual_override_reactivate: null,
  };
  const out = renderMessage("Oi {{nome}}, R$ {{valor_conta}}", lead);
  assertEquals(out, "Oi , R$ ");
});

Deno.test("renderMessage: aceita formato {nome} antigo (sem chaves duplas)", () => {
  const lead = {
    id: "x",
    consultant_id: "y",
    name: "João",
    phone_whatsapp: "5511999",
    conversation_step: "aguardando_conta",
    electricity_bill_value: null,
    capture_mode: null,
    manual_override_reactivate: null,
  };
  const out = renderMessage("E aí {nome}!", lead);
  assertEquals(out, "E aí João!");
});

Deno.test("isInsideWindow: usa default timezone quando null", () => {
  // Sem como mockar Date facilmente — só garantimos que não lança.
  const result = isInsideWindow(null);
  assertEquals(typeof result, "boolean");
});

Deno.test("isInsideWindow: timezone inválido cai em default seguro", () => {
  // Timezone inválido faz Intl.DateTimeFormat lançar — esperamos que a função
  // tolere e retorne `true` (default safe).
  const result = isInsideWindow("Mars/Olympus");
  assertEquals(result, true);
});

Deno.test("isInsideWindow: janela configurável aceita opts sem lançar", () => {
  const result = isInsideWindow("America/Sao_Paulo", { inicio: 8, fim: 22, fimDeSemana: true });
  assertEquals(typeof result, "boolean");
});

Deno.test("isInsideWindow: janela 0-24 com fim de semana é sempre verdadeira", () => {
  // inicio=0, fim=24 cobre todas as horas; fimDeSemana=true remove o bloqueio de sáb/dom.
  const result = isInsideWindow("America/Sao_Paulo", { inicio: 0, fim: 24, fimDeSemana: true });
  assertEquals(result, true);
});

Deno.test("isInsideWindow: janela impossível (inicio=fim) nunca permite", () => {
  const result = isInsideWindow("America/Sao_Paulo", { inicio: 12, fim: 12, fimDeSemana: true });
  assertEquals(result, false);
});
