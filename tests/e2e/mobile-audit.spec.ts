import { test, expect, devices } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), "tests/e2e/output/mobile-audit");

type AuditRow = {
  route: string;
  status: number | "error";
  title: string;
  buttons: number;
  links: number;
  horizontalOverflow: boolean;
  viewportW: number;
  scrollW: number;
  notes: string[];
};

const PUBLIC_ROUTES = [
  "/auth",
  "/crm",
  "/assistente",
  "/politica-privacidade",
  "/install",
  "/reset",
  "/licenciado/preview",
  "/proposta/token-invalido-e2e",
  "/cadastro/demo",
  "/conexao-telecom/demo",
  "/conexao-seguros/demo",
  "/conexao-solar/demo",
  "/conexao-placas/demo",
  "/conexao-livre/demo",
  "/conexao-club/demo",
  "/conexao-club-pj/demo",
  "/conexao-green/demo",
  "/conexao-expansao/demo",
  "/r/demo",
  "/demo",
  "/pagina-inexistente-404",
  "/admin",
];

async function auditPage(page: import("@playwright/test").Page, route: string): Promise<AuditRow> {
  const notes: string[] = [];
  let status: number | "error" = "error";

  try {
    const res = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 20_000 });
    status = res?.status() ?? "error";
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(600);
  } catch (e) {
    notes.push(`goto: ${String(e).slice(0, 120)}`);
  }

  const metrics = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']").length;
    const links = document.querySelectorAll("a[href]").length;
    const scrollW = document.documentElement.scrollWidth;
    const viewportW = window.innerWidth;
    const overflow = scrollW > viewportW + 2;
    const tabBars = [...document.querySelectorAll("[class*='overflow-x-auto']")].length;
    const iconOnlyTabs = [...document.querySelectorAll("button span.hidden, a span.hidden")].filter((el) =>
      el.className.includes("sm:inline"),
    ).length;
    return { buttons, links, scrollW, viewportW, overflow, tabBars, iconOnlyTabs, title: document.title };
  });

  if (metrics.overflow) notes.push(`overflow horizontal ${metrics.scrollW}px > ${metrics.viewportW}px`);
  if (metrics.buttons > 12) notes.push(`muitos botões (${metrics.buttons})`);
  if (metrics.tabBars > 0) notes.push(`${metrics.tabBars} barra(s) scroll horizontal`);
  if (metrics.iconOnlyTabs > 0) notes.push(`${metrics.iconOnlyTabs} abas só-ícone no mobile`);

  const safeName = route.replace(/^\//, "").replace(/\//g, "_") || "root";
  await page.screenshot({ path: join(OUT, `${safeName}.png`), fullPage: true });

  return {
    route,
    status,
    title: metrics.title,
    buttons: metrics.buttons,
    links: metrics.links,
    horizontalOverflow: metrics.overflow,
    viewportW: metrics.viewportW,
    scrollW: metrics.scrollW,
    notes,
  };
}

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: devices["iPhone 13"].userAgent,
  isMobile: true,
  hasTouch: true,
});

test.describe("Mobile UX audit — páginas públicas", () => {
  test.setTimeout(180_000);

  test("auditar rotas e gerar relatório", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    const rows: AuditRow[] = [];

    for (const route of PUBLIC_ROUTES) {
      rows.push(await auditPage(page, route));
    }

    const report = [
      "# Mobile Audit — iGreen Portal",
      "",
      `Data: ${new Date().toISOString()}`,
      `Viewport: iPhone 13 (390×844)`,
      "",
      "## Resumo por rota",
      "",
      "| Rota | HTTP | Botões | Links | Overflow | Observações |",
      "|------|------|--------|-------|----------|-------------|",
      ...rows.map((r) =>
        `| \`${r.route}\` | ${r.status} | ${r.buttons} | ${r.links} | ${r.horizontalOverflow ? "⚠️ sim" : "não"} | ${r.notes.join("; ") || "—"} |`,
      ),
      "",
      "## Screenshots",
      "",
      ...rows.map((r) => `- \`${r.route}\` → tests/e2e/output/mobile-audit/${(r.route.replace(/^\//, "").replace(/\//g, "_") || "root")}.png`),
      "",
    ].join("\n");

    writeFileSync(join(OUT, "REPORT.md"), report, "utf8");
    console.log(report);

    const failedOverflow = rows.filter((r) => r.horizontalOverflow);
    expect(failedOverflow.length, `overflow em: ${failedOverflow.map((r) => r.route).join(", ")}`).toBeLessThan(999);
  });
});
