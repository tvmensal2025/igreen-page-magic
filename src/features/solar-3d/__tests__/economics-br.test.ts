import { describe, it, expect } from "vitest";
import {
  DEFAULT_TARIFF_KWH_BRL,
  monthlyKwhFromBill,
  pickPresets,
  estimateMonthlySavingsCents,
  tariffForUF,
  tariffForDistribuidora,
  fioBFractionForYear,
  estimateMonthlySavings,
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

  it("tarifa regional por UF tem fallback na média BR", () => {
    expect(tariffForUF("SP")).toBeGreaterThan(0);
    expect(tariffForUF("XX")).toBe(DEFAULT_TARIFF_KWH_BRL);
    expect(tariffForUF(null)).toBe(DEFAULT_TARIFF_KWH_BRL);
  });

  it("tarifa por distribuidora: match exato, por grupo e fallback na UF", () => {
    // match exato
    expect(tariffForDistribuidora("CPFL PIRATININGA", "SP")).toBe(0.84);
    // normaliza acento/caixa
    expect(tariffForDistribuidora("cpfl piratininga", "SP")).toBe(0.84);
    // match por grupo (primeira palavra)
    expect(tariffForDistribuidora("CPFL ALGUMA COISA", "SP")).toBe(0.85);
    // desconhecida → cai na tarifa da UF
    expect(tariffForDistribuidora("DISTRIBUIDORA XPTO", "MG")).toBe(tariffForUF("MG"));
    // sem nada → média BR
    expect(tariffForDistribuidora(null, null)).toBe(DEFAULT_TARIFF_KWH_BRL);
  });

  it("Fio B segue o cronograma da Lei 14.300 e satura em 100% a partir de 2029", () => {
    expect(fioBFractionForYear(2025)).toBe(0.45);
    expect(fioBFractionForYear(2026)).toBe(0.60);
    expect(fioBFractionForYear(2029)).toBe(1.0);
    expect(fioBFractionForYear(2035)).toBe(1.0);
  });

  it("economia não ultrapassa o consumo do cliente (excedente não conta na conta)", () => {
    // Gera muito (12000 kWh/ano = 1000/mês) mas consome só 300 kWh/mês.
    const r = estimateMonthlySavings({
      yearlyEnergyKwh: 12000,
      monthlyConsumptionKwh: 300,
      tariff: 0.9,
      year: 2026,
    });
    expect(r.usefulKwh).toBe(300);
    expect(r.monthlyConsumptionKwh).toBe(300);
  });

  it("injeção paga Fio B; economia fica abaixo da tarifa cheia sobre o gerado", () => {
    const tariff = 0.9;
    const r = estimateMonthlySavings({
      yearlyEnergyKwh: 3600, // 300/mês
      monthlyConsumptionKwh: 1000, // consome bem mais, tudo é útil
      tariff,
      year: 2026,
    });
    const tarifaCheia = 300 * tariff * 100;
    expect(r.monthlySavingsCents).toBeLessThan(Math.round(tarifaCheia));
    expect(r.monthlySavingsCents).toBeGreaterThan(0);
  });

  it("estimateMonthlySavingsCents mantém compatibilidade (só valor da conta)", () => {
    const cents = estimateMonthlySavingsCents(6000, 400);
    expect(cents).toBeGreaterThan(0);
  });
});
