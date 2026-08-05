import { describe, expect, it } from "vitest";
import { formatFlyerPhoneDisplay } from "../flyerPhoneDisplay";

/**
 * O rodapé é impresso: número errado no papel não tem rollback. O caso real é o
 * Rafael, com `consultants.phone = 553484314317` (celular gravado sem o nono
 * dígito) enquanto o QR do mesmo flyer aponta para `5534984314317`.
 */
describe("formatFlyerPhoneDisplay", () => {
  it("completa o nono dígito do celular gravado sem ele", () => {
    expect(formatFlyerPhoneDisplay("553484314317")).toBe("+55 (34) 98431-4317");
  });

  it("mantém o número que já vem completo", () => {
    expect(formatFlyerPhoneDisplay("5534984314317")).toBe("+55 (34) 98431-4317");
  });

  it("aceita telefone formatado e sem DDI", () => {
    expect(formatFlyerPhoneDisplay("+55 (34) 98431-4317")).toBe("+55 (34) 98431-4317");
    expect(formatFlyerPhoneDisplay("34984314317")).toBe("+55 (34) 98431-4317");
  });

  it("nunca desloca o DDD (bug do slice dos últimos 11 dígitos)", () => {
    expect(formatFlyerPhoneDisplay("553497081920")).toBe("+55 (34) 99708-1920");
    expect(formatFlyerPhoneDisplay("553497081920")).not.toContain("(53)");
  });

  // Vazio deixa o chamador cair no texto alternativo ("FALE COMIGO"),
  // melhor do que imprimir um número pela metade.
  it("não inventa número quando o valor é vazio ou lixo", () => {
    expect(formatFlyerPhoneDisplay("")).toBe("");
    expect(formatFlyerPhoneDisplay("abc")).toBe("");
  });
});
