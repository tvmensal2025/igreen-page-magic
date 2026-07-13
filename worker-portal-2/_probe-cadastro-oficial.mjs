/**
 * Análise AO VIVO da página oficial de cadastro (sem clicar Cadastrar).
 * Proxy Evomi + captura de network + inspeção do fluxo da SPA.
 */
import { chromium } from 'playwright-chromium';
import fs from 'node:fs';

const PROXY = {
  server: 'http://core-residential.evomi.com:1000',
  username: 'rafaelferr0',
  // sticky session ≤15 chars no final da senha
  password: '6knxVZtVUQyU7BihQ7RT_session-cad01',
};
const API_KEY = '1ec592d9-fdce-4d6f-8b96-9fd6fc4a2051';
const ID_CONSULTOR = 124170;
const LANDING = `https://green.igreenenergy.com.br/autoconexao/?id=${ID_CONSULTOR}`;
const OUT = '/tmp/cadastro-oficial-analysis.json';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const network = [];
const consoleLogs = [];

function pushNet(entry) {
  network.push({ ...entry, t: new Date().toISOString() });
  if (network.length % 10 === 0) console.log(`  … ${network.length} requests`);
}

const browser = await chromium.launch({
  headless: true,
  proxy: PROXY,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
});

const context = await browser.newContext({
  userAgent: UA,
  locale: 'pt-BR',
  viewport: { width: 1365, height: 900 },
  extraHTTPHeaders: {
    // Tentativa: se a API key for header genérico
    // 'x-api-key': API_KEY,
  },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const page = await context.newPage();
page.on('console', (msg) => consoleLogs.push({ type: msg.type(), text: msg.text() }));
page.on('request', (req) => {
  const url = req.url();
  if (!/igreen|cloudflare|api-green|green\.|digital\./i.test(url)) return;
  pushNet({
    kind: 'req',
    method: req.method(),
    url,
    resourceType: req.resourceType(),
    headers: (() => {
      const h = req.headers();
      const keep = {};
      for (const k of Object.keys(h)) {
        if (/^(x-|authorization|content-type|origin|referer|cookie)/i.test(k)) keep[k] = h[k]?.slice?.(0, 200) ?? h[k];
      }
      return keep;
    })(),
    postData: req.postData()?.slice?.(0, 500) || null,
  });
});
page.on('response', async (res) => {
  const url = res.url();
  if (!/igreen|api-green|green\.|digital\./i.test(url)) return;
  let bodyPreview = null;
  const ct = res.headers()['content-type'] || '';
  try {
    if (/json|text|javascript/i.test(ct) && res.status() < 500) {
      const t = await res.text();
      bodyPreview = t.slice(0, 1500);
    }
  } catch {}
  pushNet({
    kind: 'res',
    status: res.status(),
    url,
    ct,
    bodyPreview,
  });
});

console.log('→ Navegando', LANDING);
console.log('→ Proxy', PROXY.server);
let navError = null;
try {
  await page.goto(LANDING, { waitUntil: 'domcontentloaded', timeout: 90000 });
} catch (e) {
  navError = String(e.message || e);
  console.error('goto error:', navError);
}

await page.waitForTimeout(8000);

const title = await page.title().catch(() => null);
const url = page.url();
const htmlSnippet = (await page.content().catch(() => '')).slice(0, 3000);

// Screenshot
await page.screenshot({ path: '/tmp/cadastro-oficial.png', fullPage: true }).catch(() => {});

// Texto visível
const visibleText = await page.evaluate(() => {
  const t = document.body?.innerText || '';
  return t.slice(0, 4000);
}).catch(() => null);

// Procura botões / steps
const ui = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button, a, [role=button]')]
    .map((el) => ({
      tag: el.tagName,
      text: (el.innerText || el.textContent || '').trim().slice(0, 120),
      href: el.getAttribute?.('href'),
      type: el.getAttribute?.('type'),
      disabled: !!el.disabled,
    }))
    .filter((b) => b.text)
    .slice(0, 80);
  const inputs = [...document.querySelectorAll('input, select, textarea')]
    .map((el) => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      id: el.id,
      placeholder: el.getAttribute('placeholder'),
      required: el.required,
    }))
    .slice(0, 80);
  const steps = [...document.querySelectorAll('[class*="step"], [class*="Step"], [data-step], nav li, .MuiStepLabel-label')]
    .map((el) => (el.innerText || '').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 40);
  return { buttons, inputs, steps, path: location.href };
}).catch((e) => ({ error: String(e) }));

// Tenta achar JS bundle e padrões de validação
const scripts = await page.evaluate(() =>
  [...document.querySelectorAll('script[src]')].map((s) => s.src).filter((u) => /assets|index/i.test(u))
).catch(() => []);

console.log('title:', title);
console.log('url:', url);
console.log('buttons:', ui?.buttons?.length);
console.log('network entries:', network.length);

const result = {
  landing: LANDING,
  title,
  url,
  navError,
  visibleText,
  ui,
  scripts,
  apiKeyUsed: API_KEY,
  networkSummary: network
    .filter((n) => n.kind === 'res' || (n.kind === 'req' && /api-green|api-vo|autoconexao/i.test(n.url)))
    .slice(0, 200),
  networkAllCount: network.length,
  consoleLogs: consoleLogs.slice(0, 50),
  htmlSnippet,
};

fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log('saved', OUT);

await browser.close();
