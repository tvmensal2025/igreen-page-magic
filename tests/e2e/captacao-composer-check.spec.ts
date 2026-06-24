import { test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test.setTimeout(90_000);

test("composer em captação com lead", async ({ page }) => {
  await page.goto("/auth");
  await page.fill("#email", process.env.E2E_EMAIL!);
  await page.fill("#password", process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => localStorage.setItem("igreen_admin_active_tab_v1", "captacao"));
  await page.goto("/admin");
  await page.waitForTimeout(3000);
  const accept = page.getByRole("button", { name: /aceitar/i });
  if (await accept.isVisible().catch(() => false)) await accept.click();
  const lead = page.locator("button").filter({ hasText: /\d{10,}|@/ }).first();
  if (await lead.isVisible().catch(() => false)) {
    await lead.click();
    await page.waitForTimeout(2500);
  }
  const m = await page.evaluate(() => {
    const ta = document.querySelector(".wa-message-composer-shell textarea") as HTMLElement | null;
    const r = ta?.getBoundingClientRect();
    return { hasTextarea: !!ta, w: r ? Math.round(r.width) : null, bottom: r ? Math.round(r.bottom) : null, vh: innerHeight };
  });
  console.log("CAPTACAO_COMPOSER", JSON.stringify(m));
  await page.screenshot({ path: "tests/e2e/output/admin-mobile-logged/captacao-lead-open.png" });
});
