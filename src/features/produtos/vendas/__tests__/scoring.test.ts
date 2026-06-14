// =============================================================================
// Vendas — Testes do cálculo de pontos kWh-equivalente
// =============================================================================

import { describe, it, expect } from "vitest";
import { computePointsKwh } from "../scoring";
import type { ScoringRule } from "../../catalogo/types";

describe("computePointsKwh", () => {
  it("contracted_kwh: aplica o multiplicador sobre o kWh contratado (Green/Livre)", () => {
    const rule: ScoringRule = { mode: "contracted_kwh", multiplier: 1 };
    expect(computePointsKwh(rule, { kwh: 500 })).toBe(500);
  });

  it("proposal_kwh: aplica multiplicador 4x da proposta (Placas)", () => {
    const rule: ScoringRule = { mode: "proposal_kwh", multiplier: 4, validity_months: 12 };
    expect(computePointsKwh(rule, { kwh: 1000 })).toBe(4000);
  });

  it("proposal_kwh: multiplicador 1x (Solar)", () => {
    const rule: ScoringRule = { mode: "proposal_kwh", multiplier: 1 };
    expect(computePointsKwh(rule, { kwh: 750 })).toBe(750);
  });

  it("fixed_per_unit: 200 kWh por unidade quando há portabilidade (Telecom)", () => {
    const rule: ScoringRule = { mode: "fixed_per_unit", kwh_per_unit: 200, only_portability: true };
    expect(
      computePointsKwh(rule, { units: 1, captureData: { portabilidade: true } }),
    ).toBe(200);
  });

  it("fixed_per_unit: 0 pontos sem portabilidade (Telecom)", () => {
    const rule: ScoringRule = { mode: "fixed_per_unit", kwh_per_unit: 200, only_portability: true };
    expect(
      computePointsKwh(rule, { units: 1, captureData: { portabilidade: false } }),
    ).toBe(0);
  });

  it("fixed_per_unit: multiplica por unidades (vários chips)", () => {
    const rule: ScoringRule = { mode: "fixed_per_unit", kwh_per_unit: 200, only_portability: true };
    expect(
      computePointsKwh(rule, { units: 3, captureData: { portabilidade: true } }),
    ).toBe(600);
  });

  it("none: nunca pontua (Seguros/Club/Expansão)", () => {
    const rule: ScoringRule = { mode: "none" };
    expect(computePointsKwh(rule, { kwh: 9999, units: 9999 })).toBe(0);
  });

  it("trata kWh ausente como 0", () => {
    const rule: ScoringRule = { mode: "contracted_kwh", multiplier: 1 };
    expect(computePointsKwh(rule, {})).toBe(0);
  });
});
