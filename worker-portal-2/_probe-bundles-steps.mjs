/**
 * 1) Baixa todos JS chunks e procura endpoints/validação
 * 2) Sobe doc fake + conta fake para revelar passos 2-5 SEM clicar Cadastrar no final
 */
import { chromium } from 'playwright-chromium';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const PASS = `6knxVZtVUQyU7BihQ7RT_country-BR_session-${crypto.randomBytes(4).toString('hex')}_lifetime-90`;
const PROXY = { server: 'http://core-residential.evomi.com:1000', username: 'rafaelferr0', password: PASS };
const ID = 124170;
const LANDING = `https://green.igreenenergy.com.br/autoconexao/?id=${ID}`;

const apiCalls = [];
const browser = await chromium.launch({
  headless: true,
  proxy: PROXY,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'pt-BR',
  viewport: { width: 420, height: 900 },
});
await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await context.newPage();

page.on('request', (req) => {
  const url = req.url();
  if (!/api-green-connection/i.test(url)) return;
  apiCalls.push({ t: Date.now(), phase: 'req', method: req.method(), url, post: (req.postData()||'').slice(0,2500), headers: Object.fromEntries(Object.entries(req.headers()).filter(([k])=>/^x-|content-type/i.test(k))) });
});
page.on('response', async (res) => {
  const url = res.url();
  if (!/api-green-connection/i.test(url)) return;
  let body = null;
  try { body = (await res.text()).slice(0, 5000); } catch {}
  apiCalls.push({ t: Date.now(), phase: 'res', status: res.status(), url, body });
});

await page.goto(LANDING, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => page.goto(LANDING, { timeout: 90000 }));
await page.waitForTimeout(4000);

// Coletar URLs de assets via performance + DOM
const assetUrls = await page.evaluate(async () => {
  const fromDom = [...document.querySelectorAll('script[src],link[href]')].map(e => e.src || e.href);
  const fromPerf = performance.getEntriesByType('resource').map(r => r.name);
  return [...new Set([...fromDom, ...fromPerf].filter(u => /\.js(\?|$)/i.test(u)))];
});
console.log('JS assets:', assetUrls.length, assetUrls.slice(0, 20));

const needles = [
  'file-upload/registration','file-upload/verify','init-validation','extract-document','extract-receipt',
  'extract-section','manual-fallback','idsolcontratovalidacao','personal-doc-front','personal-doc-back',
  'energy-bill','documentos_enviados','sendcontract','verification-codes','is_authentic','cross_validation',
  'caminhoarquivo','PASSO','Prosseguir','validado','reconcile','contract-validation','/customers'
];
const hits = {};
for (const n of needles) hits[n] = [];

for (const src of assetUrls) {
  try {
    const r = await page.request.get(src);
    const text = await r.text();
    for (const n of needles) {
      let idx = 0, count = 0;
      while ((idx = text.indexOf(n, idx)) >= 0 && count < 2) {
        hits[n].push({ src: src.split('/').pop(), idx, ctx: text.slice(Math.max(0, idx-100), idx+n.length+180) });
        idx += n.length; count++;
      }
    }
    // save large chunks locally for deeper grep
    if (text.length > 50000) {
      const name = src.split('/').pop().replace(/[^a-zA-Z0-9._-]/g,'_');
      fs.writeFileSync(`/tmp/igreen-js/${name}`, text);
    }
  } catch (e) {
    console.log('asset fail', src, e.message);
  }
}
fs.mkdirSync('/tmp/igreen-js', { recursive: true });
// rewrite after mkdir - redownload big ones
for (const src of assetUrls) {
  try {
    const r = await page.request.get(src);
    const text = await r.text();
    if (text.length > 20000) {
      const name = src.split('/').pop().replace(/[^a-zA-Z0-9._-]/g,'_');
      fs.writeFileSync(`/tmp/igreen-js/${name}`, text);
    }
  } catch {}
}

console.log('\n=== NEEDLE HITS ===');
for (const [n, arr] of Object.entries(hits)) {
  console.log(`${n}: ${arr.length}`);
  if (arr[0]) console.log(' ', arr[0].ctx.replace(/\n/g,' ').slice(0,220));
}

// Criar imagem PNG mínima válida para upload
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC',
  'base64'
);
const docPath = '/tmp/fake-doc.png';
const billPath = '/tmp/fake-bill.png';
fs.writeFileSync(docPath, png);
fs.writeFileSync(billPath, png);

await page.locator('text=Começar agora').first().click();
await page.waitForTimeout(3000);
console.log('\nSTEP1 text:', (await page.innerText('body')).slice(0, 300).replace(/\n/g,' | '));

// Upload documento
const fileInput = page.locator('input[type=file]').first();
await fileInput.setInputFiles(docPath);
await page.waitForTimeout(5000);
await page.screenshot({ path: '/tmp/cadastro-after-doc-upload.png', fullPage: true });
console.log('after doc upload buttons:', await page.locator('button').allInnerTexts());
console.log('after doc body:', (await page.innerText('body')).slice(0, 500).replace(/\n/g,' | '));

// Prosseguir se habilitado
const prosseguir = page.getByRole('button', { name: /Prosseguir/i });
if (await prosseguir.isEnabled().catch(() => false)) {
  await prosseguir.click();
  await page.waitForTimeout(8000);
} else {
  console.log('Prosseguir disabled — tentando mesmo assim / aguardando OCR');
  await page.waitForTimeout(10000);
  if (await prosseguir.isEnabled().catch(() => false)) await prosseguir.click();
  await page.waitForTimeout(8000);
}
await page.screenshot({ path: '/tmp/cadastro-step-after-doc.png', fullPage: true });
console.log('AFTER DOC PROSSEGUIR:', (await page.innerText('body')).slice(0, 800).replace(/\n/g,' | '));
console.log('buttons:', await page.locator('button').allInnerTexts());

// Se passo conta de luz, upload bill
const file2 = page.locator('input[type=file]');
if (await file2.count()) {
  await file2.first().setInputFiles(billPath);
  await page.waitForTimeout(8000);
  await page.screenshot({ path: '/tmp/cadastro-after-bill.png', fullPage: true });
  console.log('after bill:', (await page.innerText('body')).slice(0, 600).replace(/\n/g,' | '));
  const p2 = page.getByRole('button', { name: /Prosseguir/i });
  if (await p2.isEnabled().catch(() => false)) {
    await p2.click();
    await page.waitForTimeout(8000);
  }
}
await page.screenshot({ path: '/tmp/cadastro-furthest.png', fullPage: true });
console.log('FURTHEST:', (await page.innerText('body')).slice(0, 1200).replace(/\n/g,' | '));
console.log('buttons:', await page.locator('button').allInnerTexts());

// NÃO clicar em Cadastrar — só mapear se o botão existe
const danger = await page.locator('button, a').filter({ hasText: /cadastrar|finalizar|concluir|enviar cadastro/i }).allInnerTexts();
console.log('BOTÕES PERIGOSOS (não clicados):', danger);

const summary = {
  pass: PASS,
  api: apiCalls.map(c => ({
    phase: c.phase, status: c.status, method: c.method,
    path: (() => { try { return new URL(c.url).pathname + (new URL(c.url).search||''); } catch { return c.url; } })(),
    body: c.body?.slice(0, 1500) || null,
    post: c.post?.slice(0, 800) || null,
  })),
  hits: Object.fromEntries(Object.entries(hits).map(([k,v]) => [k, v.length ? v.slice(0,2) : []])),
  furthestText: (await page.innerText('body')).slice(0, 2000),
  dangerButtons: danger,
};
fs.writeFileSync('/tmp/cadastro-steps-deep.json', JSON.stringify(summary, null, 2));
console.log('\nAPI sequence:');
for (const c of summary.api) {
  if (c.phase === 'req') console.log('→', c.method, c.path);
  else console.log('←', c.status, c.path, (c.body||'').slice(0,180).replace(/\n/g,' '));
}
await browser.close();
