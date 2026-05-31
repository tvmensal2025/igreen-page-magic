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

Deno.test("classifyDisconnect: 0 / ausente é transitório (default seguro p/ reconexão)", () => {
  assertEquals(classifyDisconnect(0), "transient");
  assertEquals(classifyDisconnect(null), "transient");
  assertEquals(classifyDisconnect(undefined), "transient");
});
