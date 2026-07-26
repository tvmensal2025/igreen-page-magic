/**
 * Espelho Deno dos testes de src/lib/posVendaSendWindow.test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isPosVendaSendWindow,
  nextPosVendaSendSlot,
} from "./pos-venda-send-window.ts";

Deno.test("pos-venda send window: seg 10h aberto", () => {
  const now = new Date("2026-07-27T13:00:00.000Z");
  assertEquals(isPosVendaSendWindow(now), true);
});

Deno.test("pos-venda send window: domingo 20:30 → segunda", () => {
  const now = new Date("2026-07-26T23:30:00.000Z");
  assertEquals(isPosVendaSendWindow(now), false);
  const slot = nextPosVendaSendSlot(now);
  assertEquals(isPosVendaSendWindow(slot), true);
  const wd = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(slot);
  assertEquals(wd, "Mon");
});
