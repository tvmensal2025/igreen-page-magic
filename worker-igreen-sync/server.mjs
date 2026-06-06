// server.mjs — igreen-sync-worker v3
//
// Leitura do portal iGreen via Playwright com bypass de Cloudflare/CAPTCHA.
// Usa chromium com flags anti-detecção + interceptação de requests de rede
// para capturar o token JWT sem precisar resolver CAPTCHA manualmente.
//
// Estratégia:
// 1. Abre o browser com stealth flags
// 2. Intercepta requisições XHR/fetch para capturar o Bearer token no login
// 3. Usa esse token para chamar a API diretamente (sem mais browser)
// 4. Reutiliza o token no pool de sessões (TTL 30 min)
//
// Endpoints:
//   GET  /health
//   POST /sync-customers   { portal_email, portal_password }
//   POST /sync-network     { portal_email, portal_password }
//
// Auth: header X-Worker-Token (== env WORKER_TOKEN).

import http from 'node:http';
import { chromium } from 'playwright-chromium';

const PORT = parseInt(process.env.PORT || '3102', 10);
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '1800000', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '20', 10);
const HEADLESS = (process.env.PLAYWRIGHT_HEADLESS || 'true') !== 'false';

const PORTAL_LOGIN_URL = 'https://escritorio.igreenenergy.com.br/login';
const API_BASE = 'https://api-voffice.igreenenergy.com.br/v1';

if (!WORKER_TOKEN) {
  console.warn('[boot] WARN: WORKER_TOKEN não definido — endpoints ficarão abertos!');
}

// ------------ Browser compartilhado ------------
let sharedBrowser = null;

async function getBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--window-size=1280,800',
      '--lang=pt-BR,pt',
    ],
  });
  return sharedBrowser;
}

// ------------ Pool de sessões (token JWT) ------------
const sessions = new Map();

async function evictOldest() {
  let oldestKey = null;
  let oldestUsed = Infinity;
  for (const [k, s] of sessions) {
    if (s.lastUsed < oldestUsed) { oldestUsed = s.lastUsed; oldestKey = k; }
  }
  if (oldestKey) sessions.delete(oldestKey);
}

// ------------ Login via Playwright interceptando o token ------------
async function loginAndCaptureToken(email, password) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    extraHTTPHeaders: {
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
  });

  // Remove navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // Intercepta chamadas de rede para capturar o token JWT
  let capturedToken = null;
  let capturedConsultorId = null;

  page.on('response', async (response) => {
    const url = response.url();
    // Captura token de qualquer resposta de autenticação
    if (url.includes('/auth') || url.includes('/login') || url.includes('/consultant')) {
      try {
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('json')) return;
        const json = await response.json().catch(() => null);
        if (!json) return;

        // Extrai token
        const token = json?.token || json?.access_token || json?.accessToken ||
          json?.data?.token || json?.data?.access_token || json?.jwt;
        if (token && !capturedToken) {
          capturedToken = token;
          console.log(`[token] capturado de ${url}`);
        }

        // Extrai consultor_id
        const cid = json?.id || json?.consultor?.id || json?.data?.id || json?.idconsultor;
        if (cid && !capturedConsultorId) {
          capturedConsultorId = String(cid);
        }
      } catch { /* ignora */ }
    }
  });

  try {
    console.log(`[login] ${email} → navegando para ${PORTAL_LOGIN_URL}`);
    await page.goto(PORTAL_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Aguarda o form aparecer
    const emailSel = 'input[type="email"], input[name="email"], input[name="usuario"], input[name="login"]';
    const passSel = 'input[type="password"]';
    await page.waitForSelector(emailSel, { timeout: 20000 });

    // Simula digitação humana com pequenos delays
    await page.click(emailSel);
    await page.waitForTimeout(300 + Math.random() * 200);
    await page.fill(emailSel, email);
    await page.waitForTimeout(200 + Math.random() * 300);
    await page.fill(passSel, password);
    await page.waitForTimeout(300 + Math.random() * 200);

    // Clica no submit e aguarda navegação
    const submitSel = 'button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")';
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {}),
      page.click(submitSel).catch(() => page.keyboard.press('Enter')),
    ]);

    // Aguarda um pouco mais para capturar as requests pós-login
    await page.waitForTimeout(3000);

    // Verifica se ainda está em /login (falha)
    const currentUrl = page.url();
    if (/\/login/i.test(currentUrl)) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      // Verifica se tem CAPTCHA
      if (bodyText.includes('robô') || bodyText.includes('captcha') || bodyText.includes('reCAPTCHA')) {
        throw new HttpError(401, 'CAPTCHA detectado — não foi possível fazer login automaticamente.');
      }
      throw new HttpError(401, `Login rejeitado. Email ou senha incorretos.`);
    }

    // Se não capturou token via intercepção, tenta buscar via cookies/localStorage
    if (!capturedToken) {
      capturedToken = await page.evaluate(() => {
        return localStorage.getItem('token') ||
          localStorage.getItem('access_token') ||
          localStorage.getItem('jwt') ||
          sessionStorage.getItem('token') ||
          sessionStorage.getItem('access_token') ||
          null;
      });
    }

    // Se ainda sem token, usa page.request com cookies da sessão para buscar direto
    if (!capturedToken) {
      console.log(`[login] ${email} → token não capturado, usando page.request com cookies`);
      // Faz a chamada usando o contexto autenticado do Playwright (cookies válidos)
      const consultantRes = await page.request.get(`${API_BASE}/consultant`, { timeout: 20000 });
      if (consultantRes.ok()) {
        const j = await consultantRes.json();
        capturedConsultorId = String(j?.id || j?.consultor?.id || j?.data?.id || j?.idconsultor || '') || null;
        // Neste caso não temos token mas temos o page com cookies — armazenamos o contexto
        const s = {
          token: null,
          page,        // mantém a página para usar page.request
          context,
          consultorId: capturedConsultorId,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          lock: Promise.resolve(),
        };
        console.log(`[login] ${email} → OK via cookies (consultor=${capturedConsultorId})`);
        return s;
      }
    }

    if (!capturedConsultorId && capturedToken) {
      try {
        const res = await fetch(`${API_BASE}/consultant`, {
          headers: { 'Authorization': `Bearer ${capturedToken}`, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const j = await res.json();
          capturedConsultorId = String(j?.id || j?.consultor?.id || j?.data?.id || j?.idconsultor || '') || null;
        }
      } catch { /* ignora */ }
    }

    await context.close();

    const s = {
      token: capturedToken,
      page: null,
      context: null,
      consultorId: capturedConsultorId,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      lock: Promise.resolve(),
    };
    console.log(`[login] ${email} → OK (token=${capturedToken ? 'sim' : 'não'}, consultor=${capturedConsultorId})`);
    return s;

  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }
}

// ------------ Cria ou reutiliza sessão ------------
async function getOrCreateSession(email, password) {
  const now = Date.now();
  let s = sessions.get(email);

  if (s && (now - s.createdAt) > SESSION_TTL_MS) {
    if (s.context) await s.context.close().catch(() => {});
    sessions.delete(email);
    s = null;
  }

  if (s) { s.lastUsed = now; return s; }
  if (sessions.size >= MAX_SESSIONS) await evictOldest();

  s = await loginAndCaptureToken(email, password);
  sessions.set(email, s);
  return s;
}

async function withSession(email, password, fn) {
  const s = await getOrCreateSession(email, password);
  const prev = s.lock;
  let release;
  s.lock = new Promise((r) => { release = r; });
  try {
    await prev.catch(() => {});
    return await fn(s);
  } finally {
    release();
  }
}

// ------------ Coleta paginada ------------
async function fetchPaginatedWithSession(s, url, { pageParam = 'page', sizeParam = 'pageSize', size = 500 } = {}) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const sep = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}${pageParam}=${p}&${sizeParam}=${size}`;

    let res;
    // Se temos token JWT, usa fetch direto
    if (s.token) {
      try {
        res = await fetch(full, {
          headers: { 'Authorization': `Bearer ${s.token}`, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(60000),
        });
      } catch (e) {
        throw new HttpError(500, `Timeout/rede: ${e.message}`);
      }
    } else if (s.page) {
      // Sem token, usa page.request (cookies da sessão)
      res = await s.page.request.get(full, { timeout: 60000 });
    } else {
      throw new HttpError(500, 'Sem token nem página na sessão');
    }

    const status = res.status();
    if (status === 429) {
      console.warn(`[fetch] 429 em page=${p} — aguardando 30s`);
      await new Promise((r) => setTimeout(r, 30000));
      continue;
    }
    if (status === 401 || status === 403) throw new HttpError(status, `Sessão expirada (${status})`);
    if (!res.ok()) throw new HttpError(status, `HTTP ${status} em ${full}`);

    const j = await res.json();
    const arr = extractArray(j);
    all.push(...arr);
    if (arr.length < size) break;
  }
  return all;
}

function extractArray(j) {
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.items)) return j.items;
  if (Array.isArray(j?.results)) return j.results;
  if (Array.isArray(j?.customers)) return j.customers;
  if (Array.isArray(j?.members)) return j.members;
  return [];
}

// ------------ HTTP server ------------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8') || '{}';
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'JSON inválido')); }
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
  const t = req.headers['x-worker-token'];
  return typeof t === 'string' && t === WORKER_TOKEN;
}

const bootAt = Date.now();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, sessions: sessions.size, uptime_s: Math.round((Date.now() - bootAt) / 1000), mode: 'playwright-stealth' });
    }

    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'not_found' });
    if (!authOk(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

    const body = await readJsonBody(req);
    const email = String(body.portal_email || '').trim().toLowerCase();
    const password = String(body.portal_password || '');
    if (!email || !password) return send(res, 400, { ok: false, error: 'portal_email e portal_password obrigatórios' });

    if (req.url === '/sync-customers') {
      const result = await withSession(email, password, async (s) => {
        if (!s.consultorId) throw new HttpError(500, 'consultor_id indisponível');
        const customers = await fetchPaginatedWithSession(s, `${API_BASE}/customer-map/${s.consultorId}`, { pageParam: 'page', sizeParam: 'pageSize', size: 500 });
        return { ok: true, consultor_id: s.consultorId, customers };
      });
      return send(res, 200, result);
    }

    if (req.url === '/sync-network') {
      const result = await withSession(email, password, async (s) => {
        const members = await fetchPaginatedWithSession(s, `${API_BASE}/network-map`, { pageParam: 'page', sizeParam: 'per_page', size: 100 });
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
  console.log(`[boot] igreen-sync-worker v3 (playwright-stealth) porta ${PORT}`);
});

setInterval(async () => {
  const now = Date.now();
  for (const [email, s] of sessions) {
    if ((now - s.createdAt) > SESSION_TTL_MS) {
      console.log(`[gc] expirando sessão ${email}`);
      if (s.context) await s.context.close().catch(() => {});
      sessions.delete(email);
    }
  }
}, 60000);

process.on('SIGTERM', async () => {
  console.log('[shutdown] SIGTERM');
  for (const [, s] of sessions) {
    if (s.context) await s.context.close().catch(() => {});
  }
  sessions.clear();
  if (sharedBrowser) await sharedBrowser.close().catch(() => {});
  process.exit(0);
});
