// server.mjs — igreen-sync-worker v8 (HTTP direto, sem Tor/Playwright)
//
// Estratégia (alinhada com worker-portal/playwright-automation.mjs:826):
//   - fetch nativo do Node direto contra api-voffice.igreenenergy.com.br/v1/login
//   - Headers Origin/Referer de escritorio.igreenenergy.com.br (passa o CORS/CF)
//   - Body { email, password } → accessToken
//   - customer-map / network-map paginados com Bearer
//   - Pool de tokens em memória por email (TTL 30 min)
//
// Endpoints:
//   GET  /health
//   GET  /last-debug
//   POST /sync-customers   { portal_email, portal_password }
//   POST /sync-network     { portal_email, portal_password }

import http from 'node:http';

const PORT = parseInt(process.env.PORT || '3102', 10);
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '1800000', 10);
const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY || '';

const API_BASE = 'https://api-voffice.igreenenergy.com.br/v1';
const RECAPTCHA_SITEKEY = '6LemKQktAAAAAM626YG0ZoBi-PAbOIvwb5QD0Vi6';
const RECAPTCHA_PAGEURL = 'https://escritorio.igreenenergy.com.br/login';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Origin': 'https://escritorio.igreenenergy.com.br',
  'Referer': 'https://escritorio.igreenenergy.com.br/',
  'User-Agent': UA,
};

if (!WORKER_TOKEN) console.warn('[boot] WARN: WORKER_TOKEN não definido!');
if (!TWOCAPTCHA_API_KEY) console.warn('[boot] WARN: TWOCAPTCHA_API_KEY não definido!');


// Debug em memória
let lastDebug = { ts: null, steps: [] };
function dbg(msg) {
  console.log(msg);
  lastDebug.steps.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (lastDebug.steps.length > 80) lastDebug.steps.shift();
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function apiFetch(method, path, { body, token, timeoutMs = 45000 } = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { ...BASE_HEADERS };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

// ------------ Login + pool ------------
const sessions = new Map(); // email -> { token, consultorId, createdAt, lastUsed }

async function loginAndGetToken(email, password) {
  lastDebug = { ts: new Date().toISOString(), steps: [] };
  dbg(`[login] ${email} → POST /login`);

  let res;
  try {
    res = await apiFetch('POST', '/login', { body: { email, password }, timeoutMs: 30000 });
  } catch (e) {
    dbg(`[login] network error: ${e.message}`);
    throw new HttpError(502, `Falha de rede no login: ${e.message}`);
  }
  dbg(`[login] status=${res.status} body=${String(res.body).slice(0, 200)}`);

  if (res.status === 401 || res.status === 403) {
    throw new HttpError(401, 'Login rejeitado — email ou senha incorretos');
  }
  if (res.status === 429) {
    dbg('[login] 429 — aguardando 30s e tentando 1x');
    await new Promise(r => setTimeout(r, 30000));
    res = await apiFetch('POST', '/login', { body: { email, password }, timeoutMs: 30000 });
    if (res.status !== 200 && res.status !== 201) {
      throw new HttpError(502, `Rate-limit persistente HTTP ${res.status}`);
    }
  }
  if (res.status !== 200 && res.status !== 201) {
    throw new HttpError(502, `API login HTTP ${res.status}`);
  }

  let data;
  try { data = JSON.parse(res.body); }
  catch { throw new HttpError(502, 'Resposta de login não-JSON'); }

  const token = data.accessToken || data.token || data.access_token ||
    data?.data?.token || data?.data?.accessToken || null;
  if (!token) throw new HttpError(502, 'Login OK mas sem accessToken');

  let consultorId = String(
    data?.idconsultor || data?.consultorId || data?.consultor?.id ||
    data?.user?.idconsultor || data?.data?.idconsultor || ''
  ) || null;

  if (!consultorId) {
    try {
      const c = await apiFetch('GET', '/consultant', { token });
      dbg(`[login] /consultant status=${c.status}`);
      if (c.status === 200) {
        const cj = JSON.parse(c.body);
        consultorId = String(cj?.id || cj?.idconsultor || cj?.consultor?.id || cj?.data?.id || '') || null;
      }
    } catch (e) { dbg(`[login] /consultant erro: ${e.message}`); }
  }

  dbg(`[login] OK token=sim consultor=${consultorId}`);
  return { token, consultorId };
}

async function getOrCreateSession(email, password) {
  const now = Date.now();
  const s = sessions.get(email);
  if (s && (now - s.createdAt) < SESSION_TTL_MS) {
    s.lastUsed = now;
    return s;
  }
  const fresh = await loginAndGetToken(email, password);
  const entry = { ...fresh, createdAt: now, lastUsed: now };
  sessions.set(email, entry);
  return entry;
}

async function fetchPaginated(token, path, { pageParam = 'page', sizeParam = 'pageSize', size = 500 } = {}) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const sep = path.includes('?') ? '&' : '?';
    const full = `${path}${sep}${pageParam}=${p}&${sizeParam}=${size}`;
    let res;
    try {
      res = await apiFetch('GET', full, { token });
    } catch (e) {
      throw new HttpError(502, `Falha de rede em ${full}: ${e.message}`);
    }

    if (res.status === 429) {
      dbg(`[fetch] 429 page ${p} — aguardando 30s`);
      await new Promise(r => setTimeout(r, 30000));
      p--; continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(res.status, `Token expirado (${res.status})`);
    }
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
        mode: 'http-direct-v8',
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
      const s = await getOrCreateSession(email, password);
      if (!s.consultorId) throw new HttpError(500, 'consultor_id indisponível');
      const customers = await fetchPaginated(s.token, `/customer-map/${s.consultorId}`, { pageParam: 'page', sizeParam: 'pageSize', size: 500 });
      return send(res, 200, { ok: true, consultor_id: s.consultorId, customers });
    }

    if (req.url === '/sync-network') {
      const s = await getOrCreateSession(email, password);
      const members = await fetchPaginated(s.token, `/network-map`, { pageParam: 'page', sizeParam: 'per_page', size: 100 });
      return send(res, 200, { ok: true, consultor_id: s.consultorId, members });
    }

    return send(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    const status = e?.status || 500;
    console.error(`[err] ${req.method} ${req.url} → ${status}: ${e?.message}`);
    return send(res, status, { ok: false, error: e?.message || 'erro interno' });
  }
});

server.listen(PORT, () => {
  console.log(`[boot] igreen-sync-worker v8 (http-direct) porta ${PORT}`);
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

process.on('SIGTERM', () => { sessions.clear(); process.exit(0); });
