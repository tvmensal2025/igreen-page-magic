import { describe, it, expect } from "vitest";
import { priorityScore, priorityTier, formatStuck } from "./score";

describe("priorityScore", () => {
  it("lead quente, conta alta, recém-parado e engajado fica no topo", () => {
    const hot = priorityScore({
      temperature: "hot", conversionChance: 95, billValue: 334, hoursStuck: 20, inboundCount: 11,
    });
    const cold = priorityScore({
      temperature: "cold", conversionChance: 30, billValue: null, hoursStuck: 600, inboundCount: 1,
    });
    expect(hot).toBeGreaterThan(cold);
    expect(hot).toBeGreaterThan(70); // cai na faixa "urgente"
  });

  it("um warm com conta alta supera um warm sem conta", () => {
    const comConta = priorityScore({ temperature: "warm", conversionChance: 70, billValue: 337, hoursStuck: 100, inboundCount: 4 });
    const semConta = priorityScore({ temperature: "warm", conversionChance: 40, billValue: null, hoursStuck: 100, inboundCount: 1 });
    expect(comConta).toBeGreaterThan(semConta);
  });

  it("não classificado recebe score baixo mas não zero", () => {
    const s = priorityScore({ temperature: null, conversionChance: null, billValue: null, hoursStuck: null, inboundCount: null });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(45);
  });

  it("urgência decai com o tempo parado", () => {
    const base = { temperature: "hot" as const, conversionChance: 90, billValue: 300, inboundCount: 8 };
    const recente = priorityScore({ ...base, hoursStuck: 10 });
    const antigo = priorityScore({ ...base, hoursStuck: 700 });
    expect(recente).toBeGreaterThan(antigo);
  });
});

describe("priorityTier", () => {
  it("classifica faixas corretamente", () => {
    expect(priorityTier(80)).toBe("urgente");
    expect(priorityTier(50)).toBe("alta");
    expect(priorityTier(30)).toBe("media");
    expect(priorityTier(10)).toBe("baixa");
  });
});

describe("formatStuck", () => {
  it("formata horas e dias", () => {
    expect(formatStuck(null)).toBe("—");
    expect(formatStuck(0.5)).toBe("agora");
    expect(formatStuck(12)).toBe("12h");
    expect(formatStuck(50)).toBe("2d 2h");
  });
});
