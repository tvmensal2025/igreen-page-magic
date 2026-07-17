import { describe, expect, it } from "vitest";
import {
  estimateSavingsRange,
  parseAverageBillValue,
  requiresTitleTransfer,
} from "./billValueParse";

describe("parseAverageBillValue — formatos aceitos", () => {
  const cases: Array<[string, number]> = [
    ["500", 500],
    ["500.0", 500],
    ["500,0", 500],
    ["500,00", 500],
    ["R$ 500", 500],
    ["500 reais", 500],
    ["uns 500", 500],
    ["cerca de 500", 500],
    ["mais ou menos 400", 400],
    ["aprox 850", 850],
    ["~500", 500],
    ["+-600", 600],
    ["500/mês", 500],
    ["500 por mes", 500],
    ["1.500,00", 1500],
    ["1.500", 1500],
    ["1500", 1500],
    ["500.", 500],
    ["500,", 500],
    ["5O0", 500], // O → 0
  ];

  for (const [raw, expected] of cases) {
    it(`aceita "${raw}" → ${expected}`, () => {
      const r = parseAverageBillValue(raw);
      expect(r.ok, raw).toBe(true);
      if (r.ok) expect(r.value).toBe(expected);
    });
  }

  it("faixa 400-500 usa ponto médio", () => {
    const r = parseAverageBillValue("400-500");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(450);
  });

  it("faixa 400 a 500", () => {
    const r = parseAverageBillValue("uns 400 a 500");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(450);
  });
});

describe("parseAverageBillValue — pede correção", () => {
  it("350,0000", () => {
    const r = parseAverageBillValue("350,0000");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toBe("too_many_decimals");
  });

  it("350.0000", () => {
    const r = parseAverageBillValue("350.0000");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toBe("too_many_decimals");
  });

  it("vazio", () => {
    expect(parseAverageBillValue("").ok).toBe(false);
  });

  it("fora da faixa", () => {
    const r = parseAverageBillValue("10");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toBe("out_of_range");
  });
});

describe("helpers", () => {
  it("estima 8 a 20%", () => {
    const s = estimateSavingsRange(500);
    expect(s.min).toBe(40);
    expect(s.max).toBe(100);
  });

  it("transferência só SP", () => {
    expect(requiresTitleTransfer("SP")).toBe(true);
    expect(requiresTitleTransfer("MG")).toBe(false);
  });
});
