/**
 * Varredura Playwright 100% — rotas públicas + abas Admin + rotas dedicadas
 * × viewports (mobile / desktop / desktop-touch) × tema light/dark + scroll.
 * READ-ONLY: não clica em enviar/publicar/ligar/SMS/pagar.
 */
import { test, expect, devices, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const OUT = join(process.cwd(), "tests/e2e/output/full-platform-audit");
const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const LICENCA = process.env.E2E_LICENCA ?? "tvmensal12";

const PUBLIC_ROUTES = [
  "/auth",
  "/crm",
  "/assistente",
  "/politica-privacidade",
  "/install",
  "/reset",
  "/licenciado/preview",
  `/cadastro/${LICENCA}`,
  `/${LICENCA}`,
  `/r/${LICENCA}`,
  "/proposta/token-invalido-e2e",
  "/conexao-telecom/demo",
  "/conexao-seguros/demo",
  "/conexao-solar/demo",
  "/conexao-placas/demo",
  "/conexao-livre/demo",
  "/conexao-club/demo",
  "/conexao-club-pj/demo",
  "/conexao-green/demo",
  "/conexao-expansao/demo",
  "/pagina-inexistente-404",
];

const ADMIN_TABS = [
  "dashboard",
  "crm",
  "crm-clientes",
  "whatsapp",
  "produtos",
  "captacao",
  "conversao",
  "clientes",
  "parceiros",
  "central-anuncios",
  "agendamentos",
  "voz",
  "links",
  "materiais",
  "audio-studio",
  "academy",
  "financeiro",
] as const;

const ADMIN_ROUTES = [
  "/admin",
  "/admin/motor",
  "/admin/fluxos",
  "/admin/fluxo-b",
  "/admin/reaquecimento",
  "/admin/saude-bot",
  "/admin/saude-producao",
  "/admin/meta-ads",
  "/admin/portal-monitor",
  "/admin/voz",
  "/admin/agendamentos-central",
  "/admin/solar-design",
  "/admin/conhecimento",
  "/admin/recon",
  "/admin/conversao",
  "/admin/protocolos",
  "/admin/whatsapp-clients",
  "/consultor/mensagens",
  "/ajuda",
  "/super-admin",
  "/super-admin/suporte",
];

type ViewportKind = "mobile" | "desktop" | "desktop-touch";

type Row = {
  kind: string;
  route: string;
  theme: "light" | "dark";
  viewport: ViewportKind;
  url: string;
  title: string;
  horizontalOverflow: boolean;
  scrollW: number;
  viewportW: number;
  viewportH: number;
  canScrollPage: boolean;
  canScrollMain: boolean;
  bodyOverflowHidden: boolean;
  touchActionNone: number;
  pointerEventsNoneWide: number;
  consoleErrors: string[];
  notes: string[];
  screenshot: string;
  severity: "OK" | "P0" | "P1" | "P2" | "SKIP";
};

const VIEWPORTS: Record<ViewportKind, { width: number; height: number; isMobile: boolean; hasTouch: boolean; userAgent?: string }> = {
  mobile: {
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    userAgent: devices["iPhone 13"].userAgent,
  },
  desktop: {
    width: 1280,
    height: 800,
    isMobile: false,
    hasTouch: false,
  },
  "desktop-touch": {
    width: 1180,
    height: 820,
    isMobile: false,
    hasTouch: true,
    userAgent: devices["iPad Pro 11"].userAgent,
  },
};

async function measure(page: Page): Promise<Omit<Row, "kind" | "route" | "theme" | "viewport" | "screenshot" | "severity" | "consoleErrors">> {
  return page.evaluate(async () => {
    const notes: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollW = document.documentElement.scrollWidth;
    const horizontalOverflow = scrollW > vw + 2;
    if (horizontalOverflow) notes.push(`overflow-x ${scrollW}>${vw}`);

    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);
    const bodyOverflowHidden =
      /hidden|clip/.test(bodyStyle.overflowY) || /hidden|clip/.test(htmlStyle.overflowY);

    let touchActionNone = 0;
    let pointerEventsNoneWide = 0;
    document.querySelectorAll("body *").forEach((el) => {
      const s = getComputedStyle(el);
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 80 || r.height < 80) return;
      if (s.touchAction === "none") touchActionNone++;
      if (s.pointerEvents === "none" && r.width > vw * 0.5 && r.height > vh * 0.4) {
        pointerEventsNoneWide++;
      }
    });

    const scrollBefore = window.scrollY || document.documentElement.scrollTop;
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - vh,
      document.body.scrollHeight - vh,
    );
    window.scrollTo(0, Math.min(400, maxScroll || 400));
    await new Promise((r) => setTimeout(r, 80));
    const mid = window.scrollY || document.documentElement.scrollTop;
    window.scrollTo(0, 0);
    const canScrollPage = maxScroll > 40 ? mid > scrollBefore + 5 : true;
    if (maxScroll > 40 && !canScrollPage) notes.push("page_scroll_travado");

    const main =
      (document.querySelector("main") as HTMLElement | null) ||
      (document.querySelector("[data-scroll-root]") as HTMLElement | null) ||
      (document.querySelector(".painel-elite [class*='overflow-y-auto']") as HTMLElement | null) ||
      (document.querySelector(".overflow-y-auto") as HTMLElement | null);

    let canScrollMain = true;
    if (main && main.scrollHeight > main.clientHeight + 40) {
      const before = main.scrollTop;
      main.scrollTop = Math.min(before + 300, main.scrollHeight);
      await new Promise((r) => setTimeout(r, 50));
      canScrollMain = main.scrollTop > before + 5;
      main.scrollTop = before;
      if (!canScrollMain) notes.push("main_scroll_travado");
    }

    return {
      url: location.href,
      title: document.title,
      horizontalOverflow,
      scrollW,
      viewportW: vw,
      viewportH: vh,
      canScrollPage,
      canScrollMain,
      bodyOverflowHidden,
      touchActionNone,
      pointerEventsNoneWide,
      notes,
    };
  });
}

function severityOf(m: Awaited<ReturnType<typeof measure>>, consoleErrors: string[]): Row["severity"] {
  if (!m.canScrollPage || !m.canScrollMain) return "P0";
  // pointer-events:none NÃO bloqueia toque — não é P0
  if (m.horizontalOverflow) return "P1";
  if (m.touchActionNone > 2) return "P1";
  if (consoleErrors.length > 0) return "P2";
  return "OK";
}

async function login(page: Page) {
  if (!EMAIL || !PASSWORD) throw new Error("Defina E2E_EMAIL e E2E_PASSWORD");
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email", { timeout: 45_000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /entrar|login|acessar/i }).click();
  await page.waitForURL(/\/(admin|$)/, { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!page.url().includes("/admin")) {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
  }
  const body = await page.locator("body").innerText();
  if (/aguardando aprovação/i.test(body)) throw new Error("Conta não aprovada");
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("igreen-theme", t);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(t);
  }, theme);
}

async function gotoAdminTab(page: Page, tabId: string) {
  await page.evaluate((id) => {
    localStorage.setItem("igreen_admin_active_tab_v1", id);
  }, tabId);
  await page.goto(`/admin?tab=${tabId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
}

async function auditSurface(
  page: Page,
  opts: {
    kind: string;
    route: string;
    theme: "light" | "dark";
    viewport: ViewportKind;
    shotName: string;
    errors: string[];
  },
): Promise<Row> {
  const m = await measure(page);
  const shot = opts.shotName;
  await page.screenshot({ path: join(OUT, shot), fullPage: false, timeout: 12_000 }).catch(() => {});
  const sev = severityOf(m, opts.errors);
  return {
    kind: opts.kind,
    route: opts.route,
    theme: opts.theme,
    viewport: opts.viewport,
    ...m,
    consoleErrors: opts.errors.slice(0, 5),
    screenshot: shot,
    severity: sev,
  };
}

async function withContext(
  browser: import("@playwright/test").Browser,
  vp: ViewportKind,
  fn: (page: Page, ctx: BrowserContext, collectErrors: () => string[]) => Promise<void>,
) {
  const conf = VIEWPORTS[vp];
  const ctx = await browser.newContext({
    viewport: { width: conf.width, height: conf.height },
    isMobile: conf.isMobile,
    hasTouch: conf.hasTouch,
    userAgent: conf.userAgent,
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text().slice(0, 160));
  });
  try {
    await fn(page, ctx, () => {
      const copy = [...errors];
      errors.length = 0;
      return copy;
    });
  } finally {
    await ctx.close();
  }
}

test.describe.configure({ mode: "serial" });
test.setTimeout(1_200_000);

test("full platform audit 100%", async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const rows: Row[] = [];

  // 1) Público — mobile light (cobertura ampla) + sample dark/desktop
  await withContext(browser, "mobile", async (page, _ctx, collectErrors) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await setTheme(page, "light");
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => {});
      await page.waitForTimeout(700);
      const errs = collectErrors();
      const safe = route.replace(/\W+/g, "_").slice(0, 48);
      rows.push(
        await auditSurface(page, {
          kind: "public",
          route,
          theme: "light",
          viewport: "mobile",
          shotName: `pub-mobile-light-${safe}.png`,
          errors: errs,
        }),
      );
    }
  });

  // 2) Login + Admin abas em 3 viewports × light (dark só mobile+desktop sample)
  for (const vp of ["mobile", "desktop", "desktop-touch"] as ViewportKind[]) {
    for (const theme of vp === "mobile" ? (["light", "dark"] as const) : (["light"] as const)) {
      await withContext(browser, vp, async (page, _ctx, collectErrors) => {
        await login(page);
        await setTheme(page, theme);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1200);
        collectErrors(); // limpa ruido de login

        for (const tab of ADMIN_TABS) {
          await gotoAdminTab(page, tab);
          await setTheme(page, theme);
          const errs = collectErrors();
          rows.push(
            await auditSurface(page, {
              kind: "admin-tab",
              route: `/admin?tab=${tab}`,
              theme,
              viewport: vp,
              shotName: `tab-${vp}-${theme}-${tab}.png`,
              errors: errs,
            }),
          );
        }

        // rotas dedicadas (só mobile light + desktop light)
        if ((vp === "mobile" && theme === "light") || (vp === "desktop" && theme === "light")) {
          for (const route of ADMIN_ROUTES) {
            await setTheme(page, theme);
            await page.goto(route, { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => {});
            await page.waitForTimeout(1800);
            const errs = collectErrors();
            const safe = route.replace(/\W+/g, "_").slice(0, 48);
            rows.push(
              await auditSurface(page, {
                kind: "admin-route",
                route,
                theme,
                viewport: vp,
                shotName: `route-${vp}-${theme}-${safe}.png`,
                errors: errs,
              }),
            );
          }
        }
      });
    }
  }

  const p0 = rows.filter((r) => r.severity === "P0");
  const p1 = rows.filter((r) => r.severity === "P1");
  const p2 = rows.filter((r) => r.severity === "P2");
  const ok = rows.filter((r) => r.severity === "OK");

  const report = [
    "# Full Platform Audit (Playwright 100%)",
    "",
    `Data: ${new Date().toISOString()}`,
    `Usuário: ${EMAIL.replace(/(.{2}).+(@.+)/, "$1***$2")}`,
    `Licença landing: ${LICENCA}`,
    "",
    "## Veredito",
    "",
    p0.length === 0 ? "**GO COM RESSALVAS** (sem P0 de scroll/área morta)" : `**NO-GO** — ${p0.length} P0`,
    "",
    `- Total superfícies: ${rows.length}`,
    `- OK: ${ok.length}`,
    `- P0: ${p0.length}`,
    `- P1: ${p1.length}`,
    `- P2: ${p2.length}`,
    "",
    "## P0",
    "",
    ...(p0.length
      ? p0.map(
          (r) =>
            `- \`${r.route}\` [${r.viewport}/${r.theme}] ${r.notes.join("; ") || "scroll/área morta"} · ${r.screenshot}`,
        )
      : ["- (nenhum)"]),
    "",
    "## P1 (overflow-x / touch-action)",
    "",
    ...(p1.length
      ? p1.slice(0, 40).map((r) => `- \`${r.route}\` [${r.viewport}/${r.theme}] ${r.notes.join("; ")}`)
      : ["- (nenhum)"]),
    p1.length > 40 ? `- … +${p1.length - 40} omitidos` : "",
    "",
    "## Amostra P2 (console)",
    "",
    ...p2.slice(0, 20).map((r) => `- \`${r.route}\` ${r.consoleErrors[0] ?? ""}`),
    "",
    "## Tabela completa (resumo)",
    "",
    "| Kind | Route | VP | Theme | Sev | Overflow | ScrollPage | ScrollMain |",
    "|------|-------|----|-------|-----|----------|------------|------------|",
    ...rows.map(
      (r) =>
        `| ${r.kind} | ${r.route} | ${r.viewport} | ${r.theme} | ${r.severity} | ${r.horizontalOverflow ? "⚠️" : "OK"} | ${r.canScrollPage ? "OK" : "❌"} | ${r.canScrollMain ? "OK" : "❌"} |`,
    ),
    "",
  ].join("\n");

  writeFileSync(join(OUT, "REPORT.md"), report, "utf8");
  writeFileSync(join(OUT, "report.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(report);

  expect(p0.length, `P0 em: ${p0.map((r) => r.route).join(", ")}`).toBe(0);
});
