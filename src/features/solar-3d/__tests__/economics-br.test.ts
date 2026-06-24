import { describe, it, expect } from "vitest";
import {
  DEFAULT_TARIFF_KWH_BRL,
  monthlyKwhFromBill,
  pickPresets,
  estimateMonthlySavingsCents,
} from "../../../../supabase/functions/_shared/solar/economics-br.ts";

const configs = [
  { panelsCount: 8, yearlyEnergyDcKwh: 3500 },
  { panelsCount: 12, yearlyEnergyDcKwh: 5200 },
  { panelsCount: 16, yearlyEnergyDcKwh: 7000 },
  { panelsCount: 20, yearlyEnergyDcKwh: 8800 },
  { panelsCount: 24, yearlyEnergyDcKwh: 10500 },
];

describe("economics-br", () => {
  it("converte conta mensal em kWh pela tarifa padrão", () => {
    expect(monthlyKwhFromBill(460)).toBeCloseTo(460 / DEFAULT_TARIFF_KWH_BRL, 2);
  });

  it("pickPresets usa consumo em kWh, não reais direto", () => {
    const bill = 460;
    const monthlyKwh = monthlyKwhFromBill(bill);
    const targetYearly = monthlyKwh * 12 * 0.85;
    const { ideal } = pickPresets(configs, bill);
    expect(ideal).not.toBeNull();
    expect(ideal!.yearlyEnergyDcKwh).toBeGreaterThanOrEqual(targetYearly);
  });

  it("economia mensal respeita teto de 85% da conta e geração", () => {
    const yearly = 8400;
    const bill = 400;
    const fromGen = Math.round((yearly / 12) * DEFAULT_TARIFF_KWH_BRL * 100);
    const cap = Math.round(bill * 0.85 * 100);
    expect(estimateMonthlySavingsCents(yearly, bill)).toBe(Math.min(fromGen, cap));
  });

  it("sem conta usa apenas geração × tarifa", () => {
    const yearly = 6000;
    const expected = Math.round((yearly / 12) * DEFAULT_TARIFF_KWH_BRL * 100);
    expect(estimateMonthlySavingsCents(yearly, null)).toBe(expected);
  });
});
