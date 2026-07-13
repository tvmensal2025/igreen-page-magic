import { chromium } from 'playwright-chromium';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PASS = `6knxVZtVUQyU7BihQ7RT_country-BR_session-${crypto.randomBytes(4).toString('hex')}_lifetime-90`;
const PROXY = { server: 'http://core-residential.evomi.com:1000', username: 'rafaelferr0', password: PASS };
const LANDING = 'https://green.igreenenergy.com.br/autoconexao/?id=124170';
fs.mkdirSync('/tmp/igreen-js', { recursive: true });

const apiCalls = [];
const jsFiles = new Map();

const browser = await chromium.launch({
  headless: true,
  proxy: PROXY,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  locale: 'pt-BR',
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await context.newPage();

page.on('request', (req) => {
  const url = req.url();
  if (/api-green-connection/i.test(url)) {
    apiCalls.push({ phase:'req', method:req.method(), url, post:(req.postData()||'').slice(0,3000),
      headers:Object.fromEntries(Object.entries(req.headers()).filter(([k])=>/^x-|content-type/i.test(k))) });
  }
});
page.on('response', async (res) => {
  const url = res.url();
  try {
    if (/api-green-connection/i.test(url)) {
      const body = (await res.text()).slice(0, 6000);
      apiCalls.push({ phase:'res', status:res.status(), url, body });
    }
    if (/\.js(\?|$)/i.test(url) && /igreenenergy\.com\.br/i.test(url)) {
      const text = await res.text();
      const name = url.split('/').pop().split('?')[0];
      jsFiles.set(name, text);
      if (text.length > 5000) fs.writeFileSync(`/tmp/igreen-js/${name}`, text);
    }
  } catch {}
});

console.log('proxy BR session', PASS);
await page.goto(LANDING, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(7000);
console.log('title', await page.title(), 'js so far', jsFiles.size);

// Mobile CTA
const start = page.locator('button:visible', { hasText: /Começar agora/i }).first();
await start.click({ timeout: 15000 });
await page.waitForTimeout(5000);
console.log('step1', (await page.innerText('body')).slice(0,350).replace(/\n/g,' | '));
await page.screenshot({ path:'/tmp/d2-step1.png', fullPage:true });

// Fake tiny PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC','base64');
fs.writeFileSync('/tmp/fake-doc.png', png);
fs.writeFileSync('/tmp/fake-bill.png', png);

await page.locator('input[type=file]').first().setInputFiles('/tmp/fake-doc.png');
console.log('uploaded doc, waiting OCR/API...');
for (let i=0;i<20;i++) {
  await page.waitForTimeout(2000);
  const body = await page.innerText('body');
  const enabled = await page.getByRole('button', { name:/Prosseguir/i }).isEnabled().catch(()=>false);
  console.log(`t=${(i+1)*2}s enabled=${enabled} api=${apiCalls.length} snippet=${body.slice(0,120).replace(/\n/g,' ')}`);
  if (/erro|inv[aá]lid|n[aã]o consegu|reenviar|leg[ií]vel|reprov/i.test(body) && !/DICAS PARA/i.test(body.slice(0,50))) {
    console.log('UI msg:', body.slice(0,600).replace(/\n/g,' | '));
  }
  // Se OCR rodou (mais API calls além de init) ou botão liberou
  const paths = apiCalls.filter(c=>c.phase==='req').map(c=>{try{return new URL(c.url).pathname}catch{return c.url}});
  if (paths.some(p=>/extract|file-upload|validate/i.test(p)) || enabled) break;
}
await page.screenshot({ path:'/tmp/d2-after-upload.png', fullPage:true });
console.log('body after upload:', (await page.innerText('body')).slice(0,900).replace(/\n/g,' | '));

const pbtn = page.getByRole('button', { name:/Prosseguir/i });
if (await pbtn.isEnabled().catch(()=>false)) {
  await pbtn.click();
  await page.waitForTimeout(8000);
} else {
  console.log('Prosseguir ainda disabled — não forçar cadastro; só analisar APIs até aqui');
}
await page.screenshot({ path:'/tmp/d2-furthest.png', fullPage:true });
console.log('furthest:', (await page.innerText('body')).slice(0,1000).replace(/\n/g,' | '));

// Se chegou em passo 2 (conta), sobe bill
if (await page.locator('input[type=file]').count()) {
  const t = await page.innerText('body');
  if (/conta|energia|fatura|boleto/i.test(t)) {
    await page.locator('input[type=file]').first().setInputFiles('/tmp/fake-bill.png');
    await page.waitForTimeout(12000);
    await page.screenshot({ path:'/tmp/d2-after-bill.png', fullPage:true });
    console.log('after bill:', (await page.innerText('body')).slice(0,800).replace(/\n/g,' | '));
    const p2 = page.getByRole('button', { name:/Prosseguir/i });
    if (await p2.isEnabled().catch(()=>false)) {
      await p2.click();
      await page.waitForTimeout(8000);
    }
  }
}
await page.screenshot({ path:'/tmp/d2-end.png', fullPage:true });
console.log('END UI:', (await page.innerText('body')).slice(0,1200).replace(/\n/g,' | '));
const danger = await page.locator('button:visible').filter({ hasText:/cadastrar|finalizar|concluir/i }).allInnerTexts();
console.log('DANGER (not clicked):', danger);

// Grep JS
const needles = ['file-upload/registration','file-upload/verify','init-validation','extract-document','extract-receipt','personal-doc-front','energy-bill','idsolcontratovalidacao','manual-fallback','documentos_enviados','sendcontract','verification-codes','is_authentic','reconcile','/customers','PASSO 1','Validaremos'];
const hitSummary = {};
for (const [name, text] of jsFiles) {
  for (const n of needles) {
    if (text.includes(n)) {
      (hitSummary[n] ||= []).push(name);
    }
  }
}
console.log('\nJS files captured:', [...jsFiles.keys()]);
console.log('Needle→files:', hitSummary);

// Extrair trechos de rotas da API do maior bundle
let biggest = ['', ''];
for (const [n,t] of jsFiles) if (t.length > biggest[1].length) biggest = [n,t];
console.log('biggest bundle', biggest[0], biggest[1].length);
const routeRe = /\/(?:extractor|file-upload|customers|bonus|verification-codes|contracts|document-lookup|viacep|consultants|form-config|contract-validation)[a-zA-Z0-9_\/{}-]*/g;
const routes = [...new Set(biggest[1].match(routeRe) || [])].sort();
console.log('routes in biggest:', routes);

const out = {
  pass: PASS,
  jsFiles: [...jsFiles.keys()],
  hitSummary,
  routes,
  api: apiCalls.map(c => ({
    phase:c.phase, status:c.status, method:c.method,
    path: (()=>{try{const u=new URL(c.url); return u.pathname+u.search}catch{return c.url}})(),
    body:(c.body||'').slice(0,2000), post:(c.post||'').slice(0,1000),
  })),
  endText: (await page.innerText('body')).slice(0,2000),
  danger,
};
fs.writeFileSync('/tmp/cadastro-deep2.json', JSON.stringify(out, null, 2));
console.log('\nAPI seq:');
for (const c of out.api) {
  if (c.phase==='req') console.log('→', c.method, c.path, c.post?.slice(0,120)||'');
  else console.log('←', c.status, c.path, (c.body||'').slice(0,200).replace(/\n/g,' '));
}
await browser.close();
