import { describe, it, expect } from "vitest";
import {
  buildScoringLineItem,
  estimateKwhFromBillCents,
  extractScoringInputFromLineItems,
} from "../scoringInput";

describe("scoringInput", () => {
  it("grava e lê scoring_input do line item", () => {
    const item = buildScoringLineItem({
      kwh: 420,
      units: 1,
      portabilidade: true,
      plano: "Mega",
    });
    expect(item.kind).toBe("scoring_input");
    const parsed = extractScoringInputFromLineItems([item]);
    expect(parsed.kwh).toBe(420);
    expect(parsed.units).toBe(1);
    expect(parsed.portabilidade).toBe(true);
  });

  it("estima kWh a partir da conta em centavos", () => {
    // R$ 340,00 / R$ 0,85 = 400 kWh
    expect(estimateKwhFromBillCents(34000)).toBe(400);
  });

  it("fallback solar_design kWh/ano → mensal", () => {
    const parsed = extractScoringInputFromLineItems([
      {
        label: "Sistema",
        value: "5 kWp · 10 módulos · ~6.000 kWh/ano",
        kind: "solar_design",
      },
    ]);
    expect(parsed.kwh).toBe(500);
  });

  it("fallback Portabilidade nos detalhes", () => {
    const parsed = extractScoringInputFromLineItems([
      { label: "Portabilidade", value: "Com portabilidade (+5GB)" },
    ]);
    expect(parsed.portabilidade).toBe(true);
    expect(parsed.units).toBe(1);
  });
});
