import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { idempotencyFromCtx } from "./idempotency-from-ctx.ts";
import type { SendContext } from "./types.ts";

const baseCtx: SendContext = {
  customerId: "cust-1",
  consultantId: "cons-1",
  stepId: "step-a",
  idempotencyKey: "key-stable",
  supabase: {} as any,
};

Deno.test("idempotencyFromCtx: retorna opts quando supabase presente", () => {
  const opts = idempotencyFromCtx(baseCtx, "hello");
  assertEquals(opts?.idempotencyKey, "key-stable");
  assertEquals(opts?.payloadHash, "hello");
});

Deno.test("idempotencyFromCtx: undefined quando slot já adquirido pelo dispatcher", () => {
  const opts = idempotencyFromCtx({ ...baseCtx, idempotencySlotAcquired: true }, "hello");
  assertEquals(opts, undefined);
});

Deno.test("idempotencyFromCtx: undefined sem supabase", () => {
  const opts = idempotencyFromCtx({ ...baseCtx, supabase: undefined }, "hello");
  assertEquals(opts, undefined);
});
