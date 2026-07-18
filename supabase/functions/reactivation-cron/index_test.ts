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

Deno.test("renderMessage: nome ausente não deixa vírgula/espaço sobrando", () => {
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
  // "Oi {{nome}}, tudo bem?" → sem nome deve virar "Oi! Tudo bem?"
  const out1 = renderMessage("Oi {{nome}}, tudo bem?", lead);
  assertEquals(out1, "Oi! Tudo bem?");

  // "{{nome}}, confirma os dados" → "Confirma os dados"
  const out2 = renderMessage("{{nome}}, confirma os dados", lead);
  assertEquals(out2, "Confirma os dados");

  // Nenhuma vírgula órfã no começo nem espaços duplos no meio
  const out3 = renderMessage("Olá {{nome}}, valor R$ {{valor_conta}}", lead);
  assert(!out3.startsWith(","), `não pode começar com vírgula: ${out3}`);
  assert(!/ {2,}/.test(out3), `não pode ter espaços duplos: ${out3}`);
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

Deno.test("isInsideWindow: timezone inválido é fail-closed", () => {
  // Timezone inválido faz Intl.DateTimeFormat lançar — não enviar.
  const result = isInsideWindow("Mars/Olympus");
  assertEquals(result, false);
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
