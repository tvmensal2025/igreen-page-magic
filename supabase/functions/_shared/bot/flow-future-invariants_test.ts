/**
 * INVARIANTES PARA FLUXOS FUTUROS — dry run, sem rede e sem banco.
 *
 * Prova que as regras de ouro do motor NÃO dependem dos nomes d_* do
 * Fluxo D/M. Qualquer fluxo criado no futuro (keys novas, passos
 * intermediários, ordem diferente) continua obedecendo:
 *
 *   R1. ATIVAR/CADASTRAR nunca cai em caminho de simulação.
 *   R2. ATIVAR sem conta → conta de CADASTRO (a que leva a documento).
 *   R3. ATIVAR com conta → documento (pula a foto, não pula o resto).
 *   R4. Cadastrar apontado DIRETO pra documento sem conta → volta pra conta.
 *   R5. Grafos com ciclo não travam o classificador (loop guard).
 *   R6. Fluxo sem passos de cadastro (ex.: variante A/B) → null, sem crash
 *       (handlers caem no template pedir_conta).
 *   R7. Gates finais (ask_contaunica → ask_finalizar) valem p/ qualquer fluxo.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hasBillReady,
  isCadastroContaStep,
  pickActivateDestination,
  rewriteActivateAwayFromSimPath,
  type ActivateStepLike,
} from "./flow-activate-routing.ts";
import { isPrePortalCadastroStep, nextSeparatedCadastroStep } from "./cadastro-fixes.ts";

const ATIVAR = { messageText: "quero ativar o benefício", buttonId: "ativar" };
const SEM_CONTA = {};
const COM_CONTA = { electricity_bill_value: 350, bill_data_confirmed_at: "2026-07-01" };

// ─── Fluxo futuro "X": keys 100% diferentes de d_*, com passo intermediário ──
// conta_sim → resultado_sim (simulação)
// conta_cad → confere_dados (message) → doc (cadastro com passo no meio)
const FLUXO_X: ActivateStepLike[] = [
  { id: "x1", step_key: "x_boasvindas", step_type: "message", is_active: true },
  {
    id: "x2",
    step_key: "x_conta_para_simular",
    step_type: "capture_conta",
    is_active: true,
    fallback: { mode: "goto", goto_step_id: "x3", success_goto_step_id: "x3" },
  },
  { id: "x3", step_key: "x_resultado_simulacao", step_type: "message", is_active: true },
  {
    id: "x4",
    step_key: "x_conta_para_adesao",
    step_type: "capture_conta",
    is_active: true,
    fallback: { mode: "goto", goto_step_id: "x5", success_goto_step_id: "x5" },
  },
  {
    id: "x5",
    step_key: "x_confere_dados",
    step_type: "message",
    is_active: true,
    fallback: { mode: "goto", goto_step_id: "x6" },
  },
  { id: "x6", step_key: "x_envia_documento", step_type: "capture_documento", is_active: true },
];

Deno.test("R2 futuro: ativar sem conta → conta de CADASTRO (via passo intermediário)", () => {
  // x_conta_para_adesao não leva direto a documento: passa por x_confere_dados.
  // O BFS do classificador precisa enxergar 2 níveis à frente.
  assertEquals(isCadastroContaStep(FLUXO_X[3], FLUXO_X), true);
  assertEquals(isCadastroContaStep(FLUXO_X[1], FLUXO_X), false);
  assertEquals(pickActivateDestination(FLUXO_X, SEM_CONTA)?.id, "x4");
});

Deno.test("R3 futuro: ativar com conta → documento direto", () => {
  assert(hasBillReady(COM_CONTA));
  assertEquals(pickActivateDestination(FLUXO_X, COM_CONTA)?.id, "x6");
});

Deno.test("R1 futuro: cadastrar caindo na conta de SIMULAÇÃO → reescreve p/ conta de cadastro", () => {
  const r = rewriteActivateAwayFromSimPath(FLUXO_X[1], FLUXO_X, SEM_CONTA, ATIVAR);
  assertEquals(r?.id, "x4");
});

Deno.test("R4 futuro: cadastrar apontado DIRETO pra documento sem conta → volta pra conta", () => {
  const r = rewriteActivateAwayFromSimPath(FLUXO_X[5], FLUXO_X, SEM_CONTA, ATIVAR);
  assertEquals(r?.id, "x4");
  // Com conta o destino documento é mantido (null = não reescreve)
  assertEquals(rewriteActivateAwayFromSimPath(FLUXO_X[5], FLUXO_X, COM_CONTA, ATIVAR), null);
});

Deno.test("R1 futuro: intenção SIMULAR não é reescrita (fica no caminho de simulação)", () => {
  const r = rewriteActivateAwayFromSimPath(FLUXO_X[1], FLUXO_X, SEM_CONTA, {
    messageText: "quero simular economia",
    buttonId: "simular",
  });
  assertEquals(r, null);
});

// ─── Grafo com CICLO: conta → menu → conta (fluxo futuro mal montado) ────────
const FLUXO_CICLO: ActivateStepLike[] = [
  {
    id: "c1",
    step_key: "y_menu",
    step_type: "message",
    is_active: true,
    transitions: [{ goto_step_id: "c2" }],
  },
  {
    id: "c2",
    step_key: "y_conta",
    step_type: "capture_conta",
    is_active: true,
    // ciclo proposital: conta volta pro menu
    fallback: { mode: "goto", goto_step_id: "c1" },
    transitions: [{ goto_step_id: "c1" }],
  },
];

Deno.test("R5 futuro: ciclo no grafo não trava (loop guard) e classifica como simulação", () => {
  // Sem documento alcançável → conservador: NÃO é conta de cadastro
  assertEquals(isCadastroContaStep(FLUXO_CICLO[1], FLUXO_CICLO), false);
  // pickActivateDestination ainda devolve algo utilizável (última opção: a conta)
  assertEquals(pickActivateDestination(FLUXO_CICLO, SEM_CONTA)?.id, "c2");
});

// ─── Fluxo sem passos de cadastro (ex.: variante A/B conversacional) ─────────
const FLUXO_SEM_CADASTRO: ActivateStepLike[] = [
  { id: "a1", step_key: "a_welcome", step_type: "message", is_active: true },
  { id: "a2", step_key: "a_pitch", step_type: "message", is_active: true },
];

Deno.test("R6 futuro: fluxo sem conta/documento → null (handler usa template, sem crash)", () => {
  assertEquals(pickActivateDestination(FLUXO_SEM_CADASTRO, SEM_CONTA), null);
  assertEquals(pickActivateDestination(FLUXO_SEM_CADASTRO, COM_CONTA), null);
  assertEquals(
    rewriteActivateAwayFromSimPath(FLUXO_SEM_CADASTRO[0], FLUXO_SEM_CADASTRO, SEM_CONTA, ATIVAR),
    null,
  );
});

// ─── Passos desativados não contam ───────────────────────────────────────────
Deno.test("R2 futuro: conta de cadastro DESATIVADA não é escolhida", () => {
  const steps = FLUXO_X.map((s) => (s.id === "x4" ? { ...s, is_active: false } : s));
  const dest = pickActivateDestination(steps, SEM_CONTA);
  // fallback documentado: sem conta de cadastro ativa → documento (portal pede conta depois)
  assertEquals(dest?.id, "x6");
});

// ─── R7: gates finais valem para QUALQUER fluxo (não dependem do grafo) ──────
Deno.test("R7 futuro: gates finais sempre na ordem ask_contaunica → ask_finalizar", () => {
  assertEquals(nextSeparatedCadastroStep({}), "ask_contaunica");
  assertEquals(nextSeparatedCadastroStep({ contaunica_answered: true }), "ask_finalizar");
  assertEquals(isPrePortalCadastroStep("ask_contaunica"), true);
  assertEquals(isPrePortalCadastroStep("ask_finalizar"), true);
  assertEquals(isPrePortalCadastroStep("finalizando"), false);
});
