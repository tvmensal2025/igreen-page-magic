import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isQuietHoursBRT } from "./nudge-quiet-hours.ts";

/** Converte hora BRT para Date UTC (BRT = UTC-3). */
function brtDate(hour: number, min = 0): Date {
  return new Date(Date.UTC(2026, 5, 13, hour + 3, min, 0));
}

Deno.test("isQuietHoursBRT: madrugada (03:00 BRT) é quiet", () => {
  assertEquals(isQuietHoursBRT(brtDate(3, 0)), true);
});

Deno.test("isQuietHoursBRT: após 21:30 BRT é quiet", () => {
  assertEquals(isQuietHoursBRT(brtDate(22, 0)), true);
  assertEquals(isQuietHoursBRT(brtDate(21, 30)), true);
});

Deno.test("isQuietHoursBRT: horário comercial (14:00 BRT) não é quiet", () => {
  assertEquals(isQuietHoursBRT(brtDate(14, 0)), false);
});

Deno.test("isQuietHoursBRT: 08:00 BRT não é quiet", () => {
  assertEquals(isQuietHoursBRT(brtDate(8, 0)), false);
});

Deno.test("isQuietHoursBRT: 21:29 BRT não é quiet", () => {
  assertEquals(isQuietHoursBRT(brtDate(21, 29)), false);
});
