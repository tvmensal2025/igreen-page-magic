import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyLeadIntent,
  hasPurchaseIntent,
  isStatusQuestion,
  wantsToAdvance,
} from "./cadastro-intent.ts";

const ADVANCE_OK = [
  "quero contratar",
  "Quero Contratar!",
  "vamos sim",
  "aceito a proposta",
  "como faço para aderir?",
  "quero me cadastrar",
  "bora cadastrar",
  "continuar cadastro",
  "✅ Continuar Cadastro",
  "cadastrar",
  "bora",
  "partiu",
  "fechou",
  "quero participar",
  "pode cadastrar",
];

const ADVANCE_NO = [
  "não quero contratar",
  "nao quero contratar",
  "nem vamos sim",
  "é golpe?",
  "como funciona?",
  "",
  "Eu ja estou me cadastrando?",
  "ja estou me cadastrando",
  "estou me cadastrando",
  "em que passo estou?",
  "?",
];

const STATUS_OK = [
  "Eu ja estou me cadastrando?",
  "ja estou me cadastrando",
  "estou me cadastrando",
  "em que passo estou?",
  "cadastro já começou?",
  "?",
];

Deno.test("wantsToAdvance: frases de avanço", () => {
  for (const t of ADVANCE_OK) {
    assertEquals(wantsToAdvance(t), true, `deveria avançar: ${t}`);
  }
});

Deno.test("wantsToAdvance: não dispara em status/pergunta/negação", () => {
  for (const t of ADVANCE_NO) {
    assertEquals(wantsToAdvance(t), false, `não deveria avançar: ${t}`);
  }
});

Deno.test("isStatusQuestion: perguntas de andamento", () => {
  for (const t of STATUS_OK) {
    assertEquals(isStatusQuestion(t), true, `status: ${t}`);
  }
  assertEquals(isStatusQuestion("quero cadastrar"), false);
});

Deno.test("classifyLeadIntent: prioridade status > advance > question", () => {
  assertEquals(classifyLeadIntent("Eu ja estou me cadastrando?"), "status");
  assertEquals(classifyLeadIntent("quero cadastrar"), "advance");
  assertEquals(classifyLeadIntent("tem fidelidade?"), "question");
  assertEquals(classifyLeadIntent("oi"), "none");
});

Deno.test("hasPurchaseIntent: compat com purchase-intent_test legado", () => {
  assertEquals(hasPurchaseIntent("quero contratar"), true);
  assertEquals(hasPurchaseIntent("vamos sim"), true);
  assertEquals(hasPurchaseIntent("não quero contratar"), false);
  assertEquals(hasPurchaseIntent("como funciona?"), false);
  assertEquals(hasPurchaseIntent("Eu ja estou me cadastrando?"), false);
});
