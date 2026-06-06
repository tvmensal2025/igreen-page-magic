// server.mjs — igreen-sync-worker v4
//
// Usa ScraperAPI como proxy para contornar Cloudflare.
// ScraperAPI rotaciona IPs residenciais automaticamente.
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
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

const API_BASE = 'https://api-voffice.igreenenergy.com.br/v1';
const SCRAPER_BASE = 'https://api.scraperapi.com/structured/submit';

if (!WORKER_TOKEN) console.warn('[boot] WARN: WORKER_TOKEN não definido!');
if (!SCRAPER_API_KEY) console.warn('[boot] WARN: SCRAPER_API_KEY não definido!');

// ------------ Fetch via ScraperAPI ------------
// O ScraperAPI rotaciona IPs residenciais, contornando o Cloudflare da iGreen.
async function scraperFetch(url, options = {}) {
  const { method = 'GET', headers = {}, body = null } = options;

  // ScraperAPI structured endpoint — aceita POST com body
  const scraperUrl = `https://api.scraperapi.com/?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=false`;

  const fetchOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...headers,
    },
    signal: AbortSignal.timeout(60000),
  };

  if (body) fetchOptions.body = body;

  const res = await fetch(scraperUrl, fetchOptions);
  return res;
}

// ------------ Login direto via ScraperAPI ------------
async function apiLogin(email, password) {
  const payloads = [
    { email, password },
    { login: email, senha: password },
    { email, senha: password },
    { usuario: email, senha: password },
  ];

  const loginUrls = [
    `${API_BASE}/auth/login`,
    `${API_BASE}/login`,
    `https://api-voffice.igreenenergy.com.br/auth/login`,
    `https://api-voffice.igreenenergy.com.br/login`,
  ];

  for (const loginUrl of loginUrls) {
    for (const payload of payloads) {
      try {
        // Usa ScraperAPI para fazer o POST passando pelo CF
        const scraperUrl = new URL('https://api.scraperapi.com/');
        scraperUrl.searchParams.set('api_key', SCRAPER_API_KEY);
        scraperUrl.searchParams.set('url', loginUrl);
        scraperUrl.searchParams.set('render', 'false');

        const res = await fetch(scraperUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-ScraperAPI-Headers': JSON.stringify({
              'Origin': 'https://escritorio.igreenenergy.com.br',
              'Referer': 'https://escritorio.igreenenergy.com.br/',
              'User-Agent': 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 Mobile Safari/537.36',
            }),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });

        if (res.status === 404 || res.status === 405) continue;

        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch { continue; }

        const token =
          data?.token || data?.access_token || data?.accessToken ||
          data?.data?.token || data?.data?.access_token || data?.jwt;

        if (token && res.ok) {
          console.log(`[login] OK via ${loginUrl}`);
          return token;
        }

        if (res.status === 401 || res.status === 403) {
          const msg = data?.message || data?.error || data?.msg || 'Credenciais inválidas';
          throw new HttpError(401, `Login rejeitado: ${msg}`);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        console.warn(`[login] tentativa falhou: ${e.message}`);
      }
    }
  }

  throw new HttpError(401, 'Não foi possível autenticar. Verifique email e senha.');
}

// ------------ GET autenticado via ScraperAPI ------------
async function apiGet(url, token) {
  const scraperUrl = new URL('https://api.scraperapi.com/');
  scraperUrl.searchParams.set('api_key', SCRAPER_API_KEY);
  scraperUrl.searchParams.set('url', url);
  scraperUrl.searchParams.set('render', 'false');

  const res = await fetch(scraperUrl.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(60000),
  });

  return res;
}

// ------------ Busca consultor_id ------------
async function fetchConsultorId(token) {
  try {
    const res = await apiGet(`${API_BASE}/consultant`, token);
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
    try { res = await apiGet(full, token); }
    catch (e) { throw new HttpError(500, `Erro de rede: ${e.message}`); }

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
        mode: 'scraperapi-proxy',
        scraper_configured: !!SCRAPER_API_KEY,
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
  console.log(`[boot] igreen-sync-worker v4 (scraperapi-proxy) porta ${PORT}`);
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
