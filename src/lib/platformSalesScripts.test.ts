import { describe, expect, it } from "vitest";
import {
  composePlatformSalesMessage,
  DEFAULT_PLATFORM_SALES_SCRIPTS,
  resolveNomeBlock,
} from "./platformSalesScripts";

describe("platformSalesScripts", () => {
  it("ordem nome → saudação → corpo (WA com negrito)", () => {
    const text = composePlatformSalesMessage({
      name: "Daniel",
      day: "d0",
      channel: "whatsapp",
      now: new Date("2026-07-27T15:00:00-03:00"),
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("*Daniel*, tudo bem?");
    expect(lines[1]).toBe("☀️ *Muito boa tarde!*");
    expect(text).toContain("*Landing pages*");
    expect(text).toContain("💬");
  });

  it("sem nome remove bloco personalizado", () => {
    expect(resolveNomeBlock(DEFAULT_PLATFORM_SALES_SCRIPTS, "")).toBe("Tudo bem?");
    expect(resolveNomeBlock(DEFAULT_PLATFORM_SALES_SCRIPTS, "Ixi Kkk")).toBe("Tudo bem?");
    const text = composePlatformSalesMessage({
      name: "",
      day: "d0",
      channel: "whatsapp",
      now: new Date("2026-07-27T09:00:00-03:00"),
    });
    expect(text.startsWith("*Tudo bem?*\n☀️ *Muito bom dia!*")).toBe(true);
  });

  it("SMS fica em uma linha (sem markdown WA)", () => {
    const text = composePlatformSalesMessage({
      name: "Ana",
      day: "d0",
      channel: "sms",
      now: new Date("2026-07-27T20:00:00-03:00"),
    });
    expect(text.includes("\n")).toBe(false);
    expect(text).toContain("Ana, tudo bem?");
    expect(text).toContain("Muito boa noite!");
    expect(text).toContain("Teste gratis 7 dias");
    expect(text).toContain("sem deposito inicial");
  });

  it("WA D0 oferece teste grátis de 7 dias", () => {
    const text = composePlatformSalesMessage({
      name: "Caue",
      day: "d0",
      channel: "whatsapp",
      now: new Date("2026-07-27T15:00:00-03:00"),
    });
    expect(text).toContain("teste gratuito de 7 dias");
    expect(text).toContain("sem nenhum depósito inicial");
  });
});
