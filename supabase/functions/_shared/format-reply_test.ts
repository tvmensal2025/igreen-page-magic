import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  truncateAtSentence,
  normalizeSpacing,
  capitalizeSentences,
  emphasizeKeyTerms,
  formatReply,
  prettifyFaqLayout,
  formatFaqReply,
  stripPushyCadastroCta,
  withSoftFlowClose,
  hasSoftClose,
  SOFT_FLOW_CLOSE,
} from "./format-reply.ts";

// ─── truncateAtSentence ─────────────────────────────────────────────────
Deno.test("não trunca texto dentro do limite", () => {
  const t = "Resposta curta e completa.";
  assertEquals(truncateAtSentence(t, 600), t);
});

Deno.test("trunca no fim da última frase completa", () => {
  const t = "Primeira frase aqui. Segunda frase também. " + "x".repeat(600);
  const out = truncateAtSentence(t, 60);
  // Deve terminar em ponto, não no meio da palavra de x.
  assertEquals(out.endsWith("."), true);
  assertEquals(out.includes("x"), false);
});

Deno.test("corta em palavra inteira + reticências quando não há frase", () => {
  const t = "palavra ".repeat(200); // sem pontuação
  const out = truncateAtSentence(t, 50);
  assertEquals(out.endsWith("…"), true);
  // Não corta no meio de "palavra".
  assertEquals(/palavr$/.test(out.replace("…", "").trim()), false);
});

Deno.test("não deixa frase cortada no meio (caso real do bug)", () => {
  // O bug original: slice(280) cego cortava no meio de uma palavra, ex.:
  // "Olá! Sou o Rafael da" (cortou "da" colado). O truncateAtSentence corta
  // em palavra INTEIRA + reticências quando não há frase completa utilizável.
  const t = "Olá! Sou o Rafael da iGreen e vou te ajudar muito mesmo agora.";
  const out = truncateAtSentence(t, 20);
  // Nunca termina com palavra cortada/colada; usa reticências em palavra inteira.
  assertEquals(out, "Olá! Sou o Rafael…");
  // Garante que não cortou no meio de uma palavra (último token íntegro).
  assertEquals(/\b(Rafael)…$/.test(out), true);
});

// ─── normalizeSpacing ───────────────────────────────────────────────────
Deno.test("colapsa quebras de linha triplas em duplas", () => {
  assertEquals(normalizeSpacing("a\n\n\n\nb"), "a\n\nb");
});

Deno.test("remove espaços duplicados e espaço antes de pontuação", () => {
  assertEquals(normalizeSpacing("oi  mundo .  tudo bem ?"), "oi mundo. tudo bem?");
});

// ─── capitalizeSentences ────────────────────────────────────────────────
Deno.test("capitaliza início do texto", () => {
  assertEquals(capitalizeSentences("oi tudo bem"), "Oi tudo bem");
});

Deno.test("capitaliza após pontuação de fim de frase", () => {
  assertEquals(capitalizeSentences("oi. tudo bem? sim!"), "Oi. Tudo bem? Sim!");
});

Deno.test("capitaliza após quebra de linha", () => {
  assertEquals(capitalizeSentences("linha um\nlinha dois"), "Linha um\nLinha dois");
});

// ─── emphasizeKeyTerms ──────────────────────────────────────────────────
Deno.test("aplica negrito em iGreen e ANEEL", () => {
  const out = emphasizeKeyTerms("A iGreen é regulada pela ANEEL.");
  assertEquals(out, "A *iGreen* é regulada pela *ANEEL*.");
});

Deno.test("não aplica negrito duas vezes no mesmo termo", () => {
  const out = emphasizeKeyTerms("iGreen e iGreen de novo");
  // Só a primeira ocorrência ganha negrito.
  assertEquals(out, "*iGreen* e iGreen de novo");
});

Deno.test("não re-negrita termo já em negrito", () => {
  const out = emphasizeKeyTerms("a *iGreen* já está em negrito");
  assertEquals(out, "a *iGreen* já está em negrito");
});

// ─── formatReply (pipeline completo) ────────────────────────────────────
Deno.test("pipeline: capitaliza, espaça e destaca", () => {
  const out = formatReply("oi!  a igreen tem desconto  de verdade .");
  // Capitaliza início, colapsa espaços, negrito em iGreen e desconto.
  assertEquals(out.startsWith("Oi!"), true);
  assertEquals(out.includes("*iGreen*") || out.includes("*igreen*"), true);
  assertEquals(out.includes("  "), false);
});

Deno.test("formatReply vazio retorna string vazia", () => {
  assertEquals(formatReply(""), "");
  assertEquals(formatReply(null), "");
  assertEquals(formatReply(undefined), "");
});

Deno.test("formatReply respeita maxLen sem cortar palavra", () => {
  const out = formatReply("Primeira frase completa. " + "y".repeat(600), { maxLen: 30 });
  assertEquals(out, "Primeira frase completa.");
});

Deno.test("prettifyFaqLayout quebra parede longa em parágrafos", () => {
  const wall =
    "A iGreen funciona com energia compartilhada de fazendas solares. Você continua com a mesma distribuidora e recebe desconto na fatura. Não precisa instalar nada no telhado. Qualquer outra dúvida, é só perguntar.";
  const out = prettifyFaqLayout(wall);
  assertEquals(out.includes("\n\n"), true);
  assertEquals(out.includes("iGreen"), true);
});

Deno.test("formatFaqReply aplica negrito e layout, SEM empurrar cadastro", () => {
  const wall =
    "a igreen oferece desconto real na sua conta de luz sem fidelidade e sem multa. voce nao precisa instalar painel. posso seguir com seu cadastro?";
  const out = formatFaqReply(wall);
  assertEquals(out.includes("*"), true);
  assertEquals(/\n\n/.test(out) || out.length < 160, true);
  // Precisão: FAQ não deve insistir em cadastro
  assertEquals(/cadastro\s*\?/i.test(out), false);
  assertEquals(/posso seguir com seu cadastro/i.test(out), false);
});

Deno.test("stripPushyCadastroCta remove CTAs agressivos no final", () => {
  assertEquals(
    stripPushyCadastroCta("A iGreen dá desconto na fatura.\n\nPosso seguir com seu cadastro?"),
    "A iGreen dá desconto na fatura.",
  );
  assertEquals(
    stripPushyCadastroCta("Tudo sem fidelidade.\nQuer que eu já comece seu cadastro pra garantir essa economia?"),
    "Tudo sem fidelidade.",
  );
  // Corpo sem CTA permanece
  assertEquals(stripPushyCadastroCta("Sem fidelidade e sem multa."), "Sem fidelidade e sem multa.");
});

Deno.test("withSoftFlowClose anexa ponte neutra, nunca cadastro nem botão fantasma", () => {
  const out = withSoftFlowClose("A iGreen aplica desconto direto na fatura.");
  assertEquals(out.includes(SOFT_FLOW_CLOSE), true);
  assertEquals(/cadastro/i.test(out), false);
  assertEquals(/op[cç][oõ]es/i.test(out), false);
  // Já tem pergunta → não duplica
  assertEquals(withSoftFlowClose("Ficou claro?"), "Ficou claro?");
  assertEquals(hasSoftClose("Qualquer outra dúvida, é só perguntar."), true);
});

Deno.test("stripPushyCadastroCta remove CTA fantasma de botão", () => {
  const raw =
    "A primeira fatura chega em até 90 dias.\n\nPosso seguir com o seu cadastro?\n\n👇 Posso seguir com você — é só tocar numa das opções acima.";
  const out = stripPushyCadastroCta(raw);
  assertEquals(/cadastro/i.test(out), false);
  assertEquals(/op[cç][oõ]es acima/i.test(out), false);
  assertEquals(out.includes("90 dias"), true);
});

Deno.test("strip remove variante real: cadastro para já darmos + botão fantasma", () => {
  const raw =
    "Ótima pergunta, Jefferson! A primeira fatura com o seu desconto chega em média em até 90 dias após a aprovação do cadastro. Esse é o prazo para a distribuidora concluir a migração, e a partir daí a economia é automática todo mês. Posso seguir com o seu cadastro para já darmos o primeiro passo? 💚\n\n👇 Posso seguir com você — é só tocar numa das opções acima.";
  const out = stripPushyCadastroCta(raw);
  assertEquals(/posso seguir/i.test(out), false);
  assertEquals(/op[cç][oõ]es acima/i.test(out), false);
  assertEquals(/👇/.test(out), false);
  assertEquals(out.includes("90 dias"), true);
  assertEquals(out.includes("economia"), true);
});

Deno.test("prettifyFaqLayout areja parede mesmo quando já há \\n\\n no soft-close", () => {
  const raw =
    "Claro, Marlene! A iGreen funciona como energia por assinatura: você recebe desconto na conta de luz, sem obra, sem instalação e sem investimento inicial. A energia continua chegando pela mesma distribuidora, só que você passa a ter economia mensal na fatura.\n\nQualquer outra dúvida, é só perguntar.";
  const out = prettifyFaqLayout(raw);
  assertEquals(out.includes("\n\n"), true);
  // O textão inicial deve ter sido quebrado — não pode ser um bloco único gigante
  const firstBlock = out.split(/\n\s*\n/)[0];
  assertEquals(firstBlock.length < 200, true);
});

Deno.test("formatFaqReply caso Jefferson (produção): arejado, negrito, sem CTA", () => {
  const raw =
    "Ótima pergunta, Jefferson! A primeira fatura com o seu desconto chega em média em até 90 dias após a aprovação do cadastro. Esse é o prazo para a distribuidora concluir a migração, e a partir daí a economia é automática todo mês. Posso seguir com o seu cadastro para já darmos o primeiro passo? 💚\n\n👇 Posso seguir com você — é só tocar numa das opções acima.";
  const out = formatFaqReply(raw);
  assertEquals(/\n\n/.test(out), true);
  assertEquals(out.includes("*desconto*") || out.includes("*economia*"), true);
  assertEquals(/posso seguir/i.test(out), false);
  assertEquals(/op[cç][oõ]es acima/i.test(out), false);
});

Deno.test("emphasizeKeyTerms força grafia canônica iGreen", () => {
  const out = emphasizeKeyTerms("a igreen oferece desconto");
  assertEquals(out.includes("*iGreen*"), true);
});

Deno.test("prettifyFaqLayout preserva template já arejado com emojis", () => {
  const nice =
    "A iGreen aplica um desconto direto na sua conta de luz usando energia limpa de fazendas solares.\n\n🔌 Você continua recebendo da mesma distribuidora — nada muda no seu medidor.\n\n💸 A economia varia de 8% a 20% todo mês, sem fidelidade.\n\n✅ Zero custo pra entrar: a gente só ganha quando você economiza.";
  const out = prettifyFaqLayout(nice);
  assertEquals(out.includes("🔌"), true);
  assertEquals(out.includes("💸"), true);
  assertEquals(out.split(/\n\s*\n/).length >= 4, true);
});
