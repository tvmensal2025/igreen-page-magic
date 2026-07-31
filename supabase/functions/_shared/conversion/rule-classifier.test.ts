import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getPhraseByShortcut, renderPhraseText, VALID_SHORTCUTS } from "./phrase-catalog.ts";
import { classifyByRules, detectSignals, type ClassifyMessage } from "./rule-classifier.ts";

Deno.test("renderPhraseText: substitui variáveis", () => {
  const out = renderPhraseText(
    "Oi {{nome}}, conta {{valor_conta}}, {{representante}}",
    { name: "Maria Silva", name_source: "user_confirmed", electricity_bill_value: 350 },
    "João Consultor",
  );
  assertEquals(out.includes("Maria"), true);
  assertEquals(out.includes("João Consultor"), true);
});

Deno.test("getPhraseByShortcut: todos os atalhos existem", () => {
  for (const s of VALID_SHORTCUTS) {
    assertEquals(getPhraseByShortcut(s) != null, true, `missing ${s}`);
  }
});

Deno.test("detectSignals: golpe e ghosted", () => {
  const msgs: ClassifyMessage[] = [
    { message_direction: "outbound", message_text: "Oi!", message_type: "text", created_at: "2026-01-01T10:00:00Z" },
    { message_direction: "inbound", message_text: "Isso é golpe?", message_type: "text", created_at: "2026-01-01T10:05:00Z" },
  ];
  const sig = detectSignals(msgs);
  assertEquals(sig.mentioned_scam_fear, true);
  assertEquals(sig.we_ghosted_them, true);
});

Deno.test("classifyByRules: objeção golpe", () => {
  const r = classifyByRules({
    messages: [{
      message_direction: "inbound",
      message_text: "Acho que isso é golpe",
      message_type: "text",
      created_at: new Date().toISOString(),
    }],
    conversationStep: "welcome",
    hoursStuck: 5,
    billValue: null,
    customerName: "Pedro",
  });
  assertEquals(r.shortcut, "/golpe");
  assertEquals(r.confidence >= 0.85, true);
  assertEquals(r.temperature, "objection");
});

Deno.test("classifyByRules: conta recebida → hot", () => {
  const r = classifyByRules({
    messages: [{
      message_direction: "inbound",
      message_text: "Segue a foto da conta",
      message_type: "image",
      created_at: new Date().toISOString(),
    }],
    conversationStep: "aguardando_conta",
    hoursStuck: 1,
    billValue: 400,
    customerName: "Ana",
  });
  assertEquals(r.shortcut, "/hot_pedir_doc");
  assertEquals(r.temperature, "hot");
});

Deno.test("classifyByRules: follow-up 24h", () => {
  const r = classifyByRules({
    messages: [{
      message_direction: "inbound",
      message_text: "oi",
      message_type: "text",
      created_at: new Date().toISOString(),
    }],
    conversationStep: "welcome",
    hoursStuck: 30,
    billValue: null,
    customerName: "Lu",
  });
  assertEquals(r.shortcut, "/fup24h");
  assertEquals(r.confidence >= 0.85, true);
});

Deno.test("detectSignals: texto mencionando 'conta' NÃO marca sent_bill", () => {
  const msgs: ClassifyMessage[] = [
    { message_direction: "inbound", message_text: "minha conta de luz é muito cara", message_type: "text", created_at: new Date().toISOString() },
  ];
  const sig = detectSignals(msgs);
  assertEquals(sig.sent_bill, false);
});

Deno.test("detectSignals: imagem marca sent_bill", () => {
  const msgs: ClassifyMessage[] = [
    { message_direction: "inbound", message_text: null, message_type: "image", created_at: new Date().toISOString() },
  ];
  const sig = detectSignals(msgs);
  assertEquals(sig.sent_bill, true);
});

Deno.test("classifyByRules: texto 'conta cara' sem mídia não vira hot", () => {
  const r = classifyByRules({
    messages: [{
      message_direction: "inbound",
      message_text: "minha conta de luz tá cara demais",
      message_type: "text",
      created_at: new Date().toISOString(),
    }],
    conversationStep: "welcome",
    hoursStuck: 2,
    billValue: null,
    customerName: "Zé",
  });
  // "cara" dispara objeção de preço, não hot por conta enviada.
  assertEquals(r.shortcut, "/preco");
});

Deno.test("classifyByRules: step flow:UUID resolve pelo conversation_step base", () => {
  const r = classifyByRules({
    messages: [{
      message_direction: "inbound",
      message_text: "ok",
      message_type: "text",
      created_at: new Date().toISOString(),
    }],
    conversationStep: "flow:aguardando_doc",
    hoursStuck: 30,
    billValue: null,
    customerName: "Bia",
  });
  assertEquals(r.shortcut, "/step_aguardando_doc");
  assertEquals(r.confidence >= 0.85, true);
});

Deno.test("classifyByRules: welcome inicial tem confiança alta (sem IA)", () => {
  const r = classifyByRules({
    messages: [{
      message_direction: "inbound",
      message_text: "oi",
      message_type: "text",
      created_at: new Date().toISOString(),
    }],
    conversationStep: null,
    hoursStuck: 0,
    billValue: null,
    customerName: "Tom",
  });
  assertEquals(r.shortcut, "/oi1");
  assertEquals(r.confidence >= 0.85, true);
});
