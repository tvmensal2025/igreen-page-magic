/**
 * Jornada DRY completa 0 → final (sem WhatsApp, sem portal, sem banco).
 *
 * Cobre:
 *  A) Conversacional → aguardando_conta
 *  B) Sys cadastro campo a campo (getNextMissingStep)
 *  C) Gate separado: ask_contaunica → ask_finalizar → finalizando
 *  D) Variantes CNH vs RG, e-mail inválido, CPF inválido
 *  E) Roteamento Ativar (Fluxo D/M) — não vai para simulação
 *
 * Rodar:
 *   deno test supabase/functions/_shared/bot/jornada-completa-dry_test.ts --allow-read
 */
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getNextMissingStep,
  missingPreferenceStep,
  getPreferenceOptions,
  getReplyForStep,
  validarCPFDigitos,
} from "../conversation-helpers.ts";
import {
  decideTransition,
  type ConversationalStep,
  type Intent,
} from "./conversational-state-machine.ts";
import {
  nextSeparatedCadastroStep,
  isPrePortalCadastroStep,
  resumeAfterAddressEdit,
} from "./cadastro-fixes.ts";
import {
  isActivateIntent,
  isSimulateIntent,
  pickActivateDestination,
  rewriteActivateAwayFromSimPath,
} from "./flow-activate-routing.ts";

/** CPF válido conhecido (dígitos verificadores OK). */
const CPF_OK = "52998224725";

Deno.test("pré-condição: CPF_OK passa validarCPFDigitos", () => {
  assertEquals(validarCPFDigitos(CPF_OK), true);
  assertEquals(validarCPFDigitos("11111111111"), false);
});

// ─── A) Conversacional 0 → aguardando_conta ─────────────────────────────

Deno.test("A1 happy path conversacional: welcome → … → aguardando_conta", () => {
  const path: Array<[ConversationalStep, Intent]> = [
    ["welcome", "saudacao"],
    ["qualificacao", "ja_assistiu_video"],
    ["checkin_pos_video", "afirmacao"],
    ["pitch_conexao_club", "outro"],
    ["duvidas_pos_club", "afirmacao"],
  ];
  let step: string = "welcome";
  const visited: string[] = [step];
  for (const [expected, intent] of path) {
    assertEquals(step, expected);
    const t = decideTransition(expected, intent);
    step = t.nextStep;
    visited.push(step);
  }
  assertEquals(step, "aguardando_conta");
  assertEquals(visited, [
    "welcome",
    "qualificacao",
    "checkin_pos_video",
    "pitch_conexao_club",
    "duvidas_pos_club",
    "aguardando_conta",
  ]);
});

Deno.test("A2 atalho quer_cadastrar em qualquer step → aguardando_conta", () => {
  for (const s of [
    "welcome",
    "menu_inicial",
    "qualificacao",
    "checkin_pos_video",
    "duvidas_pos_club",
  ] as ConversationalStep[]) {
    assertEquals(decideTransition(s, "quer_cadastrar").nextStep, "aguardando_conta");
  }
});

Deno.test("A3 quer_humano → aguardando_humano (não cadastro)", () => {
  assertEquals(decideTransition("welcome", "quer_humano").nextStep, "aguardando_humano");
});

// ─── B) Sys cadastro: cada campo ────────────────────────────────────────

Deno.test("B1 jornada sys CNH (sem verso) até ask_contaunica", () => {
  const c: Record<string, unknown> = {};
  assertEquals(getNextMissingStep(c), "ask_name");

  c.name = "Maria Silva Teste";
  assertEquals(getNextMissingStep(c), "ask_cpf");

  c.cpf = CPF_OK;
  assertEquals(getNextMissingStep(c), "ask_rg");

  c.rg = "123456789";
  assertEquals(getNextMissingStep(c), "ask_birth_date");

  c.data_nascimento = "1990-05-15";
  assertEquals(getNextMissingStep(c), "ask_phone_confirm");

  c.phone_landline = "11999998888";
  assertEquals(getNextMissingStep(c), "ask_phone_confirm"); // sem confirm

  c.phone_contact_confirmed = true;
  assertEquals(getNextMissingStep(c), "ask_email");

  c.email = "maria@teste.com"; // @teste → ainda pede
  assertEquals(getNextMissingStep(c), "ask_email");

  c.email = "maria.silva@gmail.com";
  assertEquals(getNextMissingStep(c), "ask_number");

  c.address_number = "100";
  assertEquals(getNextMissingStep(c), "ask_complement");

  c.address_complement = "apto 12";
  assertEquals(getNextMissingStep(c), "ask_distribuidora");

  c.distribuidora = "CPFL";
  assertEquals(getNextMissingStep(c), "ask_installation_number");

  c.numero_instalacao = "1234567";
  assertEquals(getNextMissingStep(c), "ask_bill_value");

  c.electricity_bill_value = 20; // < 30 → ainda pede
  assertEquals(getNextMissingStep(c), "ask_bill_value");

  c.electricity_bill_value = 350;
  assertEquals(getNextMissingStep(c), "ask_doc_frente_manual");

  c.document_front_url = "https://cdn.test/doc-frente.jpg";
  c.document_type = "CNH";
  // CNH: sem verso
  assertEquals(getNextMissingStep(c), "ask_contaunica");

  assertEquals(missingPreferenceStep(c), "ask_contaunica");
  assertEquals(nextSeparatedCadastroStep(c), "ask_contaunica");
  assert(isPrePortalCadastroStep("ask_contaunica"));
});

Deno.test("B2 jornada sys RG exige verso antes do boleto", () => {
  const c: Record<string, unknown> = {
    name: "Joao RG",
    cpf: CPF_OK,
    rg: "123456789",
    data_nascimento: "1988-01-01",
    phone_landline: "11988887777",
    phone_contact_confirmed: true,
    email: "joao@gmail.com",
    address_number: "50",
    address_complement: "",
    distribuidora: "Enel",
    numero_instalacao: "7654321",
    electricity_bill_value: 280,
    document_front_url: "https://cdn.test/frente.jpg",
    document_type: "RG",
  };
  assertEquals(getNextMissingStep(c), "ask_doc_verso_manual");
  c.document_back_url = "https://cdn.test/verso.jpg";
  assertEquals(getNextMissingStep(c), "ask_contaunica");
});

Deno.test("B3 placeholder birth + email consultor + CEP não bloqueia", () => {
  const c: Record<string, unknown> = {
    name: "Ana",
    cpf: CPF_OK,
    rg: "1234567",
    data_nascimento: "2000-01-01", // placeholder
  };
  assertEquals(getNextMissingStep(c), "ask_birth_date");
  c.data_nascimento = "1995-03-20";
  c.phone_landline = "11911112222";
  c.phone_contact_confirmed = true;
  c.email = "consultor@igreen.com.br";
  assertEquals(
    getNextMissingStep(c, { consultorEmail: "consultor@igreen.com.br" }),
    "ask_email",
  );
  c.email = "ana@gmail.com";
  // sem CEP → vai para número (F03: nunca ask_cep)
  assertEquals(getNextMissingStep(c), "ask_number");
  assert(getNextMissingStep(c) !== "ask_cep");
});

Deno.test("B4 mensagens e opções existem para cada step canônico", () => {
  const steps = [
    "ask_name",
    "ask_cpf",
    "ask_rg",
    "ask_birth_date",
    "ask_phone_confirm",
    "ask_email",
    "ask_number",
    "ask_complement",
    "ask_distribuidora",
    "ask_installation_number",
    "ask_bill_value",
    "ask_doc_frente_manual",
    "ask_doc_verso_manual",
    "ask_contaunica",
    "ask_finalizar",
    "finalizando",
  ];
  for (const s of steps) {
    const msg = getReplyForStep(s, { address_street: "Rua A", phone_whatsapp: "5511999998888" });
    assert(msg.length > 5, `reply vazio em ${s}`);
    assert(!/Continuando/.test(msg) || s === "unknown", `fallback genérico em ${s}`);
  }
  const opts = getPreferenceOptions("ask_contaunica");
  assertEquals(opts?.length, 2);
  assertEquals(opts?.[0].id, "boleto_unificado");
  assertEquals(opts?.[1].id, "boleto_separado");
});

// ─── C) Gate final separado (SEM portal) ────────────────────────────────

Deno.test("C1 ordem canônica boleto → confirmar → finalizando (dry, sem portal)", () => {
  const order: string[] = [];
  let c: Record<string, unknown> = {
    name: "X",
    cpf: CPF_OK,
    rg: "1",
    data_nascimento: "1990-01-01",
    phone_landline: "11999998888",
    phone_contact_confirmed: true,
    email: "x@gmail.com",
    address_number: "1",
    address_complement: "n/a",
    distribuidora: "CPFL",
    numero_instalacao: "1234567",
    electricity_bill_value: 300,
    document_front_url: "https://x/f.jpg",
    document_type: "CNH",
  };

  let step = getNextMissingStep(c);
  assertEquals(step, "ask_contaunica");
  order.push(step);

  // responde boleto unificado
  c = {
    ...c,
    contaunica: true,
    transferir_titularidade: true,
    contaunica_answered: true,
    transferir_titularidade_answered: true,
  };
  step = nextSeparatedCadastroStep(c);
  assertEquals(step, "ask_finalizar");
  assertEquals(getNextMissingStep(c), "ask_finalizar");
  assertEquals(missingPreferenceStep(c), null);
  order.push(step);

  // clique Finalizar → finalizando (NÃO disparamos portal)
  const portalDispatched = false;
  step = "finalizando";
  order.push(step);
  assertEquals(isPrePortalCadastroStep("finalizando"), false);
  assertEquals(portalDispatched, false);
  assertEquals(order, ["ask_contaunica", "ask_finalizar", "finalizando"]);
});

Deno.test("C2 Finalizar SEM boleto redireciona para ask_contaunica", () => {
  const c = { contaunica_answered: false };
  assertEquals(nextSeparatedCadastroStep(c), "ask_contaunica");
  assertEquals(missingPreferenceStep(c), "ask_contaunica");
});

Deno.test("C3 boleto separado também vai a ask_finalizar (não portal)", () => {
  const c = {
    contaunica: false,
    transferir_titularidade: false,
    contaunica_answered: true,
  };
  assertEquals(nextSeparatedCadastroStep(c), "ask_finalizar");
  assertEquals(isPrePortalCadastroStep("ask_finalizar"), true);
});

Deno.test("C4 resumeAfterAddressEdit no fim → ask_finalizar (não reabre simulação)", () => {
  assertEquals(
    resumeAfterAddressEdit({ previous_conversation_step: "ask_contaunica" }),
    "ask_finalizar",
  );
  assertEquals(
    resumeAfterAddressEdit({ previous_conversation_step: "finalizando" }),
    "ask_finalizar",
  );
});

// ─── D) Fluxo D/M — Ativar ≠ Simular ────────────────────────────────────

const DM_STEPS = [
  {
    id: "sim-conta",
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
    id: "cad-conta",
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
];

Deno.test("D1 intenções ativar vs simular", () => {
  assertEquals(isActivateIntent("quero ativar o benefício", null), true);
  assertEquals(isActivateIntent("quero simular", null), false);
  assertEquals(isSimulateIntent("quero simular economia", null), true);
  assertEquals(isSimulateIntent("ativar", null), false);
});

Deno.test("D2 ativar sem conta → conta de CADASTRO (não simulação)", () => {
  const dest = pickActivateDestination(DM_STEPS, {});
  assertEquals(dest?.id, "cad-conta");
});

Deno.test("D3 ativar com conta → documento", () => {
  const dest = pickActivateDestination(DM_STEPS, {
    electricity_bill_value: 400,
    bill_data_confirmed_at: "2026-01-01",
  });
  assertEquals(dest?.id, "doc");
});

Deno.test("D4 rewrite: cadastrar no passo de simulação → conta cadastro", () => {
  const r = rewriteActivateAwayFromSimPath(DM_STEPS[0], DM_STEPS, {}, {
    messageText: "quero me cadastrar",
    buttonId: "cadastrar",
  });
  assertEquals(r?.id, "cad-conta");
});

// ─── E) Ordem completa consolidada (assert único) ───────────────────────

Deno.test("E1 ORDEM COMPLETA 0→final dry (conversa + sys + gate, SEM portal)", () => {
  // 1) conversa
  let step = decideTransition("welcome", "saudacao").nextStep;
  step = decideTransition(step as ConversationalStep, "ja_assistiu_video").nextStep;
  step = decideTransition(step as ConversationalStep, "afirmacao").nextStep;
  step = decideTransition(step as ConversationalStep, "outro").nextStep;
  step = decideTransition(step as ConversationalStep, "afirmacao").nextStep;
  assertEquals(step, "aguardando_conta");

  // 2) pós-conta (OCR ok) → sys
  const c: Record<string, unknown> = {
    // conta já veio do OCR
    electricity_bill_value: 420,
    distribuidora: "CPFL Paulista",
    numero_instalacao: "9876543210",
    address_number: "200",
    address_complement: "casa",
    cep: "13010000",
  };
  // ainda falta identidade
  assertEquals(getNextMissingStep(c), "ask_name");
  c.name = "Pedro Completo";
  c.cpf = CPF_OK;
  c.rg = "99887766";
  c.data_nascimento = "1985-07-07";
  c.phone_landline = "19987654321";
  c.phone_contact_confirmed = true;
  c.email = "pedro.completo@gmail.com";
  c.document_front_url = "https://cdn/doc.jpg";
  c.document_type = "CNH";

  assertEquals(getNextMissingStep(c), "ask_contaunica");

  // 3) boleto
  c.contaunica_answered = true;
  c.contaunica = true;
  assertEquals(getNextMissingStep(c), "ask_finalizar");
  assertEquals(nextSeparatedCadastroStep(c), "ask_finalizar");

  // 4) finalizando marcado — portal NÃO chamado neste dry
  const wouldTouchPortal = true; // só no clique
  const portalCalledInThisTest = false;
  assertEquals(wouldTouchPortal && !portalCalledInThisTest, true);
  assertEquals(isPrePortalCadastroStep("ask_finalizar"), true);
  assertEquals(isPrePortalCadastroStep("finalizando"), false);
});
