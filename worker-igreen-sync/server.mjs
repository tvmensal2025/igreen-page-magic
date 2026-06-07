// server.mjs — igreen-sync-worker v7
//
// AUDITORIA (2026-06-07): o portal NÃO precisa de captcha para login.
// O reCAPTCHA só existe na PÁGINA da SPA (escritorio.../login). A API REST por
// trás (api-voffice.igreenenergy.com.br/v1/login) aceita {email,password} e
// devolve accessToken — sem captcha. Padrão comprovado em worker-portal/.
//
// Estratégia:
//   - Chromium via Tor SOCKS5 (IP residencial → passa reputação do Cloudflare)
//   - Navega numa página igreenenergy (seta cookie cf_clearance)
//   - Chama a API via page.evaluate(fetch) → usa TLS fingerprint do browser real
//     + cf_clearance → Cloudflare devolve 200 (fetch cru do Node leva 403)
//   - login → accessToken → customer-map / network-map (tudo via page.evaluate)
//
// Endpoints:
//   GET  /health
//   GET  /last-debug
//   POST /sync-customers   { portal_email, portal_password }
//   POST /sync-network     { portal_email, portal_password }

import http from 'node:http';
import { chromium } from 'playwright-chromium';

const PORT = parseInt(process.env.PORT || '3102', 10);
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '1800000', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '20', 10);
const PLAYWRIGHT_HEADLESS = (process.env.PLAYWRIGHT_HEADLESS || 'true') !== 'false';

const API_ORIGIN = 'https://api-voffice.igreenenergy.com.br';
const API_BASE = `${API_ORIGIN}/v1`;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

if (!WORKER_TOKEN) console.warn('[boot] WARN: WORKER_TOKEN não definido!');

// Debug em memória (acessível via GET /last-debug)
let lastDebug = { ts: null, steps: [] };
function dbg(msg) {
  console.log(msg);
  lastDebug.steps.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (lastDebug.steps.length > 60) lastDebug.steps.shift();
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

// Espera o Cloudflare liberar (Tor usa IPs residenciais — deve passar).
async function waitCloudflare(page) {
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const title = await page.title().catch(() => '');
    const body = await page.locator('body').innerText().catch(() => '');
    dbg(`[cf] [${i + 1}/15] title="${title}" url=${page.url()}`);
    const blocked = title.includes('Attention Required') || title.includes('Just a moment') ||
      body.includes('Checking your browser') || body.includes('Verifying you are human') ||
      body.includes('Enable JavaScript and cookies');
    // Liberado: não é desafio CF. O domínio da API pode devolver JSON (sem title),
    // então não exigimos title — basta não estar no desafio.
    if (!blocked) return true;
    if (i === 14) throw new HttpError(503, 'Cloudflare bloqueou via Tor');
  }
  return false;
}

// Faz uma chamada à API de DENTRO da página (passa pelo Cloudflare).
async function apiFetch(page, method, path, { body, token } = {}) {
  const url = `${API_BASE}${path}`;
  const result = await page.evaluate(async ({ url, method, body, token }) => {
    try {
      const headers = { 'Accept': 'application/json, text/plain, */*' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, body: text };
    } catch (e) {
      return { status: 0, body: String(e) };
    }
  }, { url, method, body, token });
  return result;
}

// ------------ Pool de sessões (browser context vivo + token JWT) ------------
const sessions = new Map();

async function evictOldest() {
  let oldestKey = null, oldestUsed = Infinity;
  for (const [k, s] of sessions) {
    if (s.lastUsed < oldestUsed) { oldestUsed = s.lastUsed; oldestKey = k; }
  }
  if (oldestKey) {
    const s = sessions.get(oldestKey);
    await s?.context?.close().catch(() => {});
    sessions.delete(oldestKey);
  }
}

async function loginAndGetToken(email, password) {
  lastDebug = { ts: new Date().toISOString(), steps: [] };
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    // Navega DIRETO no domínio da API (api-voffice tem o próprio Cloudflare).
    // Assim o fetch /login vira same-origin → sem CORS, sem "Failed to fetch".
    dbg(`[login] ${email} → navegando via Tor para ${API_ORIGIN}`);
    await page.goto(`${API_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await waitCloudflare(page);

    // Login via API REST (sem captcha) — same-origin
    dbg('[login] POST /login (same-origin)...');
    const loginRes = await apiFetch(page, 'POST', '/login', { body: { email, password } });
    dbg(`[login] status=${loginRes.status} body=${String(loginRes.body).slice(0, 200)}`);

    if (loginRes.status === 401 || loginRes.status === 403) {
      throw new HttpError(401, 'Login rejeitado — email ou senha incorretos');
    }
    if (loginRes.status !== 200 && loginRes.status !== 201) {
      throw new HttpError(502, `API login HTTP ${loginRes.status}`);
    }

    let loginData;
    try { loginData = JSON.parse(loginRes.body); }
    catch { throw new HttpError(502, 'Resposta de login não-JSON (Cloudflare?)'); }

    const token = loginData.accessToken || loginData.token || loginData.access_token ||
      loginData?.data?.token || loginData?.data?.accessToken || null;
    if (!token) throw new HttpError(502, 'Login OK mas sem accessToken na resposta');

    // consultor_id pode vir no login ou via /consultant
    let consultorId = String(
      loginData?.idconsultor || loginData?.consultorId || loginData?.consultor?.id ||
      loginData?.user?.idconsultor || loginData?.data?.idconsultor || ''
    ) || null;

    if (!consultorId) {
      const cRes = await apiFetch(page, 'GET', '/consultant', { token });
      if (cRes.status === 200) {
        try {
          const cj = JSON.parse(cRes.body);
          consultorId = String(cj?.id || cj?.idconsultor || cj?.consultor?.id || cj?.data?.id || '') || null;
        } catch { /* ignora */ }
      }
      dbg(`[login] /consultant status=${cRes.status} consultorId=${consultorId}`);
    }

    dbg(`[login] ${email} → OK! token=sim consultor=${consultorId}`);
    return { token, consultorId, context, page };
  } catch (e) {
    dbg(`[login] ERRO: ${e.message}`);
    await context.close().catch(() => {});
    throw e;
  }
}

async function getOrCreateSession(email, password) {
  const now = Date.now();
  let s = sessions.get(email);
  if (s && (now - s.createdAt) > SESSION_TTL_MS) {
    await s.context?.close().catch(() => {});
    sessions.delete(email);
    s = null;
  }
  // valida se a página ainda está viva
  if (s) {
    try { await s.page.evaluate(() => 1); }
    catch { await s.context?.close().catch(() => {}); sessions.delete(email); s = null; }
  }
  if (s) { s.lastUsed = now; return s; }
  if (sessions.size >= MAX_SESSIONS) await evictOldest();

  const { token, consultorId, context, page } = await loginAndGetToken(email, password);
  s = { token, consultorId, context, page, createdAt: now, lastUsed: now, lock: Promise.resolve() };
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

// ------------ Paginação via page.evaluate (passa Cloudflare) ------------
async function fetchPaginated(session, path, { pageParam = 'page', sizeParam = 'pageSize', size = 500 } = {}) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const sep = path.includes('?') ? '&' : '?';
    const full = `${path}${sep}${pageParam}=${p}&${sizeParam}=${size}`;
    const res = await apiFetch(session.page, 'GET', full, { token: session.token });

    if (res.status === 429) { dbg('[fetch] 429 — aguardando 30s'); await new Promise(r => setTimeout(r, 30000)); continue; }
    if (res.status === 401 || res.status === 403) throw new HttpError(res.status, `Token expirado (${res.status})`);
    if (res.status !== 200) throw new HttpError(res.status || 502, `HTTP ${res.status}`);

    let j;
    try { j = JSON.parse(res.body); } catch { throw new HttpError(502, 'Resposta não-JSON'); }
    const arr = Array.isArray(j) ? j :
      Array.isArray(j?.data) ? j.data :
      Array.isArray(j?.items) ? j.items :
      Array.isArray(j?.results) ? j.results :
      Array.isArray(j?.customers) ? j.customers :
      Array.isArray(j?.members) ? j.members : [];
    all.push(...arr);
    dbg(`  page ${p}: ${arr.length} (total: ${all.length})`);
    const total = Number(j?.total || 0);
    if (arr.length < size || (total && p * size >= total)) break;
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
        mode: 'tor-playwright-api-direct',
        tor: true,
      });
    }

    if (req.method === 'GET' && req.url === '/last-debug') {
      return send(res, 200, lastDebug);
    }

    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'not_found' });
    if (!authOk(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

    const body = await readJsonBody(req);
    const email = String(body.portal_email || '').trim().toLowerCase();
    const password = String(body.portal_password || '');
    if (!email || !password) return send(res, 400, { ok: false, error: 'portal_email e portal_password obrigatórios' });

    if (req.url === '/sync-customers') {
      const result = await withSession(email, password, async s => {
        if (!s.consultorId) throw new HttpError(500, 'consultor_id indisponível');
        const customers = await fetchPaginated(s, `/customer-map/${s.consultorId}`, { pageParam: 'page', sizeParam: 'pageSize', size: 500 });
        return { ok: true, consultor_id: s.consultorId, customers };
      });
      return send(res, 200, result);
    }

    if (req.url === '/sync-network') {
      const result = await withSession(email, password, async s => {
        const members = await fetchPaginated(s, `/network-map`, { pageParam: 'page', sizeParam: 'per_page', size: 100 });
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
  console.log(`[boot] igreen-sync-worker v7 (tor+playwright+api-direct) porta ${PORT}`);
});

setInterval(async () => {
  const now = Date.now();
  for (const [email, s] of sessions) {
    if ((now - s.createdAt) > SESSION_TTL_MS) {
      console.log(`[gc] expirando sessão ${email}`);
      await s.context?.close().catch(() => {});
      sessions.delete(email);
    }
  }
}, 60000);

process.on('SIGTERM', async () => {
  for (const [, s] of sessions) await s.context?.close().catch(() => {});
  sessions.clear();
  if (sharedBrowser) await sharedBrowser.close().catch(() => {});
  process.exit(0);
});
