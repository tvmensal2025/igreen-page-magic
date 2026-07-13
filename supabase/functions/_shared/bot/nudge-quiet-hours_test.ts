// Testes do quiet hours do nudge FAQ + paridade com o helper global.
// A janela é a mesma (21:30–08:00 BRT); os dois helpers não podem divergir.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isQuietHoursBRT } from "./nudge-quiet-hours.ts";
import { isQuietHourBRT } from "../quiet-hours.ts";

// Horários em UTC (BRT = UTC-3): [iso, esperadoQuiet]
const CASES: Array<[string, boolean]> = [
  ["2026-07-10T13:00:00Z", false], // 10:00 BRT — dia
  ["2026-07-10T23:00:00Z", false], // 20:00 BRT — noite permitida
  ["2026-07-11T00:29:00Z", false], // 21:29 BRT — 1min antes da janela
  ["2026-07-11T00:30:00Z", true],  // 21:30 BRT — início da janela
  ["2026-07-11T03:00:00Z", true],  // 00:00 BRT — madrugada
  ["2026-07-11T10:59:00Z", true],  // 07:59 BRT — ainda quiet
  ["2026-07-11T11:00:00Z", false], // 08:00 BRT — fim da janela
];

Deno.test("nudge quiet hours cobre a janela 21:30–08:00 BRT", () => {
  for (const [iso, expected] of CASES) {
    assertEquals(isQuietHoursBRT(new Date(iso)), expected, `nudge ${iso}`);
  }
});

Deno.test("paridade: nudge-quiet-hours == quiet-hours global", () => {
  for (const [iso] of CASES) {
    const at = new Date(iso);
    assertEquals(
      isQuietHoursBRT(at),
      isQuietHourBRT(at),
      `helpers divergem em ${iso}`,
    );
  }
});
