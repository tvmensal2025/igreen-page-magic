// server.mjs — igreen-sync-worker v6
//
// Login: Playwright via Tor SOCKS5 (IP residencial) + 2captcha (reCAPTCHA v2)
// Dados: fetch direto com token JWT (sem proxy)
//
// Endpoints:
//   GET  /health
//   POST /sync-customers   { portal_email, portal_password }
//   POST /sync-network     { portal_email, portal_password }

import http from 'node:http';
import { chromium } from 'playwright-chromium';

const PORT = parseInt(process.env.PORT || '3102', 10);
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '1800000', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '20', 10);
const TWOCAPTCHA_KEY = process.env.TWOCAPTCHA_KEY || '';
const PLAYWRIGHT_HEADLESS = (process.env.PLAYWRIGHT_HEADLESS || 'true') !== 'false';

const PORTAL_LOGIN_URL = 'https://escritorio.igreenenergy.com.br/login';
const API_BASE = 'https://api-voffice.igreenenergy.com.br/v1';
const RECAPTCHA_SITEKEY = '6LcmxKAUAAAAAHMCMDRNH3NMxIZUSbGqCiGHYeON';

if (!WORKER_TOKEN) console.warn('[boot] WARN: WORKER_TOKEN não definido!');
if (!TWOCAPTCHA_KEY) console.warn('[boot] WARN: TWOCAPTCHA_KEY não definido!');

// ------------ 2captcha ------------
async function solve2captcha(sitekey, pageUrl) {
  console.log('[2captcha] submetendo reCAPTCHA...');
  const submitRes = await fetch('https://2captcha.com/in.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      key: TWOCAPTCHA_KEY,
      method: 'userrecaptcha',
      googlekey: sitekey,
      pageurl: pageUrl,
      json: '1',
    }),
    signal: AbortSignal.timeout(30000),
  });
  const submitData = await submitRes.json();
  if (submitData.status !== 1) throw new HttpError(500, `2captcha submit: ${submitData.request}`);

  const captchaId = submitData.request;
  console.log(`[2captcha] id=${captchaId}, aguardando resolução...`);

  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(
      `https://2captcha.com/res.php?key=${TWOCAPTCHA_KEY}&action=get&id=${captchaId}&json=1`,
      { signal: AbortSignal.timeout(15000) }
    );
    const pollData = await pollRes.json();
    if (pollData.status === 1) {
      console.log(`[2captcha] resolvido em ~${(i + 1) * 5}s`);
      return pollData.request;
    }
    if (pollData.request !== 'CAPCHA_NOT_READY') throw new HttpError(500, `2captcha: ${pollData.request}`);
    if (i % 4 === 0) console.log(`[2captcha] aguardando... ${(i + 1) * 5}s`);
  }
  throw new HttpError(500, '2captcha timeout');
}

// ------------ Browser com Tor ------------
let sharedBrowser = null;

async function getBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: PLAYWRIGHT_HEADLESS,
    proxy: { server: 'socks5://127.0.0.1:9050' }, // Tor SOCKS5
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  return sharedBrowser;
}

// ------------ Pool de sessões (token JWT) ------------
const sessions = new Map();

async function evictOldest() {
  let oldestKey = null, oldestUsed = Infinity;
  for (const [k, s] of sessions) {
    if (s.lastUsed < oldestUsed) { oldestUsed = s.lastUsed; oldestKey = k; }
  }
  if (oldestKey) sessions.delete(oldestKey);
}

async function loginAndGetToken(email, password) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // Captura token JWT das responses de rede
  let capturedToken = null;
  context.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('igreenenergy')) return;
    try {
      const ct = response.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const j = await response.json().catch(() => null);
      if (!j) return;
      const t = j?.token || j?.access_token || j?.accessToken || j?.data?.token || j?.jwt;
      if (t && !capturedToken) { capturedToken = t; console.log(`[token] capturado de ${url}`); }
    } catch { /* ignora */ }
  });

  const page = await context.newPage();

  try {
    console.log(`[login] ${email} → navegando via Tor`);
    await page.goto(PORTAL_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Aguarda CF challenge resolver (Tor usa IPs residenciais — deve passar)
    let pageTitle = '';
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(2000);
      pageTitle = await page.title().catch(() => '');
      const bodySnippet = await page.locator('body').innerText().catch(() => '');
      console.log(`[login] CF check [${i+1}/15] title="${pageTitle}" url=${page.url()}`);
      console.log(`[login] body snippet: ${bodySnippet.slice(0, 150).replace(/\n/g, ' ')}`);
      if (!pageTitle.includes('Attention Required') && !pageTitle.includes('Just a moment') &&
          !bodySnippet.includes('Checking your browser')) break;
      if (i === 14) throw new HttpError(503, 'Cloudflare bloqueou via Tor');
    }

    // Aguarda formulário
    const emailSel = 'input[type="email"], input[name="email"], input[name="usuario"], input[name="login"]';
    const passSel = 'input[type="password"]';
    await page.waitForSelector(emailSel, { timeout: 20000 });

    // Preenche
    await page.fill(emailSel, email);
    await page.waitForTimeout(400);
    await page.fill(passSel, password);
    await page.waitForTimeout(400);

    // Resolve reCAPTCHA com 2captcha — só se o sitekey estiver na página
    const sitekeyEl = await page.evaluate(() => {
      return document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey') || null;
    }).catch(() => null);

    console.log(`[login] sitekey na página: ${sitekeyEl || 'NÃO DETECTADO'}`);
    const currentBodyText = await page.locator('body').innerText().catch(() => '');
    console.log(`[login] body snippet: ${currentBodyText.slice(0, 200).replace(/\n/g, ' ')}`);

    if (sitekeyEl) {
      // reCAPTCHA real detectado — resolve via 2captcha
      const captchaToken = await solve2captcha(sitekeyEl, PORTAL_LOGIN_URL);
      console.log('[login] token 2captcha obtido — injetando...');

      await page.evaluate((token) => {
        let ta = document.getElementById('g-recaptcha-response');
        if (!ta) ta = document.querySelector('[name="g-recaptcha-response"]');
        if (ta) { ta.style.display = 'block'; ta.value = token; }
        try {
          for (const client of Object.values(window.___grecaptcha_cfg?.clients || {})) {
            for (const val of Object.values(client)) {
              if (val && typeof val === 'object' && typeof val.callback === 'function') {
                val.callback(token); return;
              }
            }
          }
        } catch (_) {}
        if (typeof window.verifyCallback === 'function') window.verifyCallback(token);
      }, captchaToken);
      await page.waitForTimeout(800);
    } else {
      console.log('[login] sem reCAPTCHA detectado — tentando submit direto');
    }

    // Submit
    const submitSel = 'button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")';
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {}),
      page.click(submitSel).catch(() => page.keyboard.press('Enter')),
    ]);

    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    if (/\/login/i.test(currentUrl)) {
      throw new HttpError(401, 'Login rejeitado — credenciais inválidas ou captcha não aceito');
    }

    console.log(`[login] ${email} → OK! URL=${currentUrl}`);

    // Tenta capturar token JWT se não foi capturado via network
    if (!capturedToken) {
      capturedToken = await page.evaluate(() => {
        return localStorage.getItem('token') ||
          localStorage.getItem('access_token') ||
          sessionStorage.getItem('token') ||
          null;
      }).catch(() => null);
    }

    // Busca consultor_id
    let consultorId = null;
    try {
      const consultantRes = await page.request.get(`${API_BASE}/consultant`, { timeout: 20000 });
      if (consultantRes.ok()) {
        const j = await consultantRes.json();
        consultorId = String(j?.id || j?.consultor?.id || j?.data?.id || j?.idconsultor || '') || null;
      }
    } catch (e) {
      console.warn(`[login] ${email} → não consegui consultor_id: ${e.message}`);
    }

    await context.close();

    console.log(`[login] ${email} → token=${capturedToken ? 'sim' : 'via-cookies'}, consultor=${consultorId}`);
    return { token: capturedToken, consultorId };

  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }
}

async function getOrCreateSession(email, password) {
  const now = Date.now();
  let s = sessions.get(email);
  if (s && (now - s.createdAt) > SESSION_TTL_MS) { sessions.delete(email); s = null; }
  if (s) { s.lastUsed = now; return s; }
  if (sessions.size >= MAX_SESSIONS) await evictOldest();

  const { token, consultorId } = await loginAndGetToken(email, password);
  s = { token, consultorId, createdAt: now, lastUsed: now, lock: Promise.resolve() };
  sessions.set(email, s);
  return s;
}

async function withSession(email, password, fn) {
  const s = await getOrCreateSession(email, password);
  const prev = s.lock;
  let release;
  s.lock = new Promise(r => { release = r; });
  try {
    await prev.catch(() => {});
    return await fn(s);
  } finally { release(); }
}

// ------------ API direta com token JWT (sem proxy) ------------
async function fetchPaginated(token, url, { pageParam = 'page', sizeParam = 'pageSize', size = 500 } = {}) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const sep = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}${pageParam}=${p}&${sizeParam}=${size}`;
    let res;
    try {
      res = await fetch(full, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) { throw new HttpError(500, `Rede: ${e.message}`); }

    const status = res.status;
    if (status === 429) { console.warn('[fetch] 429 — aguardando 30s'); await new Promise(r => setTimeout(r, 30000)); continue; }
    if (status === 401 || status === 403) throw new HttpError(status, `Token expirado (${status})`);
    if (!res.ok) throw new HttpError(status, `HTTP ${status}`);

    const j = await res.json();
    const arr = Array.isArray(j) ? j :
      Array.isArray(j?.data) ? j.data :
      Array.isArray(j?.items) ? j.items :
      Array.isArray(j?.results) ? j.results :
      Array.isArray(j?.customers) ? j.customers :
      Array.isArray(j?.members) ? j.members : [];
    all.push(...arr);
    console.log(`  page ${p}: ${arr.length} (total: ${all.length})`);
    if (arr.length < size) break;
  }
  return all;
}

// ------------ HTTP ------------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function authOk(req) {
  if (!WORKER_TOKEN) return true;
  return req.headers['x-worker-token'] === WORKER_TOKEN;
}

const bootAt = Date.now();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, {
        ok: true, sessions: sessions.size,
        uptime_s: Math.round((Date.now() - bootAt) / 1000),
        mode: 'tor-playwright-2captcha',
        tor: true, twocaptcha: !!TWOCAPTCHA_KEY,
      });
    }

    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'not_found' });
    if (!authOk(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

    const body = await readJsonBody(req);
    const email = String(body.portal_email || '').trim().toLowerCase();
    const password = String(body.portal_password || '');
    if (!email || !password) return send(res, 400, { ok: false, error: 'portal_email e portal_password obrigatórios' });

    if (req.url === '/debug-page') {
      // Endpoint temporário para ver o HTML da página de login via Tor
      const browser = await getBrowser();
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
      });
      await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
      const p = await context.newPage();
      try {
        await p.goto(PORTAL_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await p.waitForTimeout(3000);
        const title = await p.title().catch(() => '');
        const url = p.url();
        const html = await p.content().catch(() => '');
        const sitekeys = html.match(/data-sitekey="([^"]+)"/g) || [];
        const bodyText = await p.locator('body').innerText().catch(() => '');
        await context.close();
        return send(res, 200, { title, url, sitekeys, bodySnippet: bodyText.slice(0, 500) });
      } catch (e) {
        await context.close().catch(() => {});
        return send(res, 500, { error: e.message });
      }
    }

    if (req.url === '/sync-customers') {
      const result = await withSession(email, password, async s => {
        if (!s.consultorId) throw new HttpError(500, 'consultor_id indisponível');
        const customers = await fetchPaginated(s.token, `${API_BASE}/customer-map/${s.consultorId}`, { pageParam: 'page', sizeParam: 'pageSize', size: 500 });
        return { ok: true, consultor_id: s.consultorId, customers };
      });
      return send(res, 200, result);
    }

    if (req.url === '/sync-network') {
      const result = await withSession(email, password, async s => {
        const members = await fetchPaginated(s.token, `${API_BASE}/network-map`, { pageParam: 'page', sizeParam: 'per_page', size: 100 });
        return { ok: true, consultor_id: s.consultorId, members };
      });
      return send(res, 200, result);
    }

    return send(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    const status = e?.status || 500;
    console.error(`[err] ${req.method} ${req.url} → ${status}: ${e?.message}`);
    return send(res, status, { ok: false, error: e?.message || 'erro interno' });
  }
});

server.listen(PORT, () => {
  console.log(`[boot] igreen-sync-worker v6 (tor+playwright+2captcha) porta ${PORT}`);
});

setInterval(() => {
  const now = Date.now();
  for (const [email, s] of sessions) {
    if ((now - s.createdAt) > SESSION_TTL_MS) {
      console.log(`[gc] expirando sessão ${email}`);
      sessions.delete(email);
    }
  }
}, 60000);

process.on('SIGTERM', async () => {
  sessions.clear();
  if (sharedBrowser) await sharedBrowser.close().catch(() => {});
  process.exit(0);
});
