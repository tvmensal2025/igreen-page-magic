// Testes da classificação de motivo de desconexão (anti-ban).
// Garante que motivos fatais (logout/ban/conflito) NÃO disparam reconexão
// automática, evitando agravar o bloqueio do número pelo WhatsApp.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyDisconnect } from "./_helpers.ts";

Deno.test("classifyDisconnect: 401 loggedOut é fatal", () => {
  assertEquals(classifyDisconnect(401), "fatal");
});

Deno.test("classifyDisconnect: 403 forbidden/banned é fatal", () => {
  assertEquals(classifyDisconnect(403), "fatal");
});

Deno.test("classifyDisconnect: 440 connectionReplaced é fatal", () => {
  assertEquals(classifyDisconnect(440), "fatal");
});

Deno.test("classifyDisconnect: 405/409/411 (conflito de credenciais) são fatais", () => {
  assertEquals(classifyDisconnect(405), "fatal");
  assertEquals(classifyDisconnect(409), "fatal");
  assertEquals(classifyDisconnect(411), "fatal");
});

Deno.test("classifyDisconnect: 428 connectionClosed é transitório (reconecta)", () => {
  assertEquals(classifyDisconnect(428), "transient");
});

Deno.test("classifyDisconnect: 408 timedOut é transitório (reconecta)", () => {
  assertEquals(classifyDisconnect(408), "transient");
});

Deno.test("classifyDisconnect: 515 restartRequired é transitório (reconecta)", () => {
  assertEquals(classifyDisconnect(515), "transient");
});

Deno.test("classifyDisconnect: 0 EXPLÍCITO é fatal (possível ban silencioso)", () => {
  // Regra de segurança: código 0 ('fechou e o servidor não disse porquê')
  // costuma ser ban silencioso — reconectar acelera o banimento.
  assertEquals(classifyDisconnect(0), "fatal");
});

Deno.test("classifyDisconnect: ausente (null/undefined) é transitório (glitch de rede)", () => {
  assertEquals(classifyDisconnect(null), "transient");
  assertEquals(classifyDisconnect(undefined), "transient");
});
