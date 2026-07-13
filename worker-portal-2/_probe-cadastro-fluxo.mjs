/**
 * Entra no fluxo de cadastro oficial, captura API, NÃO clica Cadastrar.
 */
import { chromium } from 'playwright-chromium';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PASS = `6knxVZtVUQyU7BihQ7RT_country-BR_session-${crypto.randomBytes(4).toString('hex')}_lifetime-60`;
const PROXY = {
  server: 'http://core-residential.evomi.com:1000',
  username: 'rafaelferr0',
  password: PASS,
};
const ID = 124170;
const LANDING = `https://green.igreenenergy.com.br/autoconexao/?id=${ID}`;
const OUT = '/tmp/cadastro-fluxo-analysis.json';

const network = [];
const apiCalls = [];

function interesting(url) {
  return /api-green-connection|igreenenergy|cloudflare|viacep|googleapis|recaptcha/i.test(url);
}

const browser = await chromium.launch({
  headless: true,
  proxy: PROXY,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'pt-BR',
  viewport: { width: 1365, height: 900 },
});
await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await context.newPage();

page.on('request', (req) => {
  const url = req.url();
  if (!interesting(url)) return;
  const entry = {
    kind: 'req',
    method: req.method(),
    url,
    resourceType: req.resourceType(),
    postData: (req.postData() || '').slice(0, 2000) || null,
    headers: {},
  };
  const h = req.headers();
  for (const k of Object.keys(h)) {
    if (/^(x-|authorization|content-type|origin|referer)/i.test(k)) entry.headers[k] = String(h[k]).slice(0, 300);
  }
  network.push(entry);
  if (/api-green-connection/i.test(url)) apiCalls.push({ ...entry, phase: 'req' });
});

page.on('response', async (res) => {
  const url = res.url();
  if (!interesting(url)) return;
  let body = null;
  try {
    const ct = res.headers()['content-type'] || '';
    if (/json|text\/plain/i.test(ct)) body = (await res.text()).slice(0, 4000);
  } catch {}
  const entry = { kind: 'res', status: res.status(), url, bodyPreview: body };
  network.push(entry);
  if (/api-green-connection/i.test(url)) apiCalls.push({ ...entry, phase: 'res' });
});

async function dump(label) {
  const shot = `/tmp/cadastro-${label}.png`;
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const text = (await page.innerText('body').catch(() => '')).slice(0, 2500);
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button, a, [role=button], input[type=submit]')]
      .map((el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 100))
      .filter(Boolean)
      .slice(0, 60)
  ).catch(() => []);
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea')]
      .map((el) => ({
        type: el.getAttribute('type'),
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        label: el.labels?.[0]?.innerText?.slice(0, 80) || null,
        required: !!el.required,
        accept: el.getAttribute('accept'),
      }))
      .slice(0, 60)
  ).catch(() => []);
  console.log(`\n=== ${label} === url=${page.url()}`);
  console.log('buttons:', buttons);
  console.log('inputs:', JSON.stringify(inputs).slice(0, 800));
  console.log('text:', text.slice(0, 400).replace(/\n+/g, ' | '));
  return { label, url: page.url(), text, buttons, inputs, shot };
}

const steps = [];

// IP check
try {
  await page.goto('http://ip-api.com/json', { timeout: 30000 });
  console.log('IP:', await page.innerText('body'));
} catch (e) {
  console.log('IP fail', e.message);
}

console.log('→ landing', LANDING, 'pass=', PASS);
await page.goto(LANDING, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(6000);
steps.push(await dump('01-landing'));

// Clicar "Começar agora" (entra no cadastro) — NÃO cadastrar
const startSelectors = [
  'text=Começar agora',
  'button:has-text("Começar agora")',
  'a:has-text("Começar agora")',
  'text=Começar',
];
let clicked = false;
for (const sel of startSelectors) {
  const el = page.locator(sel).first();
  if (await el.count() && await el.isVisible().catch(() => false)) {
    console.log('click', sel);
    await el.click({ timeout: 10000 });
    clicked = true;
    break;
  }
}
if (!clicked) {
  // fallback: qualquer CTA principal
  const cta = page.locator('button').filter({ hasText: /come[cç]ar|cadastr|avan[cç]ar|pr[oó]ximo/i }).first();
  if (await cta.count()) {
    console.log('click fallback CTA');
    await cta.click();
    clicked = true;
  }
}
await page.waitForTimeout(5000);
steps.push(await dump('02-apos-comecar'));

// Percorre alguns passos preenchendo o mínimo pra revelar campos/API — SEM submit final
// Tenta avançar por "Próximo" / "Continuar" até ver upload de docs ou botão Cadastrar
async function clickIf(re, label) {
  const loc = page.locator('button, a, [role=button]').filter({ hasText: re }).first();
  if (await loc.count() && await loc.isVisible().catch(() => false)) {
    const t = await loc.innerText().catch(() => label);
    // NUNCA clicar cadastrar/finalizar/enviar contrato
    if (/cadastrar|finalizar|enviar|confirmar cadastro|concluir/i.test(t) && !/pr[oó]ximo|continuar|avan/i.test(t)) {
      console.log('SKIP botão perigoso:', t);
      return false;
    }
    console.log('click step:', t);
    await loc.click({ timeout: 8000 }).catch((e) => console.log('click fail', e.message));
    await page.waitForTimeout(3500);
    return true;
  }
  return false;
}

// Se houver escolha PF/PJ
await clickIf(/pessoa f[ií]sica|PF\b/i, 'PF');
steps.push(await dump('03-tipo'));

// Avança até 6 vezes olhando o que aparece (sem cadastrar)
for (let i = 0; i < 8; i++) {
  const before = page.url() + '|' + (await page.innerText('body').catch(() => '')).slice(0, 200);
  // Preenche campos vazios óbvios se existirem (dados fake só pra revelar fluxo — sem submit)
  await page.evaluate(() => {
    const set = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el || el.value) return;
      el.focus();
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // NÃO preenche arquivos
  });

  const advanced =
    (await clickIf(/^pr[oó]ximo$/i, 'proximo')) ||
    (await clickIf(/continuar/i, 'continuar')) ||
    (await clickIf(/avan[cç]ar/i, 'avancar')) ||
    (await clickIf(/seguinte/i, 'seguinte'));

  steps.push(await dump(`04-nav-${i}`));

  const body = await page.innerText('body').catch(() => '');
  if (/cadastrar|finalizar cadastro|enviar documentos/i.test(body) && /documento|conta de energia|upload|anexar|foto/i.test(body)) {
    console.log('Chegou em etapa de docs/cadastro — PARANDO antes do submit');
    break;
  }
  if (!advanced) {
    console.log('Sem botão de avanço — stop');
    break;
  }
  const after = page.url() + '|' + body.slice(0, 200);
  if (after === before) {
    console.log('UI não mudou — stop');
    break;
  }
}

// Baixa bundles JS e procura termos de validação
const scripts = await page.evaluate(() =>
  [...document.querySelectorAll('script[src]')].map((s) => s.src)
);
const validationHints = [];
for (const src of scripts.filter((s) => /assets\/index|assets\/.*\.js/i.test(s)).slice(0, 5)) {
  try {
    const js = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return (await r.text()).slice(0, 0); // size check via headers below
    }, src).catch(() => null);
    const resp = await page.request.get(src);
    const text = await resp.text();
    const needles = [
      'file-upload/registration',
      'init-validation',
      'extract-document',
      'extract-receipt',
      'documentos_enviados',
      'verifyUpload',
      'manual-fallback',
      'idsolcontratovalidacao',
      'personal-doc-front',
      'energy-bill',
      'sendcontract',
      'verification-codes',
      'validado',
      'aguardando',
      'cross_validation',
      'is_authentic',
    ];
    const found = {};
    for (const n of needles) {
      const idx = text.indexOf(n);
      found[n] = idx >= 0 ? { idx, ctx: text.slice(Math.max(0, idx - 80), idx + n.length + 120) } : null;
    }
    validationHints.push({ src, size: text.length, found });
    // Salva trechos relevantes
    fs.writeFileSync(`/tmp/bundle-snip-${validationHints.length}.txt`,
      needles.map((n) => `### ${n}\n${found[n]?.ctx || 'NOT FOUND'}\n`).join('\n'));
  } catch (e) {
    validationHints.push({ src, error: e.message });
  }
}

const apiPaths = [...new Set(apiCalls.map((c) => {
  try { return new URL(c.url).pathname; } catch { return c.url; }
}))];

const result = {
  proxyPass: PASS,
  landing: LANDING,
  finalUrl: page.url(),
  steps,
  apiPaths,
  apiCalls: apiCalls.slice(0, 150),
  networkCount: network.length,
  scripts,
  validationHints,
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log('\nAPI paths:', apiPaths);
console.log('saved', OUT);
await browser.close();
