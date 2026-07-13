import { describe, it, expect } from "vitest";

// Espelho leve do helper Deno (sem importar Deno) para validar a regra de negócio.
function avaliarCrossSell(input: {
  crossSellBotEnabled: boolean;
  hasEnergia: boolean;
  hasTelecom: boolean;
  hasSeguros: boolean;
  alreadySuggested?: boolean;
}) {
  if (!input.crossSellBotEnabled || input.alreadySuggested || !input.hasEnergia) {
    return { suggest: false, gaps: [] as string[] };
  }
  const gaps: string[] = [];
  if (!input.hasTelecom) gaps.push("telecom");
  if (!input.hasSeguros) gaps.push("seguros");
  return { suggest: gaps.length > 0, gaps };
}

describe("cross-sell rule", () => {
  it("sugere telecom+seguros para cliente só energia", () => {
    const r = avaliarCrossSell({
      crossSellBotEnabled: true,
      hasEnergia: true,
      hasTelecom: false,
      hasSeguros: false,
    });
    expect(r.suggest).toBe(true);
    expect(r.gaps).toEqual(["telecom", "seguros"]);
  });

  it("não sugere se flag off", () => {
    expect(
      avaliarCrossSell({
        crossSellBotEnabled: false,
        hasEnergia: true,
        hasTelecom: false,
        hasSeguros: false,
      }).suggest,
    ).toBe(false);
  });
});
