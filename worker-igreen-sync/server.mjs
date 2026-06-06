// server.mjs — igreen-sync-worker v2
//
// Leitura do portal iGreen via API REST direta.
// Sem Playwright, sem Chromium, sem CAPTCHA.
// Usa fetch nativo do Node 20 + pool de tokens JWT.
//
// Endpoints:
//   GET  /health
//   POST /sync-customers   { portal_email, portal_password }
//   POST /sync-network     { portal_email, portal_password }
//
// Auth: header X-Worker-Token (== env WORKER_TOKEN).

import http from 'node:http';

const PORT = parseInt(process.env.PORT || '3102', 10);
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '1800000', 10);
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '20', 10);

const API_BASE = 'https://api-voffice.igreenenergy.com.br/v1';

const LOGIN_ENDPOINTS = [
  'https://api-voffice.igreenenergy.com.br/v1/auth/login',
  'https://api-voffice.igreenenergy.com.br/v1/login',
  'https://api-voffice.igreenenergy.com.br/auth/login',
  'https://api-voffice.igreenenergy.com.br/login',
];

if (!WORKER_TOKEN) {
  console.warn('[boot] WARN: WORKER_TOKEN não definido — endpoints ficarão abertos!');
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

// ------------ Login via API REST (sem CAPTCHA/Playwright) ------------
async function apiLogin(email, password) {
  const payloads = [
    { email, password },
    { login: email, senha: password },
    { usuario: email, senha: password },
    { email, senha: password },
  ];

  for (const loginUrl of LOGIN_ENDPOINTS) {
    for (const payload of payloads) {
      try {
        const res = await fetch(loginUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Origin': 'https://escritorio.igreenenergy.com.br',
            'Referer': 'https://escritorio.igreenenergy.com.br/',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000),
        });

        if (res.status === 404 || res.status === 405) continue;

        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch { continue; }

        const token =
          data?.token ||
          data?.access_token ||
          data?.accessToken ||
          data?.data?.token ||
          data?.data?.access_token ||
          data?.jwt ||
          null;

        if (token && res.ok) {
          console.log(`[login] ${email} → OK via ${loginUrl}`);
          return token;
        }

        if (res.status === 401 || res.status === 403) {
          const msg = data?.message || data?.error || data?.msg || 'Credenciais inválidas';
          throw new HttpError(401, `Login rejeitado: ${msg}`);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        // timeout ou rede → tenta próximo
      }
    }
  }

  throw new HttpError(401, 'Não foi possível autenticar na API do portal iGreen. Verifique email e senha.');
}

// ------------ Busca consultor_id ------------
async function fetchConsultorId(token) {
  try {
    const res = await fetch(`${API_BASE}/consultant`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return String(j?.id || j?.consultor?.id || j?.data?.id || j?.idconsultor || '') || null;
  } catch {
    return null;
  }
}

// ------------ Sessão ------------
async function getOrCreateSession(email, password) {
  const now = Date.now();
  let s = sessions.get(email);

  if (s && (now - s.createdAt) > SESSION_TTL_MS) {
    sessions.delete(email);
    s = null;
  }

  if (s) { s.lastUsed = now; return s; }
  if (sessions.size >= MAX_SESSIONS) await evictOldest();

  const token = await apiLogin(email, password);
  const consultorId = await fetchConsultorId(token);

  s = { token, consultorId, createdAt: now, lastUsed: now, lock: Promise.resolve() };
  sessions.set(email, s);
  console.log(`[session] ${email} → criada (consultor=${consultorId}, total=${sessions.size})`);
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

// ------------ Coleta paginada via API REST ------------
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
    } catch (e) {
      throw new HttpError(500, `Timeout/rede em ${full}: ${e.message}`);
    }

    const status = res.status;

    if (status === 429) {
      console.warn(`[fetch] 429 em page=${p} — esperando 30s e tentando 1x`);
      await new Promise((r) => setTimeout(r, 30000));
      const retry = await fetch(full, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(60000),
      }).catch(() => null);
      if (!retry?.ok) throw new HttpError(429, `429 persistente em ${full}`);
      const j2 = await retry.json();
      const arr2 = extractArray(j2);
      all.push(...arr2);
      if (arr2.length < size) break;
      continue;
    }

    if (status === 401 || status === 403) throw new HttpError(status, `Token expirado (${status}) em ${full}`);
    if (!res.ok) throw new HttpError(status, `HTTP ${status} em ${full}`);

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
      return send(res, 200, { ok: true, sessions: sessions.size, uptime_s: Math.round((Date.now() - bootAt) / 1000), mode: 'api-direct' });
    }

    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'not_found' });
    if (!authOk(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

    const body = await readJsonBody(req);
    const email = String(body.portal_email || '').trim().toLowerCase();
    const password = String(body.portal_password || '');
    if (!email || !password) return send(res, 400, { ok: false, error: 'portal_email e portal_password obrigatórios' });

    if (req.url === '/sync-customers') {
      const result = await withSession(email, password, async (s) => {
        if (!s.consultorId) throw new HttpError(500, 'consultor_id indisponível — verifique as credenciais');
        const customers = await fetchPaginated(s.token, `${API_BASE}/customer-map/${s.consultorId}`, { pageParam: 'page', sizeParam: 'pageSize', size: 500 });
        return { ok: true, consultor_id: s.consultorId, customers };
      });
      return send(res, 200, result);
    }

    if (req.url === '/sync-network') {
      const result = await withSession(email, password, async (s) => {
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
  console.log(`[boot] igreen-sync-worker v2 (api-direct, sem Playwright) porta ${PORT}`);
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
  console.log('[shutdown] SIGTERM');
  sessions.clear();
  process.exit(0);
});
