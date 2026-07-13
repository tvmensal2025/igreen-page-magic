/**
 * PROVA NO PORTAL OFICIAL (UI real, proxy BR):
 * - Sobe CNH + fatura REAIS (customer 603d6f4e — os arquivos que nosso fluxo
 *   antigo reprovava com IA_REPROVADA_CONTA) no green.igreenenergy.com.br.
 * - Observa as chamadas de API que o PRÓPRIO portal faz e se ele valida na hora.
 * - NUNCA clica Cadastrar/Finalizar/Concluir. Não cria cliente, não manda OTP.
 */
import { chromium } from 'playwright-chromium';
import fs from 'node:fs';
import crypto from 'node:crypto';

const CUSTOMER_ID = process.argv[2] || '603d6f4e-f1e3-40b0-8d72-816d0b1d5a35';
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PASS = `6knxVZtVUQyU7BihQ7RT_country-BR_session-${crypto.randomBytes(4).toString('hex')}_lifetime-90`;
const PROXY = { server: 'http://core-residential.evomi.com:1000', username: 'rafaelferr0', password: PASS };
const LANDING = 'https://green.igreenenergy.com.br/autoconexao/?id=124170';
const OUT = '/tmp/fatura-real-ui-proof.json';

// ── Anexos reais do Supabase ─────────────────────────────────────────────────
function decode(value, label) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let mime = 'image/jpeg', b64 = value.trim();
  const m = b64.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) { mime = m[1]; b64 = m[2]; }
  else if (b64.startsWith('JVBER')) mime = 'application/pdf';
  else if (b64.startsWith('iVBOR')) mime = 'image/png';
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length < 500) return null;
  const ext = mime.includes('pdf') ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';
  const path = `/tmp/real-${label}.${ext}`;
  fs.writeFileSync(path, buffer);
  return { path, mime, bytes: buffer.length };
}
const sbRes = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/customers?id=eq.${CUSTOMER_ID}&select=*`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
const cust = (await sbRes.json())[0];
if (!cust) throw new Error('customer não encontrado');
const doc = decode(cust.document_front_base64, 'cnh');
const bill = decode(cust.bill_base64, 'fatura');
console.log('doc =', doc?.path, doc?.bytes, 'B |', 'bill =', bill?.path, bill?.bytes, 'B');
if (!doc || !bill) throw new Error('anexos insuficientes');

// ── Browser via proxy BR ─────────────────────────────────────────────────────
const apiCalls = [];
const browser = await chromium.launch({
  headless: true, proxy: PROXY,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  locale: 'pt-BR', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await context.newPage();

page.on('request', (req) => {
  if (/api-green-connection/i.test(req.url())) {
    apiCalls.push({ t: Date.now(), phase: 'req', method: req.method(), url: req.url() });
  }
});
page.on('response', async (res) => {
  if (!/api-green-connection/i.test(res.url())) return;
  let body = null;
  try { body = (await res.text()).slice(0, 3000); } catch {}
  apiCalls.push({ t: Date.now(), phase: 'res', status: res.status(), url: res.url(), body });
});

const path = (u) => { try { const x = new URL(u); return x.pathname; } catch { return u; } };
const seen = () => apiCalls.filter(c => c.phase === 'res').map(c => `${c.status} ${path(c.url)}`);

async function waitForApi(re, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = apiCalls.find(c => c.phase === 'res' && re.test(path(c.url)));
    if (hit) return hit;
    await page.waitForTimeout(1500);
  }
  console.log(`⏱ timeout esperando ${label}`);
  return null;
}

async function shot(label) {
  const p = `/tmp/ui-${label}.png`;
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  const text = (await page.innerText('body').catch(() => '')).slice(0, 700).replace(/\n+/g, ' | ');
  console.log(`\n=== ${label} ===\n${text}`);
  return { label, shot: p, text };
}

async function clickSafe(re, label) {
  const loc = page.locator('button, a, [role=button]').filter({ hasText: re });
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const t = ((await el.innerText().catch(() => '')) || label).trim();
    if (/cadastrar|finalizar|concluir|assinar|enviar contrato/i.test(t)) {
      console.log('⛔ NÃO clico botão perigoso:', t);
      return false;
    }
    console.log('click:', t.slice(0, 60));
    await el.click({ timeout: 8000 }).catch(e => console.log('click fail', e.message.split('\n')[0]));
    return true;
  }
  return false;
}

const steps = [];
console.log('→ landing (proxy sess', PASS.split('session-')[1], ')');
let nav = false;
for (let i = 1; i <= 4 && !nav; i++) {
  try {
    await page.goto(LANDING, { waitUntil: 'domcontentloaded', timeout: 60000 });
    nav = true;
  } catch (e) {
    console.log(`goto tentativa ${i} falhou: ${e.message.split('\n')[0]} — retry`);
    await page.waitForTimeout(3000);
  }
}
if (!nav) throw new Error('não navegou após 4 tentativas');
await page.waitForTimeout(6000);
steps.push(await shot('00-landing'));

// Dialog "Continuar cadastro?" (sessão salva) — começar do zero
await clickSafe(/come[cç]ar (do zero|novo)|novo cadastro|start new/i, 'reset-sessao');
// CTA da landing (mobile: pode precisar scroll)
for (let i = 0; i < 5; i++) {
  const ok = await clickSafe(/come[cç]ar agora/i, 'comecar');
  if (ok) break;
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(6000);
await clickSafe(/come[cç]ar (do zero|novo)|novo cadastro/i, 'reset-sessao-2');
await page.waitForTimeout(2500);
// Espera o passo 1 renderizar (input file)
for (let i = 0; i < 10 && !(await page.locator('input[type=file]').count()); i++) {
  await clickSafe(/come[cç]ar agora/i, 'comecar-retry');
  await page.waitForTimeout(3000);
}
steps.push(await shot('01-passo1-doc'));

// ── PASSO 1: CNH (arquivo único) ─────────────────────────────────────────────
await clickSafe(/^ *[uú]nico arquivo *$/i, 'unico-arquivo');
await page.locator('input[type=file]').first().setInputFiles(doc.path);
console.log('CNH enviada — aguardando validate/upload…');
const vDoc = await waitForApi(/validate\/upload/, 40000, 'validate doc');
console.log('validate doc:', vDoc?.status, (vDoc?.body || '').slice(0, 220));
await page.waitForTimeout(2500);
steps.push(await shot('02-doc-validado'));

// Prosseguir → dispara extract-document + upload registration em paralelo
for (let i = 0; i < 3; i++) {
  const btn = page.getByRole('button', { name: /prosseguir/i }).first();
  if (await btn.isEnabled().catch(() => false)) { await btn.click(); console.log('Prosseguir (doc) clicado'); break; }
  await page.waitForTimeout(3000);
}
const eDoc = await waitForApi(/extract-document/, 120000, 'extract-document');
console.log('extract-document status:', eDoc?.status);

// Tela "Dados extraídos" da CNH → Continuar
let contOk = false;
for (let i = 0; i < 30 && !contOk; i++) {
  const body = await page.innerText('body').catch(() => '');
  if (/dados extra[ií]dos/i.test(body)) {
    steps.push(await shot('03-doc-extraido'));
    contOk = await clickSafe(/^ *continuar *$/i, 'continuar-doc');
    break;
  }
  await page.waitForTimeout(3000);
}
if (!contOk) console.log('⚠ não achou tela Dados extraídos do doc');

// ── PASSO 2: fatura PDF real ─────────────────────────────────────────────────
// (hook useStepInvoice: processFile roda upload energy-bill + /extractor/extract)
let passo2 = false;
for (let i = 0; i < 15; i++) {
  const body = await page.innerText('body').catch(() => '');
  if (/passo 2 de|conta de luz/i.test(body) && await page.locator('input[type=file]').count()) { passo2 = true; break; }
  await page.waitForTimeout(2500);
}
steps.push(await shot('04-passo2-conta'));
if (!passo2) throw new Error('não chegou ao passo 2 (conta de luz)');

const markBill = apiCalls.length;
await page.locator('input[type=file]').first().setInputFiles(bill.path);
console.log('fatura PDF enviada — aguardando /extractor/extract…');
const waitBillApi = async (re, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = apiCalls.slice(markBill).find(c => c.phase === 'res' && re.test(path(c.url)));
    if (hit) return hit;
    await page.waitForTimeout(1500);
  }
  console.log(`⏱ timeout esperando ${label}`);
  return null;
};
const eBill = await waitBillApi(/\/extractor\/extract$/, 240000, 'extract fatura');
console.log('extract fatura status:', eBill?.status);
console.log('extract fatura body:', (eBill?.body || '').slice(0, 800));
await page.waitForTimeout(6000);
steps.push(await shot('05-fatura-processada'));

// Reprovação de autenticidade? (não deve existir p/ fatura)
const bodyNow = await page.innerText('body').catch(() => '');
const rejeitada = /documento inv[aá]lido|reprovad|n[aã]o (foi )?reconhecid|comprovante banc[aá]rio/i.test(bodyNow);
console.log('\nUI indica reprovação de autenticidade?', rejeitada ? 'SIM ⚠' : 'NÃO ✓');

// Se apareceu "Dados extraídos"/tela de confirmação da fatura, registra e PARA.
if (/dados extra[ií]dos|conta de luz/i.test(bodyNow)) {
  steps.push(await shot('06-final'));
}

const resumo = seen();
console.log('\n── Sequência de API do PORTAL OFICIAL ──');
for (const s of resumo) console.log(' ', s);

fs.writeFileSync(OUT, JSON.stringify({
  customer: CUSTOMER_ID, proxySession: PASS,
  files: { doc, bill },
  steps,
  api: apiCalls.map(c => ({ phase: c.phase, status: c.status, method: c.method, path: path(c.url), body: c.body })),
}, null, 2));
console.log('\nsaved', OUT);
await browser.close();
