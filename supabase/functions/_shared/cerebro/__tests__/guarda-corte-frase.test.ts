// Testes do corte de tamanho da Guarda (N5) — "nunca cortar frase no meio".
//
// Garante a regra de negócio pedida: a mensagem ao cliente SEMPRE termina numa
// frase completa (pontuação final), nunca pendurada no meio. Validamos via o
// ponto público `validarMensagem`, que aplica `normalizarTexto`
// (→ `cortarEmFraseCompleta`) antes de qualquer checagem.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validarMensagem } from "../guarda.ts";
import type { BotFlowStep, CustomerSnapshot } from "../tipos.ts";

function passo(over: Partial<BotFlowStep> = {}): BotFlowStep {
  return {
    id: "p1",
    flowId: "f1",
    stepKey: "interesse",
    stepType: "text_message",
    position: 0,
    messageText: null,
    persuasiveText: null,
    choiceOptions: null,
    preferredChoiceKind: null,
    captures: [],
    transitions: [],
    fallback: { mode: "repeat" },
    waitFor: "none",
    waitSeconds: 0,
    pipelineKind: null,
    slotKey: null,
    conditionExpr: null,
    reachableStepIds: [],
    ...over,
  } as BotFlowStep;
}

function estado(): CustomerSnapshot {
  return {
    customerId: "c1",
    customer: { name: "Maria" },
    currentStepId: "p1",
    status: "engaging",
    retries: 0,
    aiQuestionsThisStep: 0,
    enteredStepAt: null,
    expiresAt: null,
    lastInboundAt: "2026-01-01T00:00:00Z",
    lastOutboundAt: null,
    lastOutboundContentHash: null,
    flowId: "f1",
  } as unknown as CustomerSnapshot;
}

const TERMINADORES = [".", "!", "?", "…"];

function terminaEmFraseCompleta(texto: string): boolean {
  const t = texto.trim();
  if (!t) return false;
  if (TERMINADORES.some((p) => t.endsWith(p))) return true;
  // Emoji ao final é aceitável como término (mensagem de WhatsApp).
  return /\p{Emoji}$/u.test(t);
}

Deno.test("corte: texto longo é cortado SEM partir a última frase", async () => {
  // 6 frases que, juntas, passam de 450 chars. O corte deve terminar numa delas.
  const frase = "A iGreen reduz a sua conta de luz com energia limpa e sem obra. ";
  const longo = frase.repeat(10).trim(); // ~620 chars
  const r = await validarMensagem({
    textoProposto: longo,
    passoAtual: passo(),
    estado: estado(),
  });
  assert(r.aprovado, `deveria aprovar: ${r.motivoBloqueio}`);
  assert(
    terminaEmFraseCompleta(r.textoFinal),
    `texto cortado no meio da frase: "...${r.textoFinal.slice(-40)}"`,
  );
  // E não pode terminar com palavra solta sem pontuação.
  assert(!/\b(e|sem|com|da|de|a|o)$/i.test(r.textoFinal.trim()), "terminou em palavra de ligação");
});

Deno.test("corte: mensagem curta passa intacta", async () => {
  const curto = "Oi! Tudo bem? Que bom que você quer economizar na conta de luz.";
  const r = await validarMensagem({
    textoProposto: curto,
    passoAtual: passo(),
    estado: estado(),
  });
  assert(r.aprovado, `deveria aprovar: ${r.motivoBloqueio}`);
  assertEquals(r.textoFinal, curto);
});

Deno.test("corte: primeira frase inteira é preservada mesmo passando do limite macio", async () => {
  // Uma única frase de ~500 chars (sem pontuação no meio). Deve sair inteira
  // (cabe no teto estrutural 600), não cortada no caractere 450.
  const umaFrase =
    "Olha, funciona assim: você continua recebendo a mesma conta da sua distribuidora " +
    "de sempre, sem trocar nada na sua casa, sem obra, sem instalar painel, e mesmo " +
    "assim passa a ganhar um desconto todo mês por fazer parte da nossa comunidade de " +
    "energia limpa que já tem centenas de milhares de pessoas no Brasil inteiro hoje.";
  const r = await validarMensagem({
    textoProposto: umaFrase,
    passoAtual: passo(),
    estado: estado(),
  });
  assert(r.aprovado, `deveria aprovar: ${r.motivoBloqueio}`);
  assert(terminaEmFraseCompleta(r.textoFinal), "não terminou em frase completa");
});
