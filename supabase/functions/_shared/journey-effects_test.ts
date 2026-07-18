/**
 * Testes unit — chaves lógicas canônicas e semântica fail-closed
 * do helper de jornada (PLANO §7: nunca usar Date.now()/conteúdo variável).
 *
 * Rodar: deno test --allow-env supabase/functions/_shared/journey-effects_test.ts
 */
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  businessShiftBRT,
  cadenceEffectKey,
  makeCallKey,
  metaAudienceKey,
  reserveOutboundEffect,
  voiceFallbackSmsKey,
} from "./journey-effects.ts";

Deno.test("cadenceEffectKey é estável e sem timestamp", () => {
  const k1 = cadenceEffectKey("j1", "COLD_1", 3, "whatsapp");
  const k2 = cadenceEffectKey("j1", "COLD_1", 3, "whatsapp");
  assertEquals(k1, k2);
  assertEquals(k1, "journey:j1:COLD_1:3:whatsapp");
  // sequência diferente → chave diferente (ciclo anual do Grupo C)
  assertEquals(cadenceEffectKey("j1", "COLD_1", 4, "whatsapp") === k1, false);
});

Deno.test("voiceFallbackSmsKey: um por target/tentativa terminal", () => {
  assertEquals(voiceFallbackSmsKey("t1", 3), "voice_fallback_sms:t1:3");
  // callback repetido com a mesma tentativa produz a MESMA chave (dedup)
  assertEquals(voiceFallbackSmsKey("t1", 3), voiceFallbackSmsKey("t1", 3));
});

Deno.test("metaAudienceKey inclui versão de associação", () => {
  assertEquals(metaAudienceKey("c1", "aud9", 2), "meta_audience:c1:aud9:2");
});

Deno.test("businessShiftBRT: determinístico por hora BRT (manhã/tarde)", () => {
  // 10:00 UTC = 07:00 BRT → manha
  assertEquals(businessShiftBRT(new Date("2026-07-18T10:00:00Z")), "2026-07-18:manha");
  // 18:00 UTC = 15:00 BRT → tarde
  assertEquals(businessShiftBRT(new Date("2026-07-18T18:00:00Z")), "2026-07-18:tarde");
  // 02:00 UTC do dia 19 = 23:00 BRT do dia 18 → tarde do dia 18 (não vira o dia)
  assertEquals(businessShiftBRT(new Date("2026-07-19T02:00:00Z")), "2026-07-18:tarde");
});

Deno.test("makeCallKey usa turno persistível, nunca Date.now()", () => {
  const k = makeCallKey("c1", "step_9", "2026-07-18:manha");
  assertEquals(k, "make_call:c1:step_9:2026-07-18:manha");
  // sem shift explícito, ainda gera formato estável (data:turno)
  assertMatch(makeCallKey("c1", "s"), /^make_call:c1:s:\d{4}-\d{2}-\d{2}:(manha|tarde)$/);
});

Deno.test("reserveOutboundEffect é fail-closed em erro de banco", async () => {
  const fakeDb = {
    rpc: () => Promise.resolve({ data: null, error: { message: "boom", code: "XX000" } }),
  };
  const r = await reserveOutboundEffect(fakeDb, {
    idempotencyKey: "k",
    engineKey: "test",
    channel: "whatsapp",
  });
  assertEquals(r.canSend, false);
  if (!r.canSend) assertEquals(r.status, "error");
});

Deno.test("reserveOutboundEffect não envia quando efeito já está sent", async () => {
  const fakeDb = {
    rpc: () =>
      Promise.resolve({
        data: [{ effect_id: "e1", acquired: false, current_status: "sent" }],
        error: null,
      }),
  };
  const r = await reserveOutboundEffect(fakeDb, {
    idempotencyKey: "k",
    engineKey: "test",
    channel: "sms",
  });
  assertEquals(r.canSend, false);
  if (!r.canSend) assertEquals(r.status, "sent");
});

Deno.test("reserveOutboundEffect envia quando adquire a reserva", async () => {
  const fakeDb = {
    rpc: () =>
      Promise.resolve({
        data: [{ effect_id: "e2", acquired: true, current_status: "reserved" }],
        error: null,
      }),
  };
  const r = await reserveOutboundEffect(fakeDb, {
    idempotencyKey: "k",
    engineKey: "test",
    channel: "voice",
  });
  assertEquals(r.canSend, true);
  if (r.canSend) assertEquals(r.effectId, "e2");
});
