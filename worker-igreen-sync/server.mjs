// server.mjs — igreen-sync-worker v14
//
// Pipeline:
//   1. Playwright lança Chromium via Tor SOCKS5  → IP residencial passa Cloudflare
//   2. Abre https://escritorio.igreenenergy.com.br/login           (recebe cf_clearance)
//   3. 2captcha resolve o reCAPTCHA v2 do widget                   (~15-60s)
//   4. Injeta o token + preenche email/senha + clica "Entrar"
//   5. Intercepta a response do POST /v1/login; se o clique não chamar a API,
//      faz fallback com context.request.post (fora do CORS do navegador)
//   6. Extrai accessToken e reusa o page.context() para chamar /customer-map paginado
//
// Debug visual (NOVO):
//   - cada step crítico tira screenshot → envia para Lovable AI Gateway (Gemini)
//   - resposta IA fica no /last-debug junto do passo
//   - GET /last-screenshot devolve o PNG do último step
//
// Endpoints:
//   GET  /health
//   GET  /last-debug         JSON com steps + análise IA
//   GET  /last-screenshot    PNG bruto do último step
//   POST /sync-customers     { portal_email, portal_password }
//   POST /sync-network       { portal_email, portal_password }

import http from 'node:http';
import { chromium } from 'playwright-chromium';

const PORT = parseInt(process.env.PORT || '3102', 10);
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '1800000', 10);
const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const TOR_PROXY = process.env.TOR_SOCKS_PROXY || 'socks5://127.0.0.1:9050';

const PORTAL_URL = 'https://escritorio.igreenenergy.com.br/login';
const API_BASE = 'https://api-voffice.igreenenergy.com.br/v1';
const RECAPTCHA_SITEKEY = '6LemKQktAAAAAM626YG0ZoBi-PAbOIvwb5QD0Vi6';

if (!WORKER_TOKEN) console.warn('[boot] WARN: WORKER_TOKEN não definido!');
if (!TWOCAPTCHA_API_KEY) console.warn('[boot] WARN: TWOCAPTCHA_API_KEY não definido!');
if (!OPENAI_API_KEY) console.warn('[boot] WARN: OPENAI_API_KEY não definido (debug visual desativado)');

// ---------- Debug ----------
let lastDebug = { ts: null, steps: [] };
let lastScreenshot = null; // Buffer PNG

function dbg(msg) {
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  console.log(line);
  lastDebug.steps.push(line);
  if (lastDebug.steps.length > 200) lastDebug.steps.shift();
}

class HttpError extends Error {
  constructor(status, message, code = null) { super(message); this.status = status; this.code = code; }
}

async function readResponseLike(resp) {
  const headers = typeof resp.headers === 'function' ? resp.headers() : {};
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); }
  catch { body = { raw: String(text || '').slice(0, 1200) }; }
  return { status: resp.status(), body, contentType };
}

function isHtmlResponse(data) {
  const contentType = String(data?.contentType || '').toLowerCase();
  const raw = String(data?.body?.raw || '');
  return contentType.includes('text/html') || /<!doctype html|<html[\s>]/i.test(raw);
}

function bodyPreview(body) {
  return JSON.stringify(body || {}).slice(0, 300);
}

// ---------- IA Vision (OpenAI Vision direto) ----------
async function describeScreenshot(pngBuffer, stepName) {
  if (!OPENAI_API_KEY) return null;
  try {
    const b64 = pngBuffer.toString('base64');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `Step "${stepName}" do worker iGreen. Descreva em 1 frase curta em PT-BR o que está visível: formulário de login, mensagem de erro, página de bloqueio Cloudflare ("Sorry, you have been blocked"), dashboard pós-login, captcha não marcado, etc.` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        }],
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json();
    if (!res.ok) return `(IA vision ${res.status}: ${j?.error?.message || 'erro'})`;
    return j?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    return `(IA vision falhou: ${e.message})`;
  }
}

async function snapStep(page, stepName) {
  try {
    const png = await page.screenshot({ type: 'png', fullPage: false });
    lastScreenshot = png;
    const desc = await describeScreenshot(png, stepName);
    dbg(`[step] ${stepName} → ${desc || '(sem IA)'}`);
  } catch (e) {
    dbg(`[step] ${stepName} → snapshot falhou: ${e.message}`);
  }
}

// ---------- 2captcha ----------
async function solveRecaptcha() {
  if (!TWOCAPTCHA_API_KEY) throw new HttpError(500, 'TWOCAPTCHA_API_KEY não configurada');
  dbg('[captcha] solicitando 2captcha…');
  const inUrl = `https://2captcha.com/in.php?key=${TWOCAPTCHA_API_KEY}` +
    `&method=userrecaptcha&googlekey=${RECAPTCHA_SITEKEY}` +
    `&pageurl=${encodeURIComponent(PORTAL_URL)}&json=1`;
  const inRes = await fetch(inUrl, { signal: AbortSignal.timeout(20000) });
  const inJson = await inRes.json().catch(() => ({}));
  if (inJson.status !== 1) {
    throw new HttpError(502, `2captcha in.php falhou: ${inJson.request || inRes.status}`);
  }
  const id = inJson.request;
  dbg(`[captcha] id=${id}, aguardando solução…`);
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const r = await fetch(`https://2captcha.com/res.php?key=${TWOCAPTCHA_API_KEY}&action=get&id=${id}&json=1`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (j.status === 1) {
      dbg(`[captcha] resolvido em ${(i + 1) * 5}s`);
      return j.request;
    }
    if (j.request && j.request !== 'CAPCHA_NOT_READY') {
      throw new HttpError(502, `2captcha res.php erro: ${j.request}`);
    }
  }
  throw new HttpError(504, '2captcha timeout (>150s)');
}

// ---------- Login Playwright ----------
const sessions = new Map(); // email → { token, consultorId, browser, context, createdAt }

async function loginWithPlaywright(email, password) {
  lastDebug = { ts: new Date().toISOString(), steps: [] };
  dbg(`[login] ${email} → iniciando browser via Tor (${TOR_PROXY})`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    proxy: { server: TOR_PROXY },
  });

  let context, page;
  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
    });
    page = await context.newPage();

    // Intercepta a response do /login para capturar o accessToken ou bloqueio HTML/CF
    let loginResponseData = null;
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('/v1/login') && resp.request().method() === 'POST') {
        try {
          loginResponseData = await readResponseLike(resp);
        } catch (e) {
          dbg(`[login] não consegui ler response /v1/login: ${e.message}`);
        }
      }
    });

    dbg('[login] abrindo página de login…');
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 30000 });
    await snapStep(page, 'abriu_login');

    dbg('[login] preenchendo credenciais');
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await snapStep(page, 'preencheu_form');

    const captchaToken = await solveRecaptcha();
    dbg('[login] injetando token no widget');
    await page.evaluate((token) => {
      const ta = document.querySelector('textarea#g-recaptcha-response') ||
                 document.querySelector('textarea[name="g-recaptcha-response"]');
      if (ta) { ta.value = token; ta.innerHTML = token; }
      if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
        const clients = window.___grecaptcha_cfg.clients;
        for (const cid of Object.keys(clients)) {
          const client = clients[cid];
          for (const k of Object.keys(client)) {
            const obj = client[k];
            if (obj && typeof obj === 'object') {
              for (const kk of Object.keys(obj)) {
                if (obj[kk] && typeof obj[kk].callback === 'function') {
                  try { obj[kk].callback(token); } catch {}
                }
              }
            }
          }
        }
      }
    }, captchaToken);
    await snapStep(page, 'injetou_captcha');

    // Confirma se o widget aparenta estar marcado; se não, clica no checkbox
    // antes de tentar o "Entrar". Cobre o caso em que apenas injetar o token
    // no textarea não dispara o callback do reCAPTCHA.
    dbg('[captcha] token injetado; verificando checkbox');
    const tokenPresent = await page.evaluate(() => {
      const ta = document.querySelector('textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
      return !!(ta && ta.value && ta.value.length > 20);
    }).catch(() => false);

    if (!tokenPresent) {
      dbg('[captcha] widget ainda não marcado; clicando checkbox antes de Entrar');
      try {
        const frame = page.frames().find(f => /recaptcha\/api2\/anchor/.test(f.url()));
        if (frame) {
          await frame.click('#recaptcha-anchor, .recaptcha-checkbox', { timeout: 5000 }).catch(() => {});
        } else {
          await page.click('.g-recaptcha, #g-recaptcha, iframe[src*="recaptcha/api2/anchor"]', { timeout: 5000 }).catch(() => {});
        }
        await page.waitForTimeout(2500);
        // Reinjeta o token caso o clique tenha resetado o widget
        await page.evaluate((token) => {
          const ta = document.querySelector('textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
          if (ta) { ta.value = token; ta.innerHTML = token; }
        }, captchaToken).catch(() => {});
      } catch (e) {
        dbg(`[captcha] clique no checkbox falhou: ${e.message}`);
      }
      await snapStep(page, 'pos_click_captcha');
    } else {
      dbg('[captcha] widget aparenta estar marcado; seguindo para Entrar');
    }

    dbg('[login] clicando "Entrar"');
    const [clickedLoginResp] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/v1/login'), { timeout: 15000 }).catch(() => null),
      page.click('button[type="submit"], button:has-text("Entrar")').catch(() => {}),
    ]);
    if (clickedLoginResp && !loginResponseData) {
      try { loginResponseData = await readResponseLike(clickedLoginResp); }
      catch (e) { dbg(`[login] response /v1/login capturada mas ilegível: ${e.message}`); }
    }
    await page.waitForTimeout(1500);

    // Fallback: se o clique não disparou /v1/login, fazer POST direto pelo contexto
    // Playwright. Isso evita o CORS que causa "TypeError: Failed to fetch" no page.evaluate.
    if (!loginResponseData) {
      dbg('[login] clique não gerou /v1/login; tentando fallback context.request.post com recaptchaToken');
      try {
        const fbResp = await context.request.post(`${API_BASE}/login`, {
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Origin': 'https://escritorio.igreenenergy.com.br',
            'Referer': PORTAL_URL,
          },
          data: { email, password, recaptchaToken: captchaToken, keepConnected: true },
          timeout: 30000,
        });
        const fb = await readResponseLike(fbResp);
        dbg(`[login] fallback status=${fb.status}${isHtmlResponse(fb) ? ' html' : ''}`);
        loginResponseData = fb;
      } catch (e) {
        dbg(`[login] fallback erro: ${e.message}`);
      }
    }
    await snapStep(page, 'pos_submit');

    if (!loginResponseData) throw new HttpError(502, 'Nenhuma response /v1/login capturada (clique + fallback falharam)', 'no_login_response');
    dbg(`[login] response /login status=${loginResponseData.status}${isHtmlResponse(loginResponseData) ? ' html' : ''}`);
    if (isHtmlResponse(loginResponseData)) {
      throw new HttpError(503, `Portal iGreen bloqueou o login automatizado (Cloudflare/WAF ${loginResponseData.status}). Use a importação manual enquanto o portal estiver bloqueando o worker.`, 'igreen_waf_blocked');
    }
    if (loginResponseData.status === 401 || loginResponseData.status === 403) {
      throw new HttpError(401, `Login rejeitado (${loginResponseData.status}): ${bodyPreview(loginResponseData.body)}`, 'invalid_credentials');
    }
    if (loginResponseData.status >= 400) {
      throw new HttpError(502, `API /login HTTP ${loginResponseData.status}: ${bodyPreview(loginResponseData.body)}`, 'login_api_error');
    }

    const data = loginResponseData.body;
    const token = data.accessToken || data.token || data.access_token ||
      data?.data?.token || data?.data?.accessToken || null;
    if (!token) throw new HttpError(502, 'Login OK mas sem accessToken');

    let consultorId = String(
      data?.idconsultor || data?.consultorId || data?.consultor?.id ||
      data?.user?.idconsultor || data?.data?.idconsultor || ''
    ) || null;

    if (!consultorId) {
      const c = await context.request.get(`${API_BASE}/consultant`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (c.ok()) {
        const cj = await c.json();
        consultorId = String(cj?.id || cj?.idconsultor || cj?.consultor?.id || cj?.data?.id || '') || null;
      }
    }

    dbg(`[login] OK consultor=${consultorId}`);
    return { token, consultorId, browser, context, createdAt: Date.now() };
  } catch (e) {
    try { await browser.close(); } catch {}
    throw e;
  }
}

async function getOrCreateSession(email, password) {
  const now = Date.now();
  const s = sessions.get(email);
  if (s && (now - s.createdAt) < SESSION_TTL_MS) return s;
  if (s) { try { await s.browser.close(); } catch {} sessions.delete(email); }
  const fresh = await loginWithPlaywright(email, password);
  sessions.set(email, fresh);
  return fresh;
}

async function fetchPaginated(session, path, { pageParam = 'page', sizeParam = 'pageSize', size = 500 } = {}) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const sep = path.includes('?') ? '&' : '?';
    const full = `${API_BASE}${path}${sep}${pageParam}=${p}&${sizeParam}=${size}`;
    const r = await session.context.request.get(full, {
      headers: { Authorization: `Bearer ${session.token}` },
      timeout: 60000,
    });
    if (r.status() === 429) { await new Promise(s => setTimeout(s, 30000)); p--; continue; }
    if (!r.ok()) throw new HttpError(r.status(), `HTTP ${r.status()} em ${full}`);
    const j = await r.json();
    const arr = Array.isArray(j) ? j :
      Array.isArray(j?.data) ? j.data :
      Array.isArray(j?.items) ? j.items :
      Array.isArray(j?.customers) ? j.customers :
      Array.isArray(j?.members) ? j.members : [];
    all.push(...arr);
    dbg(`  page ${p}: ${arr.length} (total: ${all.length})`);
    const total = Number(j?.total || 0);
    if (arr.length < size || (total && p * size >= total)) break;
  }
  return all;
}

// ---------- HTTP ----------
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

function sendJson(res, status, obj) {
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
      return sendJson(res, 200, {
        ok: true, sessions: sessions.size,
        uptime_s: Math.round((Date.now() - bootAt) / 1000),
        mode: 'tor+playwright+2captcha-v14',
        ia_vision: Boolean(OPENAI_API_KEY),
        ia_model: OPENAI_API_KEY ? OPENAI_VISION_MODEL : null,
      });
    }
    if (req.method === 'GET' && req.url === '/last-debug') return sendJson(res, 200, lastDebug);
    if (req.method === 'GET' && req.url === '/last-screenshot') {
      if (!lastScreenshot) return sendJson(res, 404, { ok: false, error: 'sem screenshot' });
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': lastScreenshot.length });
      return res.end(lastScreenshot);
    }

    if (req.method !== 'POST') return sendJson(res, 404, { ok: false, error: 'not_found' });
    if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const body = await readJsonBody(req);
    const email = String(body.portal_email || '').trim().toLowerCase();
    const password = String(body.portal_password || '');
    if (!email || !password) return sendJson(res, 400, { ok: false, error: 'portal_email e portal_password obrigatórios' });

    if (req.url === '/sync-customers') {
      const s = await getOrCreateSession(email, password);
      if (!s.consultorId) throw new HttpError(500, 'consultor_id indisponível');
      const customers = await fetchPaginated(s, `/customer-map/${s.consultorId}`, { pageParam: 'page', sizeParam: 'pageSize', size: 500 });
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, customers });
    }
    if (req.url === '/sync-network') {
      const s = await getOrCreateSession(email, password);
      const members = await fetchPaginated(s, `/network-map`, { pageParam: 'page', sizeParam: 'per_page', size: 100 });
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, members });
    }
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (e) {
    const status = e?.status || 500;
    console.error(`[err] ${req.method} ${req.url} → ${status}: ${e?.message}`);
    return sendJson(res, status, { ok: false, error: e?.message || 'erro interno' });
  }
});

server.listen(PORT, () => {
  console.log(`[boot] igreen-sync-worker v14 (tor+playwright+2captcha+captcha-click+context-fallback) porta ${PORT}`);
});

// Garbage collect de sessões expiradas
setInterval(async () => {
  const now = Date.now();
  for (const [email, s] of sessions) {
    if ((now - s.createdAt) > SESSION_TTL_MS) {
      dbg(`[gc] expirando sessão ${email}`);
      try { await s.browser.close(); } catch {}
      sessions.delete(email);
    }
  }
}, 60000);

process.on('SIGTERM', async () => {
  for (const [, s] of sessions) { try { await s.browser.close(); } catch {} }
  process.exit(0);
});
