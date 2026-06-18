import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  maskPhone,
  maskMessageText,
  redactPII,
  summarizeWebhookBody,
} from "./log-redact.ts";

Deno.test("maskPhone preserva DDI+DDD e 2 últimos, esconde o miolo", () => {
  const out = maskPhone("5511987654321");
  assertEquals(out, "5511*******21");
  assert(!out.includes("98765"));
});

Deno.test("maskPhone lida com entradas curtas/invalidas", () => {
  assertEquals(maskPhone("123"), "[tel]");
  assertEquals(maskPhone(null), "[tel]");
  assertEquals(maskPhone(undefined), "[tel]");
});

Deno.test("maskMessageText nunca revela o conteúdo", () => {
  assertEquals(maskMessageText("quero cancelar minha conta"), "[texto: 26 chars]");
  assertEquals(maskMessageText(""), "[vazio]");
  assertEquals(maskMessageText(null), "[vazio]");
});

Deno.test("redactPII remove e-mails e números longos", () => {
  const out = redactPII("contato joao@x.com fone 11987654321 ok");
  assert(out.includes("[email]"));
  assert(out.includes("[num]"));
  assert(!out.includes("joao@x.com"));
  assert(!out.includes("11987654321"));
});

Deno.test("summarizeWebhookBody não vaza texto nem telefone (Whapi)", () => {
  const body = {
    channel_id: "abc",
    messages: [
      { type: "text", from: "5511987654321", from_me: false, text: { body: "meu cpf é 123" } },
    ],
  };
  const summary = summarizeWebhookBody(body);
  const asStr = JSON.stringify(summary);
  assert(!asStr.includes("5511987654321"));
  assert(!asStr.includes("meu cpf"));
  assertEquals((summary as any).messagesCount, 1);
  assertEquals((summary as any).messageTypes, ["text"]);
});

Deno.test("summarizeWebhookBody resume payload Evolution (data{})", () => {
  const body = { event: "messages.upsert", instance: "inst1", data: { messageType: "conversation", key: {} } };
  const summary = summarizeWebhookBody(body) as any;
  assertEquals(summary.messageType, "conversation");
  assert(Array.isArray(summary.dataKeys));
});
