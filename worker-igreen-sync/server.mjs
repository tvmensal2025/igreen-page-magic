// server.mjs — igreen-sync-worker
//
// HTTP API que faz LEITURA do portal iGreen (escritorio.igreenenergy.com.br)
// usando Playwright. Mantém um pool de sessões (1 contexto por portal_email,
// TTL 30 min) pra reaproveitar cookies entre requests e evitar rate-limit / CF.
//
// Endpoints:
//   GET  /health
//   POST /sync-customers   { portal_email, portal_password }
//   POST /sync-network     { portal_email, portal_password }
//
// Auth: header X-Worker-Token (== env WORKER_TOKEN).
// NÃO fala com Supabase. Devolve JSON cru. Parsing fica na edge function.

import http from 'node:http';
import { chromium } from 'playwright-chromium';

const PORT = parseInt(process.env.PORT || '3102', 10);
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '1800000', 10); // 30 min
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '20', 10);
const HEADLESS = (process.env.PLAYWRIGHT_HEADLESS || 'true') !== 'false';

const PORTAL_LOGIN_URL = 'https://escritorio.igreenenergy.com.br/login';
const API_BASE = 'https://api-voffice.igreenenergy.com.br/v1';

if (!WORKER_TOKEN) {
  console.warn('[boot] WARN: WORKER_TOKEN não definido — endpoints ficarão abertos!');
}

// ------------ Pool de sessões ------------
/** @type {Map<string, { browser: import('playwright-chromium').Browser, context: import('playwright-chromium').BrowserContext, page: import('playwright-chromium').Page, consultorId: string|null, createdAt: number, lastUsed: number, lock: Promise<any> }>} */
const sessions = new Map();
let sharedBrowser = null;

async function getBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return sharedBrowser;
}

async function evictOldest() {
  let oldestKey = null;
  let oldestUsed = Infinity;
  for (const [k, s] of sessions) {
    if (s.lastUsed < oldestUsed) { oldestUsed = s.lastUsed; oldestKey = k; }
  }
  if (oldestKey) await destroySession(oldestKey);
}

async function destroySession(email) {
  const s = sessions.get(email);
  if (!s) return;
  sessions.delete(email);
  try { await s.context.close(); } catch {}
}

async function getOrCreateSession(email, password) {
  const now = Date.now();
  let s = sessions.get(email);
  if (s && (now - s.createdAt) > SESSION_TTL_MS) {
    await destroySession(email);
    s = null;
  }
  if (s) {
    s.lastUsed = now;
    return s;
  }
  if (sessions.size >= MAX_SESSIONS) await evictOldest();

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  console.log(`[login] ${email} → navegando para login`);
  await page.goto(PORTAL_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Form pode variar — tentamos seletores comuns
  const emailSel = 'input[type="email"], input[name="email"], input[name="usuario"], input[name="login"]';
  const passSel = 'input[type="password"]';
  await page.waitForSelector(emailSel, { timeout: 20000 });
  await page.fill(emailSel, email);
  await page.fill(passSel, password);

  const submitSel = 'button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")';
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {}),
    page.click(submitSel).catch(() => page.keyboard.press('Enter')),
  ]);

  // Heurística: se ainda estiver em /login, falhou
  const url = page.url();
  if (/\/login/i.test(url)) {
    const errText = await page.locator('body').innerText().catch(() => '');
    await destroySession(email);
    throw new HttpError(401, `Login rejeitado (URL=${url}). Trecho: ${errText.slice(0, 200)}`);
  }

  // Pega o consultor_id chamando /consultant
  let consultorId = null;
  try {
    const res = await page.request.get(`${API_BASE}/consultant`, { timeout: 20000 });
    if (res.ok()) {
      const j = await res.json();
      consultorId = String(j?.id || j?.consultor?.id || j?.data?.id || j?.idconsultor || '') || null;
    }
  } catch (e) {
    console.warn(`[login] ${email} → não consegui obter consultor_id: ${e.message}`);
  }

  s = { browser, context, page, consultorId, createdAt: now, lastUsed: now, lock: Promise.resolve() };
  sessions.set(email, s);
  console.log(`[login] ${email} → OK (consultor=${consultorId}, sessions=${sessions.size})`);
  return s;
}

// Serializa requests por sessão (evita race em cookies/CF)
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
async function fetchPaginated(page, url, { pageParam = 'page', sizeParam = 'pageSize', size = 500 } = {}) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const sep = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}${pageParam}=${p}&${sizeParam}=${size}`;
    const res = await page.request.get(full, { timeout: 60000 });
    const status = res.status();
    if (status === 429) {
      console.warn(`[fetch] 429 em page=${p} — esperando 30s e tentando 1x`);
      await new Promise((r) => setTimeout(r, 30000));
      const retry = await page.request.get(full, { timeout: 60000 });
      if (!retry.ok()) throw new HttpError(retry.status(), `429 persistente em ${full}`);
      const j2 = await retry.json();
      const arr2 = extractArray(j2);
      all.push(...arr2);
      if (arr2.length < size) break;
      continue;
    }
    if (status === 401 || status === 403) throw new HttpError(status, `Sessão expirada (${status}) em ${full}`);
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

// ------------ HTTP ------------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8') || '{}';
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
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
      return send(res, 200, { ok: true, sessions: sessions.size, uptime_s: Math.round((Date.now() - bootAt) / 1000) });
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
        const customers = await fetchPaginated(
          s.page,
          `${API_BASE}/customer-map/${s.consultorId}`,
          { pageParam: 'page', sizeParam: 'pageSize', size: 500 },
        );
        return { ok: true, consultor_id: s.consultorId, customers };
      });
      return send(res, 200, result);
    }

    if (req.url === '/sync-network') {
      const result = await withSession(email, password, async (s) => {
        const members = await fetchPaginated(
          s.page,
          `${API_BASE}/network-map`,
          { pageParam: 'page', sizeParam: 'per_page', size: 100 },
        );
        return { ok: true, consultor_id: s.consultorId, members };
      });
      return send(res, 200, result);
    }

    return send(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    const status = e?.status || 500;
    console.error(`[err] ${req.method} ${req.url} → ${status}: ${e?.message}`);
    return send(res, status, { ok: false, error: e?.message || 'erro' });
  }
});

server.listen(PORT, () => {
  console.log(`[boot] igreen-sync-worker ouvindo na porta ${PORT} (headless=${HEADLESS})`);
});

// GC de sessões expiradas
setInterval(async () => {
  const now = Date.now();
  for (const [email, s] of sessions) {
    if ((now - s.createdAt) > SESSION_TTL_MS) {
      console.log(`[gc] expirando sessão ${email}`);
      await destroySession(email);
    }
  }
}, 60000);

process.on('SIGTERM', async () => {
  console.log('[shutdown] SIGTERM');
  for (const email of Array.from(sessions.keys())) await destroySession(email);
  if (sharedBrowser) try { await sharedBrowser.close(); } catch {}
  process.exit(0);
});
