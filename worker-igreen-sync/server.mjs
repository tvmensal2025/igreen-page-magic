// server.mjs — igreen-sync-worker v5
//
// Proxy duplo para contornar Cloudflare WAF:
//   1. CF_PROXY_URL: Cloudflare Worker proxy (gratuito, melhor opção)
//   2. SCRAPER_API_KEY: ScraperAPI fallback
//   3. Direto (para testes locais sem CF)
//
// Endpoints:
//   GET  /health
//   POST /sync-customers   { portal_email, portal_password }
//   POST /sync-network     { portal_email, portal_password }

import http from 'node:http';

const PORT = parseInt(process.env.PORT || '3102', 10);
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '1800000', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '20', 10);
const CF_PROXY_URL = (process.env.CF_PROXY_URL || '').replace(/\/$/, '');
const CF_PROXY_SECRET = process.env.CF_PROXY_SECRET || '';
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

const API_BASE = 'https://api-main.igreenenergy.com.br/v1';

if (!WORKER_TOKEN) console.warn('[boot] WARN: WORKER_TOKEN não definido!');

const proxyMode = CF_PROXY_URL ? 'cloudflare-worker' : SCRAPER_API_KEY ? 'scraperapi' : 'direct';
console.log(`[boot] proxy mode: ${proxyMode}`);

// ------------ Fetch via proxy (CF Worker ou ScraperAPI) ------------
async function proxiedFetch(url, options = {}) {
  const { method = 'GET', headers = {}, body = null } = options;

  if (CF_PROXY_URL && CF_PROXY_SECRET) {
    // Cloudflare Worker proxy
    const proxyHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Proxy-Secret': CF_PROXY_SECRET,
      'X-Target-Path': new URL(url).pathname + new URL(url).search,
      ...headers,
    };

    const fetchOpts = {
      method,
      headers: proxyHeaders,
      signal: AbortSignal.timeout(60000),
    };
    if (body) fetchOpts.body = body;

    return fetch(CF_PROXY_URL, fetchOpts);
  }

  if (SCRAPER_API_KEY) {
    // ScraperAPI proxy
    const scraperUrl = `https://api.scraperapi.com/?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=false`;
    const fetchOpts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      },
      signal: AbortSignal.timeout(60000),
    };
    if (body) fetchOpts.body = body;
    return fetch(scraperUrl, fetchOpts);
  }

  // Direto (local/dev)
  const fetchOpts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...headers },
    signal: AbortSignal.timeout(60000),
  };
  if (body) fetchOpts.body = body;
  return fetch(url, fetchOpts);
}

// ------------ Login ------------
async function apiLogin(email, password) {
  const payloads = [
    { email, password },
    { login: email, senha: password },
    { email, senha: password },
    { usuario: email, senha: password },
  ];

  const loginPaths = [
    '/v1/auth/login',
    '/v1/login',
    '/auth/login',
    '/login',
  ];

  for (const path of loginPaths) {
    const url = `https://api-main.igreenenergy.com.br${path}`;
    for (const payload of payloads) {
      try {
        const res = await proxiedFetch(url, {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (res.status === 404 || res.status === 405) continue;

        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch { continue; }

        const token = data?.token || data?.access_token || data?.accessToken ||
          data?.data?.token || data?.data?.access_token || data?.jwt;

        if (token && res.ok) {
          console.log(`[login] ${email} → OK via ${path}`);
          return token;
        }

        if (res.status === 401 || res.status === 403) {
          const msg = data?.message || data?.error || data?.msg || 'Credenciais inválidas';
          throw new HttpError(401, `Login rejeitado: ${msg}`);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        console.warn(`[login] tentativa ${path} falhou: ${e.message}`);
      }
    }
  }

  throw new HttpError(401, 'Não foi possível autenticar. Verifique email e senha.');
}

// ------------ Busca consultor_id ------------
async function fetchConsultorId(token) {
  try {
    const res = await proxiedFetch(`${API_BASE}/consultant`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return String(j?.id || j?.consultor?.id || j?.data?.id || j?.idconsultor || '') || null;
  } catch { return null; }
}

// ------------ Pool de sessões ------------
const sessions = new Map();

async function evictOldest() {
  let oldestKey = null, oldestUsed = Infinity;
  for (const [k, s] of sessions) {
    if (s.lastUsed < oldestUsed) { oldestUsed = s.lastUsed; oldestKey = k; }
  }
  if (oldestKey) sessions.delete(oldestKey);
}

async function getOrCreateSession(email, password) {
  const now = Date.now();
  let s = sessions.get(email);
  if (s && (now - s.createdAt) > SESSION_TTL_MS) { sessions.delete(email); s = null; }
  if (s) { s.lastUsed = now; return s; }
  if (sessions.size >= MAX_SESSIONS) await evictOldest();

  const token = await apiLogin(email, password);
  const consultorId = await fetchConsultorId(token);

  s = { token, consultorId, createdAt: now, lastUsed: now, lock: Promise.resolve() };
  sessions.set(email, s);
  console.log(`[session] ${email} → criada (consultor=${consultorId})`);
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

// ------------ Coleta paginada ------------
async function fetchPaginated(token, url, { pageParam = 'page', sizeParam = 'pageSize', size = 500 } = {}) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const sep = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}${pageParam}=${p}&${sizeParam}=${size}`;

    let res;
    try {
      res = await proxiedFetch(full, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (e) {
      throw new HttpError(500, `Erro de rede: ${e.message}`);
    }

    const status = res.status;
    if (status === 429) {
      console.warn(`[fetch] 429 — aguardando 30s`);
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }
    if (status === 401 || status === 403) throw new HttpError(status, `Token expirado (${status})`);
    if (!res.ok) throw new HttpError(status, `HTTP ${status} em ${full}`);

    const j = await res.json();
    const arr = Array.isArray(j) ? j :
      Array.isArray(j?.data) ? j.data :
      Array.isArray(j?.items) ? j.items :
      Array.isArray(j?.results) ? j.results :
      Array.isArray(j?.customers) ? j.customers :
      Array.isArray(j?.members) ? j.members : [];
    all.push(...arr);
    console.log(`  page ${p}: ${arr.length} itens`);
    if (arr.length < size) break;
  }
  return all;
}

// ------------ HTTP server ------------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
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
      return send(res, 200, {
        ok: true, sessions: sessions.size,
        uptime_s: Math.round((Date.now() - bootAt) / 1000),
        mode: proxyMode,
        cf_proxy: !!CF_PROXY_URL,
        scraper: !!SCRAPER_API_KEY,
      });
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
  console.log(`[boot] igreen-sync-worker v5 (${proxyMode}) porta ${PORT}`);
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

process.on('SIGTERM', () => {
  sessions.clear();
  process.exit(0);
});
