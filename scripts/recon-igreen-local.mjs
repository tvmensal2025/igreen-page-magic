#!/usr/bin/env node
/**
 * Recon local do portal iGreen usando SEU navegador Chrome logado.
 * Sem Tor, sem sandbox — usa seu IP e sua sessão, não trava por bloqueio.
 *
 * PRÉ-REQUISITOS:
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * COMO USAR:
 *   1) Feche todas as janelas do Chrome.
 *   2) Rode:  INGEST_TOKEN=<seu_token> node scripts/recon-igreen-local.mjs
 *   3) Na 1a vez, faça login manualmente na aba que abrir e aperte ENTER no terminal.
 *   4) A sessão fica salva em .chrome-profile-igreen/ — próximas rodadas nem pedem login.
 *
 * Ele envia cada rota (screenshot + HTML + outline + endpoints) para a edge
 * `recon-igreen-ingest`, que faz upload, análise Gemini vision e persiste.
 */

import { chromium } from "playwright";
import path from "path";
import readline from "readline";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zlzasfhcxcznaprrragl.supabase.co";
const INGEST_TOKEN = process.env.INGEST_TOKEN;
if (!INGEST_TOKEN) {
  console.error("[erro] INGEST_TOKEN não definido. Rode: INGEST_TOKEN=<token> node scripts/recon-igreen-local.mjs");
  process.exit(1);
}
const INGEST_URL = `${SUPABASE_URL}/functions/v1/recon-igreen-ingest`;
const PROFILE_DIR = path.resolve(".chrome-profile-igreen");
const BASE = "https://escritorio.igreenenergy.com.br";

const KNOWN_ROUTES = [
  "/dashboard",
  "/clientes-green", "/clientes-green/faturas", "/clientes-green/injecao",
  "/clientes-green/boletos", "/clientes-green/devolutivas",
  "/clientes-green/devolutivas-resolvidas", "/clientes-green/cashback",
  "/clientes-green/resumo-geral", "/clientes-green/comissoes",
  "/produtos/telecom", "/produtos/telecom/clientes", "/produtos/telecom/linhas",
  "/produtos/telecom/faturas", "/produtos/telecom/comissoes",
  "/produtos/telecom/recargas", "/produtos/telecom/bonus",
  "/produtos/telecom/portabilidade", "/produtos/telecom/licenciados",
  "/produtos/telecom/planos", "/produtos/telecom/resumo-geral",
  "/seguros", "/seguros/apolices", "/seguros/clientes", "/seguros/comissoes",
  "/seguros/sinistros", "/seguros/renovacoes", "/seguros/cashback",
  "/seguros/licenciados", "/seguros/produtos", "/seguros/propostas",
  "/seguros/resumo-geral",
  "/rede-lider", "/rede-lider/membros", "/rede-lider/licenciados",
  "/rede-lider/ranking", "/rede-lider/comissoes", "/rede-lider/bonus",
  "/rede-lider/carreira", "/rede-lider/graduacao",
  "/rotinas", "/rotinas/diaria", "/rotinas/semanal", "/rotinas/mensal",
  "/comissoes", "/comissoes/resumo", "/comissoes/extrato",
  "/financeiro", "/financeiro/boletos", "/financeiro/extrato",
  "/financeiro/carteira", "/financeiro/notas", "/financeiro/saques",
  "/relatorios", "/perfil", "/configuracoes",
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (q) => new Promise((r) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); r(a); });
});

const pathTemplate = (u) => {
  try {
    const url = new URL(u);
    let p = url.pathname;
    p = p.replace(/\/\d{4}-\d{2}(-\d{2})?/g, "/{date}");
    p = p.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/{uuid}");
    p = p.replace(/\/\d{4,}/g, "/{n}");
    return `${url.host}${p}`;
  } catch { return u; }
};

async function postCapture(runId, cap) {
  try {
    const r = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-token": INGEST_TOKEN },
      body: JSON.stringify({ run_id: runId, capture: cap }),
    });
    const t = await r.text();
    if (!r.ok) console.error(`[ingest] ${cap.route} → ${r.status}: ${t.slice(0, 200)}`);
    else console.log(`[ok] ${cap.route} → salvo`);
  } catch (e) {
    console.error(`[ingest err] ${cap.route}: ${e.message}`);
  }
}

async function main() {
  console.log(`[boot] usando perfil: ${PROFILE_DIR}`);
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1400, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await wait(2000);
  if (/\/login/i.test(page.url())) {
    console.log("\n>>> FAÇA LOGIN MANUAL na janela do Chrome que abriu.");
    await ask(">>> Depois de logado no dashboard, tecle ENTER aqui: ");
  }

  const runId = crypto.randomUUID();
  console.log(`\n[run] ${runId}\n`);

  // extrai menu real + junta com rotas conhecidas
  const menu = await page.evaluate(() => Array.from(new Set(
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href") || "")
      .filter((h) => h.startsWith("/") && !h.startsWith("//") && h !== "/" && h !== "/login")
  )));
  const routes = Array.from(new Set([...menu, ...KNOWN_ROUTES]));
  console.log(`[routes] ${routes.length} rotas para visitar\n`);

  for (const route of routes) {
    const endpoints = new Map();
    const listener = async (resp) => {
      try {
        const u = resp.url();
        if (!/igreenenergy\.com\.br/i.test(u)) return;
        if (/\/(auth|login|logout|telemetry|analytics|gtm|hotjar)\b/i.test(u)) return;
        if (/\.(png|jpg|jpeg|gif|svg|css|js|woff2?|ico|map)(\?|$)/i.test(u)) return;
        const rq = resp.request();
        if (rq.resourceType() !== "xhr" && rq.resourceType() !== "fetch") return;
        const key = `${rq.method()} ${pathTemplate(u)}`;
        const cur = endpoints.get(key) || { method: rq.method(), url: pathTemplate(u), hits: 0, status: resp.status(), sample: null };
        cur.hits++;
        if (!cur.sample) {
          try {
            const ct = resp.headers()["content-type"] || "";
            if (/json/i.test(ct)) {
              const txt = await resp.text();
              cur.sample = txt.slice(0, 2000);
            }
          } catch {}
        }
        endpoints.set(key, cur);
      } catch {}
    };
    page.on("response", listener);

    const t0 = Date.now();
    const cap = { route };
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await wait(1500);
      try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch {}

      cap.final = await page.evaluate(() => location.pathname).catch(() => route);

      // clica tabs
      const tabsCount = await page.evaluate(() => document.querySelectorAll('[role="tab"], .nav-tabs a').length);
      for (let i = 0; i < Math.min(tabsCount, 6); i++) {
        try {
          await page.evaluate((idx) => {
            const el = document.querySelectorAll('[role="tab"], .nav-tabs a')[idx];
            if (el) el.click();
          }, i);
          await wait(700);
        } catch {}
      }

      // scroll
      await page.evaluate(async () => {
        for (let i = 0; i < 3; i++) {
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise((r) => setTimeout(r, 500));
        }
        window.scrollTo(0, 0);
      }).catch(() => {});

      // captura
      const png = await page.screenshot({ type: "png", fullPage: false });
      cap.screenshot_b64 = Buffer.from(png).toString("base64");

      cap.dom_outline = await page.evaluate(() => ({
        title: document.title,
        headings: Array.from(document.querySelectorAll("h1, h2, h3")).slice(0, 10).map((x) => (x.textContent || "").trim().slice(0, 120)),
        tabs: Array.from(document.querySelectorAll('[role="tab"], .nav-tabs a')).slice(0, 20).map((x) => (x.textContent || "").trim().slice(0, 60)),
        buttons: Array.from(document.querySelectorAll("button")).slice(0, 30).map((x) => (x.textContent || "").trim().slice(0, 60)).filter(Boolean),
        links: Array.from(document.querySelectorAll("a[href]")).slice(0, 40).map((a) => ({ text: (a.textContent || "").trim().slice(0, 60), href: a.getAttribute("href") })),
        tables: Array.from(document.querySelectorAll("table")).slice(0, 5).map((t) => ({
          headers: Array.from(t.querySelectorAll("thead th, thead td")).map((th) => (th.textContent || "").trim().slice(0, 60)),
          rows: t.querySelectorAll("tbody tr").length,
          first_row: Array.from(t.querySelectorAll("tbody tr:first-child td")).map((td) => (td.textContent || "").trim().slice(0, 80)),
        })),
        inputs: Array.from(document.querySelectorAll("input, select, textarea")).slice(0, 20).map((i) => ({
          name: i.getAttribute("name") || i.getAttribute("id") || null,
          type: i.getAttribute("type") || i.tagName.toLowerCase(),
          placeholder: i.getAttribute("placeholder") || null,
        })),
        body_text_preview: (document.body.innerText || "").slice(0, 3000),
      }));

      const html = await page.content();
      cap.html_snippet = html.slice(0, 40000);
      cap.html_length = html.length;
    } catch (e) {
      cap.error = e.message.slice(0, 200);
    }

    page.off("response", listener);
    cap.endpoints = Array.from(endpoints.values());
    cap.elapsed_ms = Date.now() - t0;
    console.log(`[visited] ${route} (${cap.endpoints.length} endpoints, ${cap.elapsed_ms}ms)`);
    await postCapture(runId, cap);
    await wait(400);
  }

  console.log(`\n[done] run_id=${runId} — veja em admin > IGreenBulkSyncPanel ou no supabase (igreen_recon_routes)`);
  await ctx.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
