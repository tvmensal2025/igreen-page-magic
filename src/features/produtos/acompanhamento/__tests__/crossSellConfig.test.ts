import { describe, it, expect } from "vitest";
import {
  applyCrossSellTemplate,
  applyCrossSellNome,
  parseCrossSellVariables,
  buildCrossSellVariables,
  buildPhoneKeySet,
  hasProductMatch,
  phoneInSet,
  produtoLabelForGaps,
  DEFAULT_CROSS_SELL_PREFS,
} from "../crossSellConfig";

describe("crossSellConfig", () => {
  it("parseia variables objeto com stages/products", () => {
    const p = parseCrossSellVariables({
      stages: ["aprovado", "d30", "invalid"],
      products: ["telecom"],
      placeholders: ["nome"],
    });
    expect(p.stages).toEqual(["aprovado", "d30"]);
    expect(p.products).toEqual(["telecom"]);
  });

  it("fallback quando variables é array legado", () => {
    const p = parseCrossSellVariables(["nome"]);
    expect(p.stages).toEqual(DEFAULT_CROSS_SELL_PREFS.stages);
    expect(p.products).toEqual(DEFAULT_CROSS_SELL_PREFS.products);
  });

  it("buildCrossSellVariables inclui placeholders", () => {
    const v = buildCrossSellVariables({ stages: ["aprovado"], products: ["seguros"] });
    expect(v).toEqual({
      placeholders: ["nome", "produto"],
      stages: ["aprovado"],
      products: ["seguros"],
    });
  });

  it("applyCrossSellTemplate injeta nome/produto e colapsa espaços", () => {
    expect(
      applyCrossSellTemplate("Oi {{nome}}! Temos {{produto}}.", {
        fullName: "Maria Silva",
        produto: "Telecom",
      }),
    ).toBe("Oi Maria! Temos Telecom.");
    expect(applyCrossSellNome("Oi {{nome}}!", null)).toBe("Oi!");
  });

  it("produtoLabelForGaps cobre os 3 casos", () => {
    expect(produtoLabelForGaps({ telecom: true, seguros: true })).toBe("Telecom e Seguro Auto");
    expect(produtoLabelForGaps({ telecom: true, seguros: false })).toBe("Telecom");
    expect(produtoLabelForGaps({ telecom: false, seguros: true })).toBe("Seguro Auto");
  });

  it("match por telefone ignora DDI e aceita fallback de nome", () => {
    const phones = buildPhoneKeySet(["5511999887766"]);
    expect(phoneInSet(phones, "11999887766")).toBe(true);
    expect(
      hasProductMatch({
        leadPhone: "11999887766",
        leadName: "Joao",
        productPhones: phones,
        productNames: new Set(),
      }),
    ).toBe(true);
    expect(
      hasProductMatch({
        leadPhone: "11000000000",
        leadName: "Maria Souza",
        productPhones: new Set(),
        productNames: new Set(["maria souza"]),
      }),
    ).toBe(true);
  });
});
