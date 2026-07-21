import { describe, expect, it } from "vitest";
import { formatBrazilPhone, normalizeBrazilPhone, phonesMatch } from "./phone";

describe("formatBrazilPhone", () => {
  it("completa o 9º dígito e não troca o DDD", () => {
    // Cadastro antigo sem 9: 55 + 34 + 97081920
    expect(normalizeBrazilPhone("553497081920")).toBe("5534997081920");
    expect(formatBrazilPhone("553497081920")).toBe("+55 (34) 99708-1920");
    // Bug antigo: últimos 11 de 12 dígitos viravam DDD 53
    expect(formatBrazilPhone("553497081920")).not.toContain("(53)");
  });
});

describe("phonesMatch", () => {
  it("casa cadastro sem 9 com destino Velip com 9", () => {
    expect(phonesMatch("553497081920", "5534997081920")).toBe(true);
  });
});
