import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decidePingPongBrake,
  PING_PONG_MAX_AUTO_REPLIES,
  pingPongPauseUntil,
} from "./ping-pong-brake.ts";

Deno.test("freia o loop do caso Ethos (15 trocas em 2 min)", () => {
  const v = decidePingPongBrake({ autoRepliesInWindow: 15, inboundInWindow: 15 });
  assertEquals(v.brake, true);
  assertEquals(v.reason, "loop_sem_progresso");
});

Deno.test("conversa normal de lead não é freada", () => {
  // Lead ativo trocando algumas mensagens: bem abaixo do limiar.
  assertEquals(decidePingPongBrake({ autoRepliesInWindow: 5, inboundInWindow: 6 }).brake, false);
  assertEquals(decidePingPongBrake({ autoRepliesInWindow: 1, inboundInWindow: 1 }).brake, false);
});

Deno.test("cadência disparando sozinha não conta como ping-pong", () => {
  // Muitas mensagens nossas, mas o contato não respondeu nada.
  const v = decidePingPongBrake({ autoRepliesInWindow: 20, inboundInWindow: 0 });
  assertEquals(v.brake, false);
});

Deno.test("progresso no funil desarma o freio", () => {
  const v = decidePingPongBrake({
    autoRepliesInWindow: 20,
    inboundInWindow: 20,
    progressed: true,
  });
  assertEquals(v.brake, false);
});

Deno.test("humano no comando ou bot já pausado: freio não age", () => {
  const base = { autoRepliesInWindow: 30, inboundInWindow: 30 };
  assertEquals(decidePingPongBrake({ ...base, humanTookOver: true }).brake, false);
  assertEquals(decidePingPongBrake({ ...base, alreadyPaused: true }).brake, false);
});

Deno.test("limiar é exatamente o configurado", () => {
  const n = PING_PONG_MAX_AUTO_REPLIES;
  assertEquals(decidePingPongBrake({ autoRepliesInWindow: n - 1, inboundInWindow: n }).brake, false);
  assertEquals(decidePingPongBrake({ autoRepliesInWindow: n, inboundInWindow: n }).brake, true);
});

Deno.test("pausa é temporária, não definitiva", () => {
  const agora = new Date("2026-08-05T12:00:00Z");
  const until = new Date(pingPongPauseUntil(agora));
  const horas = (until.getTime() - agora.getTime()) / 3_600_000;
  assertEquals(horas > 0 && horas <= 12, true);
});
