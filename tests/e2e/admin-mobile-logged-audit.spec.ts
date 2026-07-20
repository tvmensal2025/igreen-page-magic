import { test, expect, devices } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), "tests/e2e/output/admin-mobile-logged");
const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";

const ADMIN_TABS = [
  { id: "dashboard", label: "Painel" },
  { id: "crm", label: "Clientes interessados" },
  { id: "crm-clientes", label: "Clientes ativos (PV)" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "produtos", label: "Produtos & Vendas" },
  { id: "captacao", label: "Captação" },
  { id: "conversao", label: "Conversão" },
  { id: "clientes", label: "Base de clientes" },
  { id: "parceiros", label: "Parceiros" },
  { id: "central-anuncios", label: "Central de anúncios" },
  { id: "links", label: "Links" },
  { id: "materiais", label: "Materiais" },
  { id: "audio-studio", label: "Estúdio de áudio" },
  { id: "academy", label: "Academy" },
] as const;

type AuditMetrics = {
  horizontalOverflow: boolean;
  scrollW: number;
  viewportW: number;
  viewportH: number;
  composerFound: boolean;
  composerWidth: number | null;
  composerBottom: number | null;
  composerClipped: boolean;
  textareaWidth: number | null;
  smallTouchBottomZone: number;
  fixedBottomElements: number;
  overflowElements: { tag: string; cls: string; right: number }[];
  notes: string[];
};

async function measurePage(page: import("@playwright/test").Page): Promise<AuditMetrics> {
  return page.evaluate(() => {
    const notes: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollW = document.documentElement.scrollWidth;
    const horizontalOverflow = scrollW > vw + 2;
    if (horizontalOverflow) notes.push(`overflow ${scrollW}px > ${vw}px`);

    const overflowElements: { tag: string; cls: string; right: number }[] = [];
    const main = document.querySelector("main") ?? document.body;
    main.querySelectorAll("*").forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 40 || r.height < 16) return;
      if (r.right > vw + 4) {
        overflowElements.push({
          tag: el.tagName,
          cls: String((el as HTMLElement).className || "").slice(0, 60),
          right: Math.round(r.right),
        });
      }
    });

    const shell = document.querySelector(".wa-message-composer-shell");
    const textarea = document.querySelector(".wa-message-composer-shell textarea") as HTMLElement | null;
    const target = textarea ?? shell;
    const rect = target?.getBoundingClientRect() ?? null;
    const composerFound = !!shell;
    const composerWidth = rect ? Math.round(rect.width) : null;
    const composerBottom = rect ? Math.round(rect.bottom) : null;
    const textareaWidth = textarea ? Math.round(textarea.getBoundingClientRect().width) : null;
    const composerClipped = !!(rect && (rect.bottom > vh + 2 || rect.width < 100));
    if (composerFound && composerClipped) notes.push(`composer apertado/cortado w=${composerWidth} bottom=${composerBottom} vh=${vh}`);
    if (textareaWidth !== null && textareaWidth < 180) notes.push(`textarea estreito: ${textareaWidth}px`);

    let smallTouchBottomZone = 0;
    document.querySelectorAll("button, [role='button']").forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.top > vh * 0.72 && r.width > 0 && (r.width < 40 || r.height < 40)) smallTouchBottomZone++;
    });

    const fixedBottomElements = [...document.querySelectorAll("*")].filter((el) => {
      const s = getComputedStyle(el as Element);
      if (s.position !== "fixed") return false;
      const b = parseFloat(s.bottom);
      return !Number.isNaN(b) && b < 120 && (el as HTMLElement).offsetHeight > 0;
    }).length;

    if (smallTouchBottomZone > 3) notes.push(`${smallTouchBottomZone} botões pequenos na zona inferior`);

    return {
      horizontalOverflow,
      scrollW,
      viewportW: vw,
      viewportH: vh,
      composerFound,
      composerWidth,
      composerBottom,
      composerClipped,
      textareaWidth,
      smallTouchBottomZone,
      fixedBottomElements,
      overflowElements: overflowElements.slice(0, 8),
      notes,
    };
  });
}

async function gotoAdminTab(page: import("@playwright/test").Page, tabId: string) {
  await page.evaluate((id) => {
    localStorage.setItem("igreen_admin_active_tab_v1", id);
  }, tabId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
}

async function login(page: import("@playwright/test").Page) {
  if (!EMAIL || !PASSWORD) throw new Error("Defina E2E_EMAIL e E2E_PASSWORD");
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /entrar|login|acessar/i }).click();
  await page.waitForURL(/\/(admin|$)/, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  if (!page.url().includes("/admin")) {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
  }
  const body = await page.locator("body").innerText();
  if (/aguardando aprovação/i.test(body)) throw new Error("Conta não aprovada");
}

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: devices["iPhone 13"].userAgent,
  isMobile: true,
  hasTouch: true,
});

test.describe("Admin logado — auditoria mobile completa", () => {
  test.setTimeout(600_000);

  test("todas as abas + fluxos críticos", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    const rows: Array<{ tab: string; label: string; metrics: AuditMetrics; screenshot: string }> = [];

    await login(page);
    await page.screenshot({ path: join(OUT, "00-login-ok.png"), fullPage: false, timeout: 15_000 });

    for (const tab of ADMIN_TABS) {
      await gotoAdminTab(page, tab.id);
      const metrics = await measurePage(page);
      const shot = `${tab.id}.png`;
      await page.screenshot({ path: join(OUT, shot), fullPage: false, timeout: 15_000 }).catch(() => {});
      rows.push({ tab: tab.id, label: tab.label, metrics, screenshot: shot });
    }

    // WhatsApp: abrir conversa
    await gotoAdminTab(page, "whatsapp");
    const chatsBtn = page.getByRole("button", { name: /chats|conversas/i }).first();
    if (await chatsBtn.isVisible().catch(() => false)) {
      await chatsBtn.click();
      await page.waitForTimeout(2000);
      const firstChat = page.locator("[data-chat-item], .cursor-pointer").first();
      if (await firstChat.isVisible().catch(() => false)) {
        await firstChat.click();
        await page.waitForTimeout(2000);
        const waMetrics = await measurePage(page);
        await page.screenshot({ path: join(OUT, "whatsapp-chat-open.png"), fullPage: false, timeout: 15_000 }).catch(() => {});
        rows.push({
          tab: "whatsapp-chat",
          label: "WhatsApp — conversa aberta",
          metrics: waMetrics,
          screenshot: "whatsapp-chat-open.png",
        });
      }
    }

    // Captação: selecionar lead
    await gotoAdminTab(page, "captacao");
    const lead = page.locator("button, [role='button']").filter({ hasText: /@|\d{10,}/ }).first();
    if (await lead.isVisible().catch(() => false)) {
      await lead.click();
      await page.waitForTimeout(2000);
      const capMetrics = await measurePage(page);
      await page.screenshot({ path: join(OUT, "captacao-lead-open.png"), fullPage: false, timeout: 15_000 }).catch(() => {});
      rows.push({
        tab: "captacao-lead",
        label: "Captação — lead selecionado",
        metrics: capMetrics,
        screenshot: "captacao-lead-open.png",
      });
    }

    // Produtos: sub-abas
    await gotoAdminTab(page, "produtos");
    for (const sub of ["Orçam.", "Pipe.", "Cat."]) {
      const btn = page.getByRole("button", { name: new RegExp(sub, "i") }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(1500);
        const m = await measurePage(page);
        const name = `produtos-${sub.replace(/\./g, "")}.png`;
        await page.screenshot({ path: join(OUT, name), fullPage: false, timeout: 15_000 }).catch(() => {});
        rows.push({ tab: `produtos-${sub}`, label: `Produtos — ${sub}`, metrics: m, screenshot: name });
      }
    }

    const issues = rows.filter(
      (r) =>
        r.metrics.horizontalOverflow ||
        r.metrics.composerClipped ||
        (r.metrics.textareaWidth !== null && r.metrics.textareaWidth < 180) ||
        r.metrics.notes.length > 0,
    );

    const report = [
      "# Admin Mobile Logged Audit",
      "",
      `Data: ${new Date().toISOString()}`,
      `Viewport: 390×844 (iPhone 13)`,
      `Usuário: ${EMAIL.replace(/(.{2}).+(@.+)/, "$1***$2")}`,
      "",
      "## Resumo",
      "",
      `- Abas auditadas: ${rows.length}`,
      `- Com alertas: ${issues.length}`,
      "",
      "## Detalhe por tela",
      "",
      "| Tela | Overflow | Composer | Textarea W | Notas |",
      "|------|----------|----------|------------|-------|",
      ...rows.map((r) => {
        const m = r.metrics;
        return `| ${r.label} | ${m.horizontalOverflow ? "⚠️" : "OK"} | ${m.composerFound ? (m.composerClipped ? "⚠️ cortado" : "OK") : "—"} | ${m.textareaWidth ?? "—"} | ${m.notes.join("; ") || "—"} |`;
      }),
      "",
      "## Screenshots",
      "",
      ...rows.map((r) => `- \`${r.screenshot}\``),
      "",
    ].join("\n");

    writeFileSync(join(OUT, "REPORT.md"), report, "utf8");
    writeFileSync(join(OUT, "report.json"), JSON.stringify(rows, null, 2), "utf8");
    console.log(report);

    const critical = rows.filter(
      (r) => r.metrics.composerClipped || (r.metrics.textareaWidth !== null && r.metrics.textareaWidth < 150),
    );
    expect(
      critical.map((r) => r.label).join(", ") || "none",
      `composer crítico em: ${critical.map((r) => r.label).join(", ")}`,
    ).toBe("none");
  });
});
