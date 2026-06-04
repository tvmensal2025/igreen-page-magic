import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectPostponeIntent, buildPostponeReply } from "./postpone-intent.ts";

Deno.test("detecta 'amanhã eu te mando'", () => {
  const r = detectPostponeIntent("Então amanhã eu te mando, porque hoje com as luzes não tem como");
  assert(r);
  assertEquals(r!.when, "amanhã");
});

Deno.test("detecta 'amanhã logo cedo'", () => {
  const r = detectPostponeIntent("Amanhã logo cedo eu mando, tá bom?");
  assert(r);
  assertEquals(r!.when, "amanhã cedo");
});

Deno.test("detecta 'mais tarde te envio'", () => {
  const r = detectPostponeIntent("Mais tarde te envio a foto");
  assert(r);
  assertEquals(r!.when, "mais tarde");
});

Deno.test("detecta 'depois eu mando'", () => {
  const r = detectPostponeIntent("Depois eu te mando");
  assert(r);
});

Deno.test("detecta 'tô sem luz aqui'", () => {
  const r = detectPostponeIntent("Tô sem luz aqui em casa");
  assert(r);
});

Deno.test("detecta 'tô na rua'", () => {
  const r = detectPostponeIntent("Não consigo agora, tô na rua");
  assert(r);
});

Deno.test("detecta 'não estou com a conta'", () => {
  const r = detectPostponeIntent("Não estou com a conta aqui, está em casa");
  assert(r);
});

Deno.test("detecta 'hoje à noite'", () => {
  const r = detectPostponeIntent("Te mando hoje à noite");
  assert(r);
  assertEquals(r!.when, "hoje à noite");
});

Deno.test("ignora recusa explícita", () => {
  assertEquals(detectPostponeIntent("Não quero, desisto"), null);
  assertEquals(detectPostponeIntent("Não tenho interesse, me tira da lista"), null);
});

Deno.test("ignora mensagem neutra", () => {
  assertEquals(detectPostponeIntent("Oi, tudo bem?"), null);
  assertEquals(detectPostponeIntent("Quanto economiza?"), null);
});

Deno.test("buildPostponeReply usa primeiro nome", () => {
  const m = buildPostponeReply({ firstName: "Verinha", when: "amanhã cedo" });
  assert(m.includes("Verinha"));
  assert(m.includes("amanhã cedo"));
  assert(m.includes("conta de luz"));
});

Deno.test("buildPostponeReply para documento", () => {
  const m = buildPostponeReply({ firstName: "João", when: "mais tarde", waitingDoc: true });
  assert(m.includes("o documento"));
});
