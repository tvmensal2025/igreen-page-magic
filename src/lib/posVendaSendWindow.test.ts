import { describe, it, expect } from "vitest";
import {
  isPosVendaSendWindow,
  nextPosVendaSendSlot,
  clampToPosVendaSendWindow,
} from "./posVendaSendWindow";

describe("posVendaSendWindow", () => {
  it("seg 10h BRT está aberto", () => {
    // 2026-07-27 = segunda; 13:00 UTC = 10:00 BRT
    const now = new Date("2026-07-27T13:00:00.000Z");
    expect(isPosVendaSendWindow(now)).toBe(true);
    expect(nextPosVendaSendSlot(now).getTime()).toBe(now.getTime());
  });

  it("seg 07h BRT está fechado → agenda 08:05", () => {
    // 10:00 UTC = 07:00 BRT
    const now = new Date("2026-07-27T10:00:00.000Z");
    expect(isPosVendaSendWindow(now)).toBe(false);
    const slot = nextPosVendaSendSlot(now);
    expect(isPosVendaSendWindow(slot)).toBe(true);
  });

  it("seg 20h BRT está fechado → próximo dia útil 08:05", () => {
    // 23:00 UTC = 20:00 BRT segunda
    const now = new Date("2026-07-27T23:00:00.000Z");
    expect(isPosVendaSendWindow(now)).toBe(false);
    const slot = nextPosVendaSendSlot(now);
    expect(isPosVendaSendWindow(slot)).toBe(true);
  });

  it("domingo após 20h → segunda 08:05", () => {
    // 2026-07-26 = domingo; 23:30 UTC = 20:30 BRT
    const now = new Date("2026-07-26T23:30:00.000Z");
    expect(isPosVendaSendWindow(now)).toBe(false);
    const slot = nextPosVendaSendSlot(now);
    expect(isPosVendaSendWindow(slot)).toBe(true);
    // deve ser segunda
    const wd = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
    }).format(slot);
    expect(wd).toBe("Mon");
  });

  it("clamp empurra overdue de domingo para segunda", () => {
    const sundayNight = new Date("2026-07-26T23:30:00.000Z");
    const clamped = clampToPosVendaSendWindow(sundayNight, sundayNight);
    expect(isPosVendaSendWindow(clamped)).toBe(true);
  });
});
