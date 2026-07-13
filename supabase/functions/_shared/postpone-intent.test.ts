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

Deno.test("'segunda' agenda para a próxima segunda-feira 09:00 BRT", () => {
  // Sábado 11/07/2026 15:00 BRT (18:00 UTC) → segunda 13/07 09:00 BRT (12:00 UTC)
  const saturday = new Date("2026-07-11T18:00:00Z");
  const r = detectPostponeIntent("Só segunda que consigo mandar", saturday);
  assert(r);
  assertEquals(r!.when, "segunda-feira");
  assertEquals(r!.pauseUntil, "2026-07-13T12:00:00.000Z");
});

Deno.test("'segunda' dita numa segunda vai para a PRÓXIMA segunda", () => {
  // Segunda 13/07/2026 10:00 BRT → segunda 20/07 09:00 BRT
  const monday = new Date("2026-07-13T13:00:00Z");
  const r = detectPostponeIntent("na segunda eu mando", monday);
  assert(r);
  assertEquals(r!.pauseUntil, "2026-07-20T12:00:00.000Z");
});

Deno.test("'hoje à noite' ancora às 19:00 BRT quando dito de manhã", () => {
  // 10:00 BRT (13:00 UTC) → pausa até 19:00 BRT (22:00 UTC)
  const morning = new Date("2026-07-10T13:00:00Z");
  const r = detectPostponeIntent("Te mando hoje à noite", morning);
  assert(r);
  assertEquals(r!.when, "hoje à noite");
  assertEquals(r!.pauseUntil, "2026-07-10T22:00:00.000Z");
});

Deno.test("'hoje à noite' dito às 21h BRT cai para amanhã 09:00", () => {
  // 21:00 BRT (00:00 UTC do dia 11) → amanhã (11/07) 09:00 BRT = 12:00 UTC
  const lateNight = new Date("2026-07-11T00:00:00Z");
  const r = detectPostponeIntent("hoje à noite te envio", lateNight);
  assert(r);
  assertEquals(r!.pauseUntil, "2026-07-11T12:00:00.000Z");
});

Deno.test("'hoje à tarde' ancora às 14:00 BRT quando dito de manhã", () => {
  const morning = new Date("2026-07-10T13:00:00Z"); // 10:00 BRT
  const r = detectPostponeIntent("De tarde eu mando", morning);
  assert(r);
  assertEquals(r!.when, "hoje à tarde");
  assertEquals(r!.pauseUntil, "2026-07-10T17:00:00.000Z"); // 14:00 BRT
});

Deno.test("'amanhã' pausa até amanhã 09:00 BRT determinístico", () => {
  const base = new Date("2026-07-10T13:00:00Z"); // sexta 10:00 BRT
  const r = detectPostponeIntent("Amanhã eu mando", base);
  assert(r);
  assertEquals(r!.pauseUntil, "2026-07-11T12:00:00.000Z"); // sábado 09:00 BRT
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
