import { test, devices } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  isMobile: true,
  hasTouch: true,
});

test.setTimeout(90_000);

test("composer em conversa WhatsApp", async ({ page }) => {
  const email = process.env.E2E_EMAIL!;
  const password = process.env.E2E_PASSWORD!;
  await page.goto("/auth");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => localStorage.setItem("igreen_admin_active_tab_v1", "whatsapp"));
  await page.goto("/admin");
  await page.waitForTimeout(3000);
  const accept = page.getByRole("button", { name: /aceitar/i });
  if (await accept.isVisible().catch(() => false)) await accept.click();
  await page.getByRole("button", { name: /conversas/i }).click();
  await page.waitForTimeout(4000);
  const chatBtn = page.locator("button").filter({ has: page.locator(".sensitive-name, .font-medium") }).nth(2);
  const listBtn = page.locator('[class*="sensitive-name"]').first().locator("xpath=ancestor::button[1]");
  if (await listBtn.isVisible().catch(() => false)) {
    await listBtn.click();
  } else {
    const any = page.locator("button.w-full.flex.items-center.gap-2").first();
    if (await any.isVisible()) await any.click();
  }
  await page.waitForTimeout(3000);
  const metrics = await page.evaluate(() => {
    const ta = document.querySelector(".wa-message-composer-shell textarea") as HTMLElement | null;
    const r = ta?.getBoundingClientRect();
    const shell = document.querySelector(".wa-message-composer-shell")?.getBoundingClientRect();
    return {
      hasTextarea: !!ta,
      textareaWidth: r ? Math.round(r.width) : null,
      textareaBottom: r ? Math.round(r.bottom) : null,
      shellWidth: shell ? Math.round(shell.width) : null,
      vh: window.innerHeight,
      clipped: r ? r.bottom > window.innerHeight + 2 : null,
      placeholder: ta?.getAttribute("placeholder"),
    };
  });
  console.log("COMPOSER_METRICS", JSON.stringify(metrics));
  await page.screenshot({ path: "tests/e2e/output/admin-mobile-logged/whatsapp-chat-open.png", fullPage: false });
  if (metrics.textareaWidth !== null) {
    test.expect(metrics.textareaWidth).toBeGreaterThan(200);
    test.expect(metrics.clipped).toBe(false);
  }
});
