import { describe, expect, it } from "vitest";
import { solarDesignToLineItems, suggestProjectAmountCents } from "@/features/solar-3d/adapters/proposalSolarBlock";

describe("solar proposal adapter", () => {
  it("sugere valor de projeto por kWp", () => {
    expect(suggestProjectAmountCents(5.6)).toBe(5.6 * 420_000);
  });

  it("gera line items solar_design", () => {
    const items = solarDesignToLineItems({
      ok: true,
      mock: true,
      analysisId: "a",
      snapshotId: "s",
      imageryQuality: "MEDIUM",
      metrics: {
        panelCapacityWatts: 410,
        panelsCount: 12,
        systemSizeKwp: 4.92,
        yearlyEnergyKwh: 7000,
        estimatedMonthlySavingsCents: 35000,
        maxPanels: 20,
        imageryQuality: "MEDIUM",
      },
      presets: { eco: null, ideal: null },
      roofSegments: [],
      panelPositions: [],
      disclaimer: "",
      salesBlurb: "",
    });
    expect(items.every((i) => i.kind === "solar_design")).toBe(true);
    expect(items[0].value).toContain("kWp");
  });
});
