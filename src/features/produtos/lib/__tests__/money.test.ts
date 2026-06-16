// =============================================================================
// Helper de dinheiro — testes unitários
// =============================================================================

import { describe, it, expect } from "vitest";
import { formatBRLFromCents, reaisToCents, centsToReais } from "../money";

// O Intl/pt-BR pode usar espaço não separável (NBSP/U+00A0 ou U+202F) entre
// "R$" e o número. Normalizamos para espaço comum para deixar os testes estáveis.
function normalize(value: string): string {
  return value.replace(/\u00a0|\u202f/g, " ");
}

describe("formatBRLFromCents", () => {
  it("formata centavos como moeda BRL", () => {
    expect(normalize(formatBRLFromCents(5490))).toBe("R$ 54,90");
  });

  it("formata valor zero como R$ 0,00", () => {
    expect(normalize(formatBRLFromCents(0))).toBe("R$ 0,00");
  });

  it("formata valores grandes com separador de milhar", () => {
    // 123456789 centavos = R$ 1.234.567,89
    expect(normalize(formatBRLFromCents(123456789))).toBe("R$ 1.234.567,89");
  });

  it("sempre exibe duas casas decimais, mesmo em valores redondos", () => {
    expect(normalize(formatBRLFromCents(10000))).toBe("R$ 100,00");
  });

  it("formata valores negativos (ex.: estorno/desconto)", () => {
    expect(normalize(formatBRLFromCents(-150))).toBe("-R$ 1,50");
  });
});

describe("reaisToCents", () => {
  it("converte reais inteiros para centavos", () => {
    expect(reaisToCents(54)).toBe(5400);
  });

  it("converte reais com centavos fracionários", () => {
    expect(reaisToCents(54.9)).toBe(5490);
    expect(reaisToCents(54.99)).toBe(5499);
  });

  it("arredonda para o centavo mais próximo", () => {
    // sub-centavo acima de meio arredonda para cima
    expect(reaisToCents(1.236)).toBe(124); // 123.6 → 124
    // sub-centavo abaixo de meio arredonda para baixo
    expect(reaisToCents(1.234)).toBe(123); // 123.4 → 123
  });

  it("absorve ruído de ponto flutuante ao arredondar", () => {
    // 0.1 + 0.2 = 0.30000000000000004 em float; arredonda para 30 centavos
    expect(reaisToCents(0.1 + 0.2)).toBe(30);
  });

  it("converte zero", () => {
    expect(reaisToCents(0)).toBe(0);
  });

  it("converte valores grandes", () => {
    expect(reaisToCents(1234567.89)).toBe(123456789);
  });
});

describe("centsToReais", () => {
  it("converte centavos para reais", () => {
    expect(centsToReais(5490)).toBe(54.9);
  });

  it("converte zero", () => {
    expect(centsToReais(0)).toBe(0);
  });

  it("converte valores grandes", () => {
    expect(centsToReais(123456789)).toBe(1234567.89);
  });

  it("preserva centavos fracionários", () => {
    expect(centsToReais(1)).toBe(0.01);
  });
});

describe("ida e volta (reaisToCents ↔ centsToReais)", () => {
  it("mantém o valor para montantes com até dois decimais", () => {
    for (const reais of [0, 1, 54.9, 54.99, 1000.5, 1234567.89]) {
      expect(centsToReais(reaisToCents(reais))).toBe(reais);
    }
  });
});
