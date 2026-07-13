import { test, expect } from "@playwright/test";

/**
 * Smoke E2E do módulo Produtos — página pública de proposta + rotas.
 * Não exige login; valida que a rota responde e trata token inválido.
 */
test.describe("Produtos & Vendas — proposta pública", () => {
  test("token inválido exibe estado de erro amigável", async ({ page }) => {
    await page.goto("/proposta/token-invalido-e2e");
    await expect(page.locator("body")).toContainText(/proposta|orçamento|não encontrad|inválid/i, {
      timeout: 15_000,
    });
  });

  test("rota de proposta responde (status HTTP ok ou soft-fail)", async ({ page }) => {
    const res = await page.goto("/proposta/token-invalido-e2e");
    expect(res).toBeTruthy();
    expect(res!.status()).toBeLessThan(500);
  });
});
