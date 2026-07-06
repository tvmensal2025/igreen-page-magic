// server.mjs — igreen-sync-worker v17 (API nova api-vo)
//
// Pipeline:
//   1. Playwright lança Chromium via Tor SOCKS5  → IP residencial passa Cloudflare
//   2. Abre https://escritorio.igreenenergy.com.br/login           (recebe cf_clearance)
//   3. (reCAPTCHA é OPCIONAL agora — só resolve via 2captcha se o widget existir)
//   4. Preenche email/senha + clica "Entrar"
//   5. Intercepta a response do POST /v1/auth/session; fallback context.request.post
//   6. Extrai token (data.token) e reusa o context() para chamar a API nova:
//        - /crm/green                → clientes (Kanban achatado)
//        - /network-map/data?month=  → rede completa
//        - /painel/* + /rotinas/*    → métricas e rotinas de gestão
//
// Endpoints HTTP do worker:
//   GET  /health
//   GET  /last-debug         JSON com steps + análise IA
//   GET  /last-screenshot    PNG bruto do último step
//   POST /sync-customers     { portal_email, portal_password }
//   POST /sync-network       { portal_email, portal_password, month? }
//   POST /sync-metrics       { portal_email, portal_password, month? }
//   POST /enrich-batch       { portal_email, portal_password, codigos: [...] }
//   POST /sync-all           { portal_email, portal_password, month? }  (recomendado)

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { chromium } from 'playwright-chromium';

const PORT = parseInt(process.env.PORT || '3102', 10);
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '1800000', 10);
const TWOCAPTCHA_API_KEY = process.env.TWOCAPTCHA_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const TOR_PROXY = process.env.TOR_SOCKS_PROXY || 'socks5://127.0.0.1:9050';
const TOR_CONTROL_HOST = process.env.TOR_CONTROL_HOST || '127.0.0.1';
const TOR_CONTROL_PORT = parseInt(process.env.TOR_CONTROL_PORT || '9051', 10);
const TOR_COOKIE_PATH = process.env.TOR_COOKIE_PATH || '/tmp/tor-data/control_auth_cookie';

const PORTAL_URL = 'https://escritorio.igreenenergy.com.br/login';
// Portal novo (Virtual Office). Antes era api-voffice + /v1/login; migrou para
// api-vo + /v1/auth/session (sem reCAPTCHA). Ver ESTRATEGIA_CAPTURA_TOTAL_IGREEN.md.
const API_BASE = 'https://api-vo.igreenenergy.com.br/v1';
const AUTH_PATH = '/auth/session';
// Sitekey só é usada se o portal voltar a exigir reCAPTCHA (hoje não exige).
const RECAPTCHA_SITEKEY = '6LemKQktAAAAAM626YG0ZoBi-PAbOIvwb5QD0Vi6';
const LOGIN_MAX_ATTEMPTS = parseInt(process.env.IGREEN_LOGIN_MAX_ATTEMPTS || '4', 10);
const OPERATION_LOCK_TTL_MS = parseInt(process.env.OPERATION_LOCK_TTL_MS || '480000', 10); // 8min
const WAF_COOLDOWN_MS = parseInt(process.env.WAF_COOLDOWN_MS || '300000', 10); // 5min por e-mail
const TOR_ROTATE_MIN_INTERVAL_MS = parseInt(process.env.TOR_ROTATE_MIN_INTERVAL_MS || '10000', 10);

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

function stableIntId(input) {
  const s = String(input || '').trim();
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function getAny(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== '') return obj[key];
    const found = Object.keys(obj).find((k) => k.toLowerCase() === String(key).toLowerCase());
    if (found && obj[found] != null && obj[found] !== '') return obj[found];
  }
  return null;
}

function firstArrayPayload(j) {
  if (Array.isArray(j)) return j;
  const candidates = [
    j?.data?.items, j?.data?.data, j?.data?.rows, j?.data?.clientes,
    j?.data?.apolices, j?.data?.linhas, j?.data?.licenciados,
    j?.items, j?.rows, j?.clientes, j?.apolices, j?.linhas, j?.licenciados,
    j?.data,
  ];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

function totalFromPayload(j) {
  return Number(j?.data?.total ?? j?.total ?? j?.meta?.total ?? j?.pagination?.total ?? 0) || 0;
}

async function fetchPaged(session, basePath, { perPage = 100, maxPages = 30 } = {}) {
  const all = [];
  const diag = { path: basePath, pages: 0, items: 0, total: 0, error: null };
  for (let page = 1; page <= maxPages; page++) {
    const sep = basePath.includes('?') ? '&' : '?';
    const path = `${basePath}${sep}page=${page}&perPage=${perPage}&pageSize=${perPage}&limit=${perPage}&search=`;
    try {
      const j = await apiGet(session, path);
      const items = firstArrayPayload(j);
      const total = totalFromPayload(j);
      diag.pages = page;
      diag.items += items.length;
      if (total) diag.total = total;
      all.push(...items);
      if (items.length < perPage || (total && page * perPage >= total)) break;
    } catch (e) {
      diag.error = e.message;
      break;
    }
  }
  return { items: all, diagnostics: diag };
}

function mergeByKey(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const cur = map.get(key) || {};
    map.set(key, { ...cur, ...item });
  }
  return Array.from(map.values());
}

async function classifyPortalPage(page) {
  try {
    return await page.evaluate(() => {
      const txt = (document.body?.innerText || '').slice(0, 3000);
      const title = document.title || '';
      const hasEmail = !!document.querySelector('input[type="email"], input[name="email"]');
      const hay = `${title}\n${txt}`.toLowerCase();
      if (hasEmail) return { kind: 'login', title, sample: txt.slice(0, 500) };
      if (/cloudflare|attention required|sorry, you have been blocked|access denied|ray id|challenge/.test(hay)) {
        return { kind: 'waf', title, sample: txt.slice(0, 500) };
      }
      if (/erro de rede|network error|failed to fetch|não foi possível|nao foi possivel|temporariamente indisponível|temporariamente indisponivel/.test(hay)) {
        return { kind: 'network', title, sample: txt.slice(0, 500) };
      }
      return { kind: 'unknown', title, sample: txt.slice(0, 500) };
    });
  } catch (e) {
    return { kind: 'unknown', title: '', sample: `evaluate failed: ${e.message}` };
  }
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
async function solveRecaptcha(sitekey = RECAPTCHA_SITEKEY) {
  if (!TWOCAPTCHA_API_KEY) throw new HttpError(500, 'TWOCAPTCHA_API_KEY não configurada');
  dbg('[captcha] solicitando 2captcha…');
  const inUrl = `https://2captcha.com/in.php?key=${TWOCAPTCHA_API_KEY}` +
    `&method=userrecaptcha&googlekey=${sitekey}` +
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
const loginLocks = new Map();
const operationLocks = new Map(); // email → { promise, startedAt, queued }
const wafCooldowns = new Map();   // email → expiresAt (ms)
let lastTorRotateAt = 0;

// ---------- Tor NEWNYM (troca de circuito) ----------
async function rotateTorCircuit(reason = 'waf') {
  const now = Date.now();
  if (now - lastTorRotateAt < TOR_ROTATE_MIN_INTERVAL_MS) {
    dbg(`[tor] rotate skip (throttle, last ${Math.round((now - lastTorRotateAt)/1000)}s atrás)`);
    return false;
  }
  lastTorRotateAt = now;
  return await new Promise((resolve) => {
    let cookieHex = '';
    try {
      const cookie = fs.readFileSync(TOR_COOKIE_PATH);
      cookieHex = cookie.toString('hex').toUpperCase();
    } catch (e) {
      dbg(`[tor] cookie leitura falhou (${TOR_COOKIE_PATH}): ${e.message}`);
      return resolve(false);
    }
    const sock = net.createConnection({ host: TOR_CONTROL_HOST, port: TOR_CONTROL_PORT }, () => {
      sock.write(`AUTHENTICATE ${cookieHex}\r\nSIGNAL NEWNYM\r\nQUIT\r\n`);
    });
    let buf = '';
    const timer = setTimeout(() => {
      try { sock.destroy(); } catch {}
      dbg(`[tor] rotate timeout`);
      resolve(false);
    }, 4000);
    sock.on('data', (chunk) => { buf += chunk.toString(); });
    sock.on('end', () => {
      clearTimeout(timer);
      const ok = /250 OK[\s\S]*250 OK/.test(buf);
      dbg(`[tor] NEWNYM (${reason}) → ${ok ? 'ok' : 'falhou'} :: ${buf.replace(/\s+/g,' ').slice(0,120)}`);
      resolve(ok);
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      dbg(`[tor] control socket erro: ${e.message}`);
      resolve(false);
    });
  });
}

// ---------- Preflight: verifica se a página de login vem bloqueada pelo CF ----------
// Usa Playwright leve (request context via Tor) porque undici não aceita
// SOCKS proxy nativamente. Só é chamado entre retries — custo controlado.
async function preflightPortalCheck() {
  const useTor = TOR_PROXY && !['none', 'direct', 'off', ''].includes(String(TOR_PROXY).toLowerCase());
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
      ...(useTor ? { proxy: { server: TOR_PROXY } } : {}),
    });
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const res = await ctx.request.get(PORTAL_URL, { timeout: 15000, failOnStatusCode: false });
    const status = res.status();
    const text = await res.text().catch(() => '');
    const lower = text.toLowerCase();
    const blocked = status === 403 || /sorry, you have been blocked|attention required|cloudflare|access denied|ray id/.test(lower);
    return { blocked, status, sample: text.slice(0, 200) };
  } catch (e) {
    return { blocked: false, unknown: true, reason: e?.message || String(e) };
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}

// ---------- WAF cooldown por e-mail ----------
function isEmailInWafCooldown(email) {
  const exp = wafCooldowns.get(String(email || '').toLowerCase());
  if (!exp) return 0;
  const remaining = exp - Date.now();
  if (remaining <= 0) { wafCooldowns.delete(String(email || '').toLowerCase()); return 0; }
  return remaining;
}
function setEmailWafCooldown(email, ms = WAF_COOLDOWN_MS) {
  wafCooldowns.set(String(email || '').toLowerCase(), Date.now() + ms);
  dbg(`[waf] cooldown ${email} por ${Math.round(ms/1000)}s`);
}


async function loginWithPlaywright(email, password) {
  lastDebug = { ts: new Date().toISOString(), steps: [] };
  // TOR_SOCKS_PROXY vazio/"none"/"direct" desativa o Tor (útil p/ teste local ou
  // quando o IP do host já passa no Cloudflare). Em produção, manter o Tor.
  const useTor = TOR_PROXY && !['none', 'direct', 'off', ''].includes(String(TOR_PROXY).toLowerCase());
  dbg(`[login] ${email} → iniciando browser${useTor ? ` via Tor (${TOR_PROXY})` : ' (sem proxy)'}`);

  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  };
  if (useTor) launchOpts.proxy = { server: TOR_PROXY };
  const browser = await chromium.launch(launchOpts);

  let context, page;
  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
    });
    page = await context.newPage();

    // Intercepta a response do /auth/session para capturar o token ou bloqueio HTML/CF
    let loginResponseData = null;
    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes(AUTH_PATH) && resp.request().method() === 'POST') {
        try {
          loginResponseData = await readResponseLike(resp);
        } catch (e) {
          dbg(`[login] não consegui ler response ${AUTH_PATH}: ${e.message}`);
        }
      }
    });

    dbg('[login] abrindo página de login…');
    try {
      await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      throw new HttpError(502, `Falha de rede ao abrir login iGreen: ${e.message}`, 'network_fetch_failed');
    }
    try {
      await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 45000 });
    } catch (e) {
      const info = await classifyPortalPage(page);
      await snapStep(page, `login_sem_campo_${info.kind}`);
      if (info.kind === 'waf') {
        throw new HttpError(503, `Portal iGreen bloqueou a tela de login (Cloudflare/WAF). ${info.sample || ''}`.slice(0, 500), 'igreen_waf_blocked');
      }
      if (info.kind === 'network') {
        throw new HttpError(502, `Portal iGreen retornou erro de rede antes do login. ${info.sample || ''}`.slice(0, 500), 'network_fetch_failed');
      }
      throw new HttpError(504, `Portal iGreen não exibiu o campo de e-mail dentro do prazo. Página: ${info.title || 'sem título'}`, 'portal_login_timeout');
    }
    await snapStep(page, 'abriu_login');

    dbg('[login] preenchendo credenciais');
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await snapStep(page, 'preencheu_form');

    // reCAPTCHA é OPCIONAL no portal novo (hoje não existe). Só resolve se o
    // widget estiver presente na página — assim não gastamos 2captcha à toa.
    let captchaToken = null;
    const hasRecaptcha = await page.evaluate(() => {
      return !!(document.querySelector('.g-recaptcha, #g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]') ||
        typeof window.grecaptcha !== 'undefined');
    }).catch(() => false);

    if (hasRecaptcha) {
      dbg('[login] reCAPTCHA detectado; resolvendo via 2captcha');
      // tenta capturar a sitekey dinâmica (fallback para a constante)
      const dynKey = await page.evaluate(() => {
        const el = document.querySelector('[data-sitekey]');
        return el ? el.getAttribute('data-sitekey') : null;
      }).catch(() => null);
      captchaToken = await solveRecaptcha(dynKey || RECAPTCHA_SITEKEY);
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
    } else {
      dbg('[login] sem reCAPTCHA na página (portal novo); seguindo direto para Entrar');
    }

    dbg('[login] clicando "Entrar"');
    const [clickedLoginResp] = await Promise.all([
      page.waitForResponse(r => r.url().includes(AUTH_PATH), { timeout: 15000 }).catch(() => null),
      page.click('button[type="submit"], button:has-text("Entrar")').catch(() => {}),
    ]);
    if (clickedLoginResp && !loginResponseData) {
      try { loginResponseData = await readResponseLike(clickedLoginResp); }
      catch (e) { dbg(`[login] response ${AUTH_PATH} capturada mas ilegível: ${e.message}`); }
    }
    await page.waitForTimeout(1500);

    // Fallback: se o clique não disparou /auth/session, faz POST de dentro da
    // página (page.evaluate) para herdar cf_clearance e evitar 403/CORS.
    if (!loginResponseData) {
      dbg(`[login] clique não gerou ${AUTH_PATH}; tentando fallback fetch in-page`);
      try {
        const payload = { email, password, keepConnected: true };
        if (captchaToken) payload.recaptchaToken = captchaToken;
        const out = await page.evaluate(async (args) => {
          try {
            const res = await fetch(args.url, {
              method: 'POST',
              headers: { 'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
              body: JSON.stringify(args.payload),
            });
            const text = await res.text();
            return { status: res.status, text, contentType: res.headers.get('content-type') || '' };
          } catch (e) { return { error: String((e && e.message) || e) }; }
        }, { url: `${API_BASE}${AUTH_PATH}`, payload });
        if (out.error) {
          dbg(`[login] fallback in-page erro: ${out.error}`);
        } else {
          let body; try { body = JSON.parse(out.text); } catch { body = { raw: String(out.text || '').slice(0, 1200) }; }
          const fb = { status: out.status, contentType: out.contentType, body };
          dbg(`[login] fallback status=${fb.status}${isHtmlResponse(fb) ? ' html' : ''}`);
          loginResponseData = fb;
        }
      } catch (e) {
        dbg(`[login] fallback erro: ${e.message}`);
      }
    }
    await snapStep(page, 'pos_submit');

    if (!loginResponseData) {
      const info = await classifyPortalPage(page);
      const code = info.kind === 'waf' ? 'igreen_waf_blocked' : info.kind === 'network' ? 'network_fetch_failed' : 'no_login_response';
      const status = info.kind === 'waf' ? 503 : info.kind === 'network' ? 502 : 502;
      throw new HttpError(status, `Nenhuma response ${AUTH_PATH} capturada (clique + fallback falharam). Estado: ${info.kind}. ${info.sample || ''}`.slice(0, 600), code);
    }
    dbg(`[login] response ${AUTH_PATH} status=${loginResponseData.status}${isHtmlResponse(loginResponseData) ? ' html' : ''}`);
    if (isHtmlResponse(loginResponseData)) {
      throw new HttpError(503, `Portal iGreen bloqueou o login automatizado (Cloudflare/WAF ${loginResponseData.status}). Use a importação manual enquanto o portal estiver bloqueando o worker.`, 'igreen_waf_blocked');
    }
    if (loginResponseData.status === 401 || loginResponseData.status === 403) {
      throw new HttpError(401, `Login rejeitado (${loginResponseData.status}): ${bodyPreview(loginResponseData.body)}`, 'invalid_credentials');
    }
    if (loginResponseData.status >= 400) {
      throw new HttpError(502, `API ${AUTH_PATH} HTTP ${loginResponseData.status}: ${bodyPreview(loginResponseData.body)}`, 'login_api_error');
    }

    const data = loginResponseData.body;
    // Portal novo devolve { success, data: { token, expiresIn } }
    const token = data?.data?.token || data.token || data.accessToken || data.access_token ||
      data?.data?.accessToken || null;
    if (!token) throw new HttpError(502, 'Login OK mas sem token');

    let consultorId = String(
      data?.data?.idconsultor || data?.idconsultor || data?.consultorId ||
      data?.consultor?.id || data?.user?.idconsultor || ''
    ) || null;

    if (!consultorId) {
      const cj = await page.evaluate(async ({ api, token }) => {
        try { const res = await fetch(api + '/consultant', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }); return await res.json(); } catch { return null; }
      }, { api: API_BASE, token });
      consultorId = String(cj?.data?.idconsultor || cj?.id || cj?.idconsultor || cj?.consultor?.id || '') || null;
    }

    dbg(`[login] OK consultor=${consultorId}`);
    // Guarda a `page`: as chamadas de API precisam rodar DENTRO dela (page.evaluate)
    // para herdar o cf_clearance do Cloudflare. context.request.get toma 403.
    return { token, consultorId, browser, context, page, createdAt: Date.now() };
  } catch (e) {
    try { await browser.close(); } catch {}
    throw e;
  }
}

async function getOrCreateSession(email, password) {
  const key = String(email || '').toLowerCase();
  const prev = loginLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const chained = prev.catch(() => {}).then(() => current);
  loginLocks.set(key, chained);
  await prev.catch(() => {});

  try {
    const now = Date.now();
    const s = sessions.get(email);
    if (s && (now - s.createdAt) < SESSION_TTL_MS) return s;
    if (s) { try { await s.browser.close(); } catch {} sessions.delete(email); }

    // Cooldown por e-mail: se acabamos de queimar tentativas em WAF, evita
    // torrar Playwright + IP Tor de novo. UI pode reagendar retry mais tarde.
    const cooldownLeft = isEmailInWafCooldown(email);
    if (cooldownLeft > 0) {
      throw new HttpError(503, `Portal iGreen em cooldown pós-WAF (~${Math.ceil(cooldownLeft/1000)}s). Reprocesse em instantes.`, 'igreen_waf_blocked');
    }

    let lastErr = null;
    const attempts = Math.max(1, LOGIN_MAX_ATTEMPTS);
    let wafHits = 0;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        if (attempt > 1) dbg(`[login] tentativa ${attempt}/${attempts} após falha transitória`);
        // Preflight: se a home já vem 403/CF, roda NEWNYM antes de gastar Chromium.
        if (attempt > 1 || wafHits > 0) {
          const pf = await preflightPortalCheck();
          if (pf.blocked) {
            dbg(`[preflight] portal bloqueado (${pf.status}); rotacionando circuito antes de tentar Playwright`);
            await rotateTorCircuit('preflight_waf');
            await new Promise((r) => setTimeout(r, 4000));
          }
        }
        const fresh = await loginWithPlaywright(email, password);
        sessions.set(email, fresh);
        return fresh;
      } catch (e) {
        lastErr = e;
        const isWaf = e?.code === 'igreen_waf_blocked';
        if (isWaf) {
          wafHits++;
          const rotated = await rotateTorCircuit('login_waf');
          const backoff = rotated ? (3000 + 3000 * wafHits) : (5000 + 5000 * wafHits);
          dbg(`[login] WAF hit #${wafHits} → aguardando ${Math.round(backoff/1000)}s antes de retry`);
          await new Promise((r) => setTimeout(r, backoff));
          if (attempt >= attempts) {
            setEmailWafCooldown(email);
            throw e;
          }
          continue;
        }
        const transient = ['portal_login_timeout', 'network_fetch_failed', 'no_login_response', 'tor_no_exits'].includes(e?.code);
        if (!transient || attempt >= attempts) throw e;
        await new Promise((r) => setTimeout(r, 2500 * attempt));
      }
    }
    throw lastErr || new HttpError(500, 'Falha ao criar sessão iGreen');
  } finally {
    try { release(); } catch {}
    if (loginLocks.get(key) === chained) loginLocks.delete(key);
  }
}

// Single-flight por e-mail: em vez de rejeitar (409), coalesce — o segundo
// request espera o primeiro terminar e depois executa. Sessão fica em cache,
// então a fila anda rápido. TTL evita lock preso caso o processo trave.
async function withEmailOperationLock(email, fn) {
  const key = String(email || '').toLowerCase();
  const existing = operationLocks.get(key);
  if (existing && (Date.now() - existing.startedAt) > OPERATION_LOCK_TTL_MS) {
    dbg(`[lock] descartando lock stale de ${key} (${Math.round((Date.now() - existing.startedAt)/1000)}s)`);
    operationLocks.delete(key);
  }
  const cur = operationLocks.get(key);
  const prev = cur?.promise || Promise.resolve();
  if (cur) {
    cur.queued = (cur.queued || 0) + 1;
    dbg(`[lock] ${key}: aguardando fila (queued=${cur.queued})`);
  }
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const chained = prev.catch(() => {}).then(() => current);
  const entry = { promise: chained, startedAt: Date.now(), queued: 0 };
  operationLocks.set(key, entry);
  await prev.catch(() => {});
  entry.startedAt = Date.now();
  try {
    return await fn();
  } finally {
    try { release(); } catch {}
    if (operationLocks.get(key) === entry) operationLocks.delete(key);
  }
}

// ===== Coleta de dados na nova API (api-vo) =====

// Health rolling: últimas 20 chamadas apiGet (ok/erro). Serve para o /health
// reportar se o Tor está entregando (proxy sem exits derruba tudo em 403/timeout).
const apiHealth = { total: 0, ok: 0, waf: 0, err: 0, last: [] };
function trackApi(ev) {
  apiHealth.total++;
  if (ev === 'ok') apiHealth.ok++;
  else if (ev === 'waf') apiHealth.waf++;
  else apiHealth.err++;
  apiHealth.last.push({ t: Date.now(), ev });
  if (apiHealth.last.length > 20) apiHealth.last.shift();
}
function torLikelyBroken() {
  // Se as últimas 5 chamadas foram WAF/erro, provável Tor sem exits ou CF geral.
  const tail = apiHealth.last.slice(-5);
  return tail.length >= 5 && tail.every((x) => x.ev !== 'ok');
}

// Helper GET autenticado que devolve o JSON já parseado.
async function apiGet(session, path) {
  const out = await session.page.evaluate(async (args) => {
    try {
      const res = await fetch(args.api + args.path, { headers: { Authorization: 'Bearer ' + args.token, Accept: 'application/json' } });
      const text = await res.text();
      return { status: res.status, text, contentType: res.headers.get('content-type') || '' };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  }, { api: API_BASE, path: path, token: session.token });

  if (out.error) { trackApi('err'); throw new HttpError(502, `fetch ${path} falhou: ${out.error}`); }
  if (out.status === 429) { await new Promise((s) => setTimeout(s, 15000)); return apiGet(session, path); }
  let body;
  try { body = JSON.parse(out.text); } catch { body = { raw: String(out.text || '').slice(0, 1200) }; }
  const data = { status: out.status, contentType: out.contentType, body };
  if (isHtmlResponse(data)) {
    trackApi('waf');
    const code = torLikelyBroken() ? 'tor_no_exits' : 'igreen_waf_blocked';
    throw new HttpError(503, `Cloudflare bloqueou ${path}`, code);
  }
  if (out.status >= 400) { trackApi('err'); throw new HttpError(out.status, `HTTP ${out.status} em ${path}: ${bodyPreview(body)}`); }
  trackApi('ok');
  return body;
}

// CLIENTES: /crm/green é um Kanban { data: [ {id,label,cards:[...]} ] }.
// Achata todos os cards numa lista de clientes, anexando o status da coluna.
async function fetchCustomers(session) {
  const j = await apiGet(session, '/crm/green');
  const cols = Array.isArray(j?.data) ? j.data : [];
  const out = [];
  for (const col of cols) {
    for (const card of (col.cards || [])) {
      out.push({
        ...card,
        status_coluna: col.id,      // ex.: validado, devolutiva, reprovado...
        status_label: col.label,
      });
    }
  }

  const diagnostics = { crm_columns: cols.length, crm_cards: out.length, extra_sources: [] };
  const extraPaths = [
    '/clientes-green?status=todos&injecao=todos&tipo=todos',
    '/clientes-green/boletos?status=todos&injecao=todos&tipo=todos',
  ];
  const extra = [];
  for (const path of extraPaths) {
    const r = await fetchPaged(session, path, { perPage: 100, maxPages: 50 });
    diagnostics.extra_sources.push(r.diagnostics);
    for (const item of r.items) {
      extra.push({
        ...item,
        codigo: item.codigo ?? item.idcliente ?? item.id ?? item.codigoCliente,
        nomeCliente: item.nomeCliente ?? item.nome ?? item.cliente,
        status_coluna: item.status_coluna ?? item.status ?? item.situacao,
        status_label: item.status_label ?? item.status ?? item.situacao,
      });
    }
  }

  const merged = mergeByKey([...out, ...extra], (c) => String(c.codigo ?? c.idcliente ?? c.id ?? c.cpf ?? `${c.nomeCliente || c.nome}|${c.cidade}` ?? '').trim());
  dbg(`[customers] /crm/green: ${cols.length} colunas → ${out.length} cards; extras=${extra.length}; total=${merged.length}`);
  merged._diagnostics = diagnostics;
  return merged;
}

// REDE: /network-map/data?month=YYYY-MM devolve { data: [ ...membros ] }.
// Faz o de-para dos nomes para o formato que a edge sync-igreen-customers espera
// (idconsultor, nome, celular, idpatrocinador, nivel, data_ativo, cidade, uf,
//  cliativo, gp, gi, qtde_diretos, ...), preservando os campos ricos extras.
async function fetchNetwork(session, month) {
  const mes = month || new Date().toISOString().slice(0, 7);
  const j = await apiGet(session, `/network-map/data?month=${mes}`);
  const arr = Array.isArray(j?.data) ? j.data : [];
  const members = arr.map((m) => ({
    // campos que a edge já consome (nomes legados):
    idconsultor: m.idconsultor,
    nome: m.nome,
    celular: m.celular,
    idpatrocinador: m.patrocinador ?? m.idpatrocinador ?? null,
    nivel: m.nivel ?? 0,
    data_ativo: typeof m.dataAtivo === 'string' ? m.dataAtivo.slice(0, 10) : (m.data_ativo ?? null),
    cidade: m.cidade,
    uf: m.uf,
    cliativo: m.clientesAtivos ?? m.cliativo ?? 0,
    gp: m.gp ?? 0,
    gi: m.gi ?? 0,
    qtde_diretos: m.licenciadosDiretos ?? m.qtde_diretos ?? 0,
    // campos ricos extras (fase 2 — a edge pode passar a gravar):
    bonificavel: m.bonificavel ?? null,
    qualificavel: m.qualificavel ?? null,
    graduacao: m.graduacao ?? null,
    graduacao_expansao: m.graduacaoExpansao ?? null,
    licenciados_diretos: m.licenciadosDiretos ?? null,
    licenciados_diretos_ativos: m.licenciadosDiretosAtivos ?? null,
    diretos_pro: m.diretosPro ?? null,
    pro: m.pro ?? null,
    devolutivas: m.devolutivas ?? null,
    ag_valid: m.agValid ?? null,
  }));
  dbg(`[network] /network-map/data?month=${mes}: ${members.length} membros`);
  return members;
}

// TELECOM: /crm/telecom é um Kanban. Achata os cards + anexa financeiro das
// faturas (/telecom/faturas) casando por nome do cliente (quando possível).
async function fetchTelecomPayload(session) {
  const j = await apiGet(session, '/crm/telecom');
  const cols = Array.isArray(j?.data) ? j.data : [];
  const out = [];
  const diagnostics = {
    endpoints: ['/crm/telecom', '/telecom/faturas?status=todos&search=&page=N&perPage=100'],
    crm_columns: cols.length,
    crm_cards: 0,
    faturas_pages: 0,
    faturas_items: 0,
    faturas_error: null,
    extra_sources: [],
    extra_items: 0,
  };
  for (const col of cols) {
    for (const card of (col.cards || [])) {
      out.push({ ...card, status_coluna: col.id, status_label: col.label });
    }
  }
  diagnostics.crm_cards = out.length;
  // financeiro (faturas) — indexado por nome para enriquecer os cards; pagina de 100
  const faturasByName = new Map();
  try {
    for (let p = 1; p <= 50; p++) {
      const f = await apiGet(session, `/telecom/faturas?status=todos&search=&page=${p}&perPage=100`);
      const items = f?.data?.items || [];
      diagnostics.faturas_pages = p;
      diagnostics.faturas_items += items.length;
      for (const it of items) {
        const key = String(it.cliente || '').trim().toLowerCase();
        if (key && !faturasByName.has(key)) faturasByName.set(key, it);
      }
      const total = Number(f?.data?.total || 0);
      if (items.length < 100 || (total && p * 100 >= total)) break;
    }
  } catch (e) { diagnostics.faturas_error = e.message; dbg(`[telecom] faturas: ${e.message}`); }

  const extraPaths = [
    '/telecom/clientes?status=todos',
    '/telecom/linhas?status=todos',
    '/telecom/portabilidade?status=todos',
    '/telecom/licenciados?status=todos',
  ];
  const extra = [];
  for (const path of extraPaths) {
    const r = await fetchPaged(session, path, { perPage: 100, maxPages: 50 });
    diagnostics.extra_sources.push(r.diagnostics);
    diagnostics.extra_items += r.items.length;
    for (const item of r.items) {
      extra.push({
        ...item,
        _source_path: path,
        cliente: item.cliente ?? item.nome ?? item.nomeCliente ?? item.titular ?? item.assinante,
        numero: item.numero ?? item.linha ?? item.telefone ?? item.msisdn ?? item.celular,
        licenciado: item.licenciado ?? item.nomeLicenciado ?? item.consultor ?? item.consultorNome,
        status_coluna: item.status_coluna ?? item.status ?? item.situacao ?? item.tipo,
        status_label: item.status_label ?? item.statusLabel ?? item.status ?? item.situacao ?? item.tipo,
        _idcnxtelecom: item.idcnxtelecom ?? item.idConexao ?? item.id ?? item.codigo ?? item.idcliente,
      });
    }
  }

  for (const c of out) {
    const fat = faturasByName.get(String(c.cliente || '').trim().toLowerCase());
    if (fat) { c._fatura_valor = fat.valor; c._fatura_status = fat.status; c._fatura_mes = fat.mesReferencia; c._idcnxtelecom = fat.idcnxtelecom; }
  }
  for (const c of extra) {
    const fat = faturasByName.get(String(c.cliente || '').trim().toLowerCase());
    if (fat) { c._fatura_valor = fat.valor; c._fatura_status = fat.status; c._fatura_mes = fat.mesReferencia; c._idcnxtelecom = c._idcnxtelecom ?? fat.idcnxtelecom; }
    if (!c._idcnxtelecom) c._idcnxtelecom = stableIntId(`${c.numero || ''}|${c.cliente || ''}|${c.licenciado || ''}`);
  }
  const merged = mergeByKey([...out, ...extra], (c) => String(c._idcnxtelecom ?? c.idcnxtelecom ?? c.id ?? c.numero ?? `${c.cliente}|${c.licenciado}` || '').trim());
  dbg(`[telecom] /crm/telecom: ${out.length} cards; extras=${extra.length}; faturas=${diagnostics.faturas_items}; total=${merged.length}`);
  return { items: merged, diagnostics };
}

async function fetchTelecom(session) {
  return (await fetchTelecomPayload(session)).items;
}

// SEGUROS: /crm/seguros é um Kanban (seguro de veículo).
async function fetchSegurosPayload(session) {
  const j = await apiGet(session, '/crm/seguros');
  const cols = Array.isArray(j?.data) ? j.data : [];
  const out = [];
  const diagnostics = { endpoints: ['/crm/seguros'], crm_columns: cols.length, crm_cards: 0, extra_sources: [], extra_items: 0 };
  for (const col of cols) {
    for (const card of (col.cards || [])) {
      out.push({ ...card, status_coluna: col.id, status_label: col.label });
    }
  }
  diagnostics.crm_cards = out.length;

  const extraPaths = [
    '/seguros/apolices?status=todos',
    '/seguros/clientes?status=todos',
    '/seguros/licenciados?status=todos',
    '/seguros/comissoes?status=todos',
  ];
  const extra = [];
  for (const path of extraPaths) {
    const r = await fetchPaged(session, path, { perPage: 100, maxPages: 50 });
    diagnostics.extra_sources.push(r.diagnostics);
    diagnostics.extra_items += r.items.length;
    for (const item of r.items) {
      extra.push({
        ...item,
        _source_path: path,
        id: item.id ?? item.seguro_id ?? item.apolice_id ?? item.codigo ?? item.idcotacao,
        segurado: item.segurado ?? item.cliente ?? item.nome ?? item.nomeCliente,
        modelo: item.modelo ?? item.veiculo ?? item.descricaoVeiculo,
        placa: item.placa,
        fipe: item.fipe ?? item.valorFipe,
        mensal: item.mensal ?? item.mensalidade ?? item.valorMensal ?? item.valor,
        licenciado: item.licenciado ?? item.nomeLicenciado ?? item.consultor ?? item.consultorNome,
        status_coluna: item.status_coluna ?? item.status ?? item.situacao ?? item.tipo,
        status_label: item.status_label ?? item.statusLabel ?? item.status ?? item.situacao ?? item.tipo,
      });
    }
  }
  for (const c of extra) {
    if (!c.id) c.id = `auto:${stableIntId(`${c.segurado || ''}|${c.placa || ''}|${c.modelo || ''}|${c.licenciado || ''}`)}`;
  }
  const merged = mergeByKey([...out, ...extra], (c) => String(c.id ?? c.seguro_id ?? c.apolice_id ?? c.placa ?? `${c.segurado}|${c.modelo}` || '').trim());
  dbg(`[seguros] /crm/seguros: ${out.length} cards; extras=${extra.length}; total=${merged.length}`);
  return { items: merged, diagnostics };
}

async function fetchSeguros(session) {
  return (await fetchSegurosPayload(session)).items;
}

// BOLETOS: /clientes-green/boletos (lista paginada). Traz boletos por cliente
// com valores, vencimento, status, urls e celular. Pagina até acabar.
async function fetchBoletos(session, { perPage = 100, maxPages = 50 } = {}) {
  const all = [];
  for (let p = 1; p <= maxPages; p++) {
    const q = `status=todos&injecao=todos&tipo=todos&search=&page=${p}&perPage=${perPage}`;
    const j = await apiGet(session, `/clientes-green/boletos?${q}`);
    const items = j?.data?.items || [];
    all.push(...items);
    const total = Number(j?.data?.total || 0);
    if (items.length < perPage || (total && p * perPage >= total)) break;
  }
  dbg(`[boletos] ${all.length} boletos`);
  return all;
}

// DETALHE do cliente (ficha completa): /clientes-green/boletos/{idcliente}.
// Traz cpf, instalacao, concessionaria, dataAtivo, situacao etc. Usado para
// enriquecer clientes validados/ativos. Chamado com throttle pelo caller.
async function fetchCustomerDetail(session, idcliente) {
  const j = await apiGet(session, `/clientes-green/boletos/${idcliente}`);
  return j?.data || null;
}

// GET genérico em outra base (ex.: api-green-connection). Herda cookies/CF
// via page.evaluate igual ao apiGet padrão. Não lança em 404 — devolve null.
async function apiGetOn(session, baseUrl, path) {
  const out = await session.page.evaluate(async (args) => {
    try {
      const res = await fetch(args.api + args.path, { headers: { Authorization: 'Bearer ' + args.token, Accept: 'application/json' } });
      const text = await res.text();
      return { status: res.status, text, contentType: res.headers.get('content-type') || '' };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  }, { api: baseUrl, path, token: session.token });
  if (out.error) return null;
  if (out.status === 404 || out.status === 403 || out.status === 401) return null;
  if (out.status >= 400) return null;
  try { return JSON.parse(out.text); } catch { return null; }
}

// FICHA COMPLETA: tenta api-green-connection (endereço, PJ, procurador,
// concessionária, login/senha distribuidora). Fallback pro /clientes-green/boletos
// se o endpoint retornar null. O merge junta os campos das duas fontes.
async function fetchCustomerFull(session, idcliente) {
  const bases = [
    'https://api-green-connection.igreenenergy.com.br/v1',
    'https://api-green-connection.igreenenergy.com.br',
  ];
  let full = null;
  for (const b of bases) {
    const r = await apiGetOn(session, b, `/customers/${idcliente}`);
    const d = r?.data || r;
    if (d && typeof d === 'object' && (d.nome || d.cpf_cnpj || d.endereco || d.cep)) { full = d; break; }
  }
  let boletos = null;
  try { boletos = await fetchCustomerDetail(session, idcliente); } catch {}
  if (!full && !boletos) return null;
  return { idcliente, ...(boletos || {}), ...(full || {}) };
}

// Enrich em pool paralelo (concurrency limitada). Reduz N * latência para
// N/CONC * latência. Sem sleep entre requests — o pool já limita a taxa.
// `timeoutMs` impede um batch de segurar a Edge indefinidamente.
async function enrichMany(session, codigos, concurrency = 6, timeoutMs = 90000) {
  const out = [];
  const queue = codigos.slice();
  const deadline = Date.now() + timeoutMs;
  let active = 0;
  let settled = false;
  return await new Promise((resolve) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(out);
    };
    const timer = setTimeout(() => {
      dbg(`[enrich] timeout ${timeoutMs}ms; retornando ${out.length}/${codigos.length}`);
      queue.length = 0;
      if (active === 0) finish();
    }, timeoutMs).unref?.();
    const kick = () => {
      if (settled) return;
      if (queue.length === 0 && active === 0) {
        clearTimeout(timer);
        return finish();
      }
      while (active < concurrency && queue.length > 0 && Date.now() < deadline) {
        const id = queue.shift();
        active++;
        fetchCustomerFull(session, id)
          .then((d) => { if (d) out.push(d); })
          .catch((e) => dbg(`[enrich] ${id}: ${e.message}`))
          .finally(() => {
            active--;
            if (Date.now() >= deadline) queue.length = 0;
            kick();
          });
      }
      if (Date.now() >= deadline) queue.length = 0;
    };
    kick();
  });
}

// DEVOLUTIVAS detalhadas: combina /rotinas/devolutivas-novas (campos ricos:
// iddevolutiva, campo, obs, impeditiva, data, propria) com as categorias de
// /clientes-green/devolutivas (categoria por cliente). Casa por nome/cidade.
async function fetchDevolutivas(session, month) {
  const mes = month || new Date().toISOString().slice(0, 7);
  const out = [];
  // 1) devolutivas novas do mês (campos ricos)
  try {
    const nv = await apiGet(session, `/rotinas/devolutivas-novas?mes=${mes}`);
    for (const it of (nv?.data?.items || [])) out.push({ ...it, _fonte: 'novas' });
  } catch (e) { dbg(`[devol] novas: ${e.message}`); }
  // 2) categorias por cliente (para anexar categoria às devolutivas) — pagina de 100
  const catByCliente = new Map();
  try {
    for (let p = 1; p <= 50; p++) {
      const cats = await apiGet(session, `/clientes-green/devolutivas?categoria=todos&search=&page=${p}&perPage=100`);
      const items = cats?.data?.items || [];
      for (const it of items) {
        const key = String(it.nome || '').trim().toLowerCase();
        if (key) catByCliente.set(key, it);
      }
      const total = Number(cats?.data?.total || 0);
      if (items.length < 100 || (total && p * 100 >= total)) break;
    }
  } catch (e) { dbg(`[devol] categorias: ${e.message}`); }
  for (const d of out) {
    const cat = catByCliente.get(String(d.cliente || '').trim().toLowerCase());
    if (cat) { d._categoria = cat.categoria; d._codigo = cat.codigo; d._licenciado = cat.licenciado; }
  }
  dbg(`[devol] ${out.length} devolutivas`);
  return out;
}

// CASHBACK por origem. A API atual só aceita GREEN|TELECOM em /cashback/resumo.
// Seguros não possui endpoint público de cashback/comissão no v1; não chamamos
// rotas inválidas para evitar 400/404 recorrente nos logs. As apólices em si
// continuam sendo capturadas em fetchSeguros().
async function fetchCashback(session) {
  const res = {};
  for (const o of ['GREEN', 'TELECOM']) {
    try {
      const j = await apiGet(session, `/cashback/resumo?origem=${o}`);
      res[o.toLowerCase()] = j?.data || null;
    } catch (e) { dbg(`[cashback] ${o}: ${e.message}`); }
  }
  res.seguros = { unsupported: true, reason: 'api_v1_sem_endpoint_cashback_seguros' };
  return res;
}

// MÉTRICAS/ROTINAS: painel do líder + rotinas + resumo geral de clientes
// + painel de rede (onboarding/inativos/ranking) + resumo telecom/seguros.
// Cada chamada é tolerante a erro (não derruba o sync inteiro).
async function fetchMetrics(session, month) {
  const mes = month || new Date().toISOString().slice(0, 7);
  const safe = async (p) => { try { return await apiGet(session, p); } catch (e) { dbg(`[metrics] ${p} falhou: ${e.message}`); return null; } };
  const [
    overview, producao, resumoClientes,
    rotinaDiaria, rotinaSemanal, rotinaMensal,
    licencasExp,
    painelOnboarding, painelInativos, painelTopExp, painelRanking,
    telecomResumo, segurosResumo,
  ] = await Promise.all([
    safe('/painel/overview'),
    safe('/painel/producao'),
    safe('/clientes-green/resumo-geral'),
    safe('/rotinas/diaria'),
    safe('/rotinas/semanal'),
    safe('/rotinas/mensal'),
    safe('/painel/licencas-expirando'),
    safe('/painel/onboarding'),
    safe('/painel/inativos'),
    safe('/painel/top-expansao'),
    safe('/painel/ranking-movements'),
    safe('/telecom/resumo-geral'),
    safe('/seguros/resumo-geral'),
  ]);
  return {
    mes,
    overview: overview?.data ?? null,
    producao: producao?.data ?? null,
    resumo_clientes: resumoClientes?.data ?? null,
    rotina_diaria: rotinaDiaria?.data ?? null,
    rotina_semanal: rotinaSemanal?.data ?? null,
    rotina_mensal: rotinaMensal?.data ?? null,
    licencas_expirando: licencasExp?.data ?? null,
    painel_onboarding: painelOnboarding?.data ?? null,
    painel_inativos: painelInativos?.data ?? null,
    painel_ranking: {
      top_expansao: painelTopExp?.data ?? null,
      movements: painelRanking?.data ?? null,
    },
    telecom_resumo: telecomResumo?.data ?? null,
    seguros_resumo: segurosResumo?.data ?? null,
  };
}


// =============================================================================
// Probe genérico de endpoints da API iGreen (api-vo).
// - PROBE_ALLOWLIST: paths antigos, mantido para `/probe-endpoints` (retorna shape).
// - PROBE_FULL_CATALOG: catálogo consolidado do SPA + do worker; usado no
//   `/probe-all` para produzir status/tempo/tamanho/amostra por endpoint.
// Nenhum POST/PUT/DELETE é disparado — só GET seguro, uma vez cada.
// =============================================================================
const PROBE_ALLOWLIST = [
  '/painel/licencas-expirando', '/painel/onboarding', '/painel/inativos',
  '/painel/eventos', '/painel/top-expansao', '/painel/ranking-movements',
  '/pro-builder', '/analise-pro/summary', '/analise-retencao/summary',
  '/estatisticas-pro', '/telecom/resumo-geral', '/telecom/licenciados',
  '/seguros/resumo-geral', '/seguros/licenciados',
  '/seguros/comissoes', '/seguros/sinistros', '/seguros/renovacoes',
  '/seguros/cashback/resumo', '/crm/seguros/resumo',
  '/telecom/linhas', '/telecom/recargas', '/telecom/comissoes', '/telecom/portabilidade',
  '/financeiro/extrato', '/financeiro/saques', '/financeiro/saldo', '/financeiro/notas-fiscais',
  '/rede/qualificacoes', '/rede/graduacoes', '/rede/aniversariantes', '/rede/upgrades',
  '/clientes-green/devolutivas-resolvidas',
];

// Catálogo consolidado a partir dos bundles Vite reais do SPA
// (ClientesGreenPage, CrmPage, RotinasPage, PainelPage, RedePage, SegurosPage,
//  TelecomPage, FinanceiroLicenciadoPage, IgreenDigitalPage, LeaderProPage,
//  ProBuilderPage, PreSeniorPage, NetworkMapPage, BonusExtractPage,
//  EstatisticasPage, AnaliseRetencaoPage, RankingRedePage, ConnectionExpressPage,
//  ClientMapPage, TelecomClientMapPage, TelecomBonusExtractPage).
const PROBE_FULL_CATALOG = [
  { m: 'GET', p: '/consultant',                            cat: 'consultant' },
  { m: 'GET', p: '/consultant/activation-code',            cat: 'consultant' },
  { m: 'GET', p: '/dashboard/daily-analysis',              cat: 'dashboard' },
  { m: 'GET', p: '/dashboard/customers-by-region',         cat: 'dashboard' },
  { m: 'GET', p: '/painel/licencas-expirando',             cat: 'painel' },
  { m: 'GET', p: '/painel/onboarding',                     cat: 'painel' },
  { m: 'GET', p: '/painel/inativos',                       cat: 'painel' },
  { m: 'GET', p: '/painel/eventos',                        cat: 'painel' },
  { m: 'GET', p: '/painel/top-expansao',                   cat: 'painel' },
  { m: 'GET', p: '/painel/ranking-movements',              cat: 'painel' },
  { m: 'GET', p: '/painel/aniversariantes',                cat: 'painel' },
  { m: 'GET', p: '/painel/qualificacoes',                  cat: 'painel' },
  { m: 'GET', p: '/painel/graduacoes',                     cat: 'painel' },
  { m: 'GET', p: '/clientes-green',                        cat: 'clientes-green' },
  { m: 'GET', p: '/clientes-green/summary',                cat: 'clientes-green' },
  { m: 'GET', p: '/clientes-green/devolutivas',            cat: 'clientes-green' },
  { m: 'GET', p: '/clientes-green/devolutivas-resolvidas', cat: 'clientes-green' },
  { m: 'GET', p: '/clientes-green/boletos',                cat: 'clientes-green' },
  { m: 'GET', p: '/clientes-green/faturas',                cat: 'clientes-green' },
  { m: 'GET', p: '/clientes-green/injecao',                cat: 'clientes-green' },
  { m: 'GET', p: '/crm',                                   cat: 'crm' },
  { m: 'GET', p: '/crm/summary',                           cat: 'crm' },
  { m: 'GET', p: '/crm/leads',                             cat: 'crm' },
  { m: 'GET', p: '/crm/seguros/resumo',                    cat: 'crm' },
  { m: 'GET', p: '/crm/telecom/resumo',                    cat: 'crm' },
  { m: 'GET', p: '/rotinas',                               cat: 'rotinas' },
  { m: 'GET', p: '/rotinas/summary',                       cat: 'rotinas' },
  { m: 'GET', p: '/rotinas/tarefas',                       cat: 'rotinas' },
  { m: 'GET', p: '/rotinas/aniversariantes',               cat: 'rotinas' },
  { m: 'GET', p: '/rotinas/vencimentos',                   cat: 'rotinas' },
  { m: 'GET', p: '/rede-lider',                            cat: 'rede' },
  { m: 'GET', p: '/rede-lider/summary',                    cat: 'rede' },
  { m: 'GET', p: '/rede/qualificacoes',                    cat: 'rede' },
  { m: 'GET', p: '/rede/graduacoes',                       cat: 'rede' },
  { m: 'GET', p: '/rede/aniversariantes',                  cat: 'rede' },
  { m: 'GET', p: '/rede/upgrades',                         cat: 'rede' },
  { m: 'GET', p: '/rede/map',                              cat: 'rede' },
  { m: 'GET', p: '/rede/ranking',                          cat: 'rede' },
  { m: 'GET', p: '/network-map',                           cat: 'rede' },
  { m: 'GET', p: '/network-map/summary',                   cat: 'rede' },
  { m: 'GET', p: '/pro-builder',                           cat: 'pro' },
  { m: 'GET', p: '/pro-maker',                             cat: 'pro' },
  { m: 'GET', p: '/pro-maker/metas',                       cat: 'pro' },
  { m: 'GET', p: '/pre-senior',                            cat: 'pro' },
  { m: 'GET', p: '/pre-senior/summary',                    cat: 'pro' },
  { m: 'GET', p: '/produtos/telecom',                      cat: 'telecom' },
  { m: 'GET', p: '/telecom/resumo-geral',                  cat: 'telecom' },
  { m: 'GET', p: '/telecom/licenciados',                   cat: 'telecom' },
  { m: 'GET', p: '/telecom/linhas',                        cat: 'telecom' },
  { m: 'GET', p: '/telecom/recargas',                      cat: 'telecom' },
  { m: 'GET', p: '/telecom/comissoes',                     cat: 'telecom' },
  { m: 'GET', p: '/telecom/portabilidade',                 cat: 'telecom' },
  { m: 'GET', p: '/telecom/bonus',                         cat: 'telecom' },
  { m: 'GET', p: '/telecom/client-map',                    cat: 'telecom' },
  { m: 'GET', p: '/telecom/clientes',                      cat: 'telecom' },
  { m: 'GET', p: '/seguros',                               cat: 'seguros' },
  { m: 'GET', p: '/seguros/resumo-geral',                  cat: 'seguros' },
  { m: 'GET', p: '/seguros/licenciados',                   cat: 'seguros' },
  { m: 'GET', p: '/seguros/comissoes',                     cat: 'seguros' },
  { m: 'GET', p: '/seguros/sinistros',                     cat: 'seguros' },
  { m: 'GET', p: '/seguros/renovacoes',                    cat: 'seguros' },
  { m: 'GET', p: '/seguros/cashback/resumo',               cat: 'seguros' },
  { m: 'GET', p: '/seguros/apolices',                      cat: 'seguros' },
  { m: 'GET', p: '/seguros/clientes',                      cat: 'seguros' },
  { m: 'GET', p: '/financeiro',                            cat: 'financeiro' },
  { m: 'GET', p: '/financeiro/extrato',                    cat: 'financeiro' },
  { m: 'GET', p: '/financeiro/saques',                     cat: 'financeiro' },
  { m: 'GET', p: '/financeiro/saldo',                      cat: 'financeiro' },
  { m: 'GET', p: '/financeiro/notas-fiscais',              cat: 'financeiro' },
  { m: 'GET', p: '/financeiro/bonus',                      cat: 'financeiro' },
  { m: 'GET', p: '/cashback/resumo?origem=GREEN',          cat: 'cashback' },
  { m: 'GET', p: '/cashback/resumo?origem=TELECOM',        cat: 'cashback' },
  { m: 'GET', p: '/igreen-digital',                        cat: 'digital' },
  { m: 'GET', p: '/igreen-digital/summary',                cat: 'digital' },
  { m: 'GET', p: '/estatisticas-pro',                      cat: 'estatisticas' },
  { m: 'GET', p: '/analise-pro/summary',                   cat: 'estatisticas' },
  { m: 'GET', p: '/analise-retencao/summary',              cat: 'estatisticas' },
  { m: 'GET', p: '/connection-express',                    cat: 'connection' },
];

async function probeEndpoints(session, paths) {
  const list = Array.isArray(paths) && paths.length ? paths.filter((p) => PROBE_ALLOWLIST.includes(p)) : PROBE_ALLOWLIST;
  const results = [];
  for (const p of list) {
    try {
      const j = await apiGet(session, p);
      const sample = j?.data ?? j;
      const shape = Array.isArray(sample)
        ? { type: 'array', length: sample.length, keys: sample[0] ? Object.keys(sample[0]).slice(0, 20) : [] }
        : sample && typeof sample === 'object'
        ? { type: 'object', keys: Object.keys(sample).slice(0, 30) }
        : { type: typeof sample };
      results.push({ path: p, status: 200, shape });
    } catch (e) {
      results.push({ path: p, status: e?.status || 500, error: e?.message?.slice(0, 200) || 'erro' });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return results;
}

// /probe-all: roda o catálogo consolidado (só GET) uma vez cada.
// Retorna status/tempo/tamanho/amostra por endpoint; alimenta a tabela
// `igreen_endpoint_discovery`. Não grava body de rotas de /auth/*.
async function probeAll(session) {
  const started = Date.now();
  const results = [];
  for (const cand of PROBE_FULL_CATALOG) {
    const t0 = Date.now();
    let status = 0, ct = null, bytes = 0, sample = '', notes = '';
    try {
      const url = `${API_BASE}${cand.p}`;
      const res = await fetch(url, {
        method: cand.m,
        headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/json' },
      });
      status = res.status;
      ct = res.headers.get('content-type') || null;
      const txt = await res.text();
      bytes = Buffer.byteLength(txt);
      if (!/\/auth\//.test(cand.p)) sample = txt.slice(0, 500);
    } catch (e) {
      status = 0;
      notes = String(e?.message || e).slice(0, 200);
    }
    const ms = Date.now() - t0;
    const isAlive = status >= 200 && status < 300;
    let bucket;
    if (isAlive) bucket = 'ok';
    else if (status === 401 || status === 403) bucket = 'denied';
    else if (status === 404) bucket = 'missing';
    else if (status === 400 || status === 422) bucket = 'bad_request';
    else if (status >= 500) bucket = 'error_5xx';
    else bucket = 'unknown';
    results.push({
      method: cand.m, path: cand.p, category: cand.cat,
      status, content_type: ct, bytes, ms, sample_body: sample,
      is_alive: isAlive, bucket, notes,
    });
    await new Promise((r) => setTimeout(r, 200));
  }
  const summary = results.reduce((acc, r) => { acc[r.bucket] = (acc[r.bucket] || 0) + 1; return acc; }, {});
  return { results, summary, total: results.length, elapsed_ms: Date.now() - started };
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
      const nowT = Date.now();
      const locks = [];
      for (const [k, v] of operationLocks) {
        locks.push({ email: k, age_s: Math.round((nowT - v.startedAt) / 1000), queued: v.queued || 0 });
      }
      const cooldowns = [];
      for (const [k, v] of wafCooldowns) {
        const left = v - nowT;
        if (left > 0) cooldowns.push({ email: k, remaining_s: Math.round(left / 1000) });
      }
      return sendJson(res, 200, {
        ok: true, sessions: sessions.size,
        uptime_s: Math.round((Date.now() - bootAt) / 1000),
        mode: 'tor+playwright+api-vo-v17',
        api_base: API_BASE,
        worker_token_configured: Boolean(WORKER_TOKEN),
        twocaptcha_configured: Boolean(TWOCAPTCHA_API_KEY),
        ia_vision: Boolean(OPENAI_API_KEY),
        ia_model: OPENAI_API_KEY ? OPENAI_VISION_MODEL : null,
        tor_proxy: TOR_PROXY,
        api_health: { ...apiHealth, tor_likely_broken: torLikelyBroken() },
        operation_locks: locks,
        waf_cooldowns: cooldowns,
        last_tor_rotate_s: lastTorRotateAt ? Math.round((nowT - lastTorRotateAt) / 1000) : null,
      });
    }
    if (req.method === 'GET' && req.url === '/last-debug') return sendJson(res, 200, lastDebug);
    if (req.method === 'GET' && req.url === '/last-screenshot') {
      if (!lastScreenshot) return sendJson(res, 404, { ok: false, error: 'sem screenshot' });
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': lastScreenshot.length });
      return res.end(lastScreenshot);
    }

    // DELETE /sync-lock?email=... → limpa lock/cooldown manualmente.
    if (req.method === 'DELETE' && req.url.startsWith('/sync-lock')) {
      if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const u = new URL(req.url, 'http://x');
      const em = String(u.searchParams.get('email') || '').trim().toLowerCase();
      if (!em) return sendJson(res, 400, { ok: false, error: 'email obrigatório' });
      const hadLock = operationLocks.delete(em);
      const hadCd = wafCooldowns.delete(em);
      dbg(`[lock] limpeza manual ${em} → lock=${hadLock} cooldown=${hadCd}`);
      return sendJson(res, 200, { ok: true, cleared_lock: hadLock, cleared_cooldown: hadCd });
    }

    // POST /tor-rotate → força NEWNYM (debug).
    if (req.method === 'POST' && req.url === '/tor-rotate') {
      if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const ok = await rotateTorCircuit('manual');
      return sendJson(res, 200, { ok });
    }

    if (req.method !== 'POST') return sendJson(res, 404, { ok: false, error: 'not_found' });
    if (!authOk(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

    const body = await readJsonBody(req);
    const email = String(body.portal_email || '').trim().toLowerCase();
    const password = String(body.portal_password || '');
    if (!email || !password) return sendJson(res, 400, { ok: false, error: 'portal_email e portal_password obrigatórios' });

    return await withEmailOperationLock(email, async () => {
    if (req.url === '/sync-customers') {
      const s = await getOrCreateSession(email, password);
      const customers = await fetchCustomers(s);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, customers });
    }
    if (req.url === '/sync-network') {
      const s = await getOrCreateSession(email, password);
      const members = await fetchNetwork(s, body.month);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, members });
    }
    if (req.url === '/sync-metrics') {
      const s = await getOrCreateSession(email, password);
      const metrics = await fetchMetrics(s, body.month);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, metrics });
    }
    if (req.url === '/sync-boletos') {
      const s = await getOrCreateSession(email, password);
      const boletos = await fetchBoletos(s);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, boletos });
    }
    if (req.url === '/sync-telecom') {
      const s = await getOrCreateSession(email, password);
      const telecomPayload = await fetchTelecomPayload(s);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, telecom: telecomPayload.items, diagnostics: { telecom: telecomPayload.diagnostics } });
    }
    if (req.url === '/sync-seguros') {
      const s = await getOrCreateSession(email, password);
      const segurosPayload = await fetchSegurosPayload(s);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, seguros: segurosPayload.items, diagnostics: { seguros: segurosPayload.diagnostics } });
    }
    if (req.url === '/sync-devolutivas') {
      const s = await getOrCreateSession(email, password);
      const devolutivas = await fetchDevolutivas(s, body.month);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, devolutivas });
    }
    if (req.url === '/sync-cashback') {
      const s = await getOrCreateSession(email, password);
      const cashback = await fetchCashback(s);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, cashback });
    }
    // /enrich-batch: enriquece uma lista específica de códigos em paralelo.
    // Body: { portal_email, portal_password, codigos: [ ... ] }
    if (req.url === '/enrich-batch') {
      const codigos = Array.isArray(body.codigos) ? body.codigos.map(String).filter(Boolean) : [];
      if (codigos.length === 0) return sendJson(res, 400, { ok: false, error: 'codigos vazio' });
      const s = await getOrCreateSession(email, password);
      const details = await enrichMany(s, codigos, Number(body.concurrency) > 0 ? Number(body.concurrency) : 6, 90000);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, details, requested: codigos.length });
    }
    // /sync-all: 1 login -> tudo. `only` (array opcional) limita o que coletar
    // conforme os toggles do consultor (ex.: ['customers','network','devolutivas']).
    if (req.url === '/sync-all') {
      const s = await getOrCreateSession(email, password);
      const only = Array.isArray(body.only) && body.only.length ? new Set(body.only) : null;
      const want = (k) => !only || only.has(k);
      const [customers, members, metrics, boletos, telecomPayload, segurosPayload, devolutivas, cashback] = await Promise.all([
        want('customers') ? fetchCustomers(s).catch((e) => { dbg(`[sync-all] customers: ${e.message}`); return []; }) : Promise.resolve([]),
        want('network') ? fetchNetwork(s, body.month).catch((e) => { dbg(`[sync-all] network: ${e.message}`); return []; }) : Promise.resolve([]),
        want('metrics') ? fetchMetrics(s, body.month).catch((e) => { dbg(`[sync-all] metrics: ${e.message}`); return null; }) : Promise.resolve(null),
        want('boletos') ? fetchBoletos(s).catch((e) => { dbg(`[sync-all] boletos: ${e.message}`); return []; }) : Promise.resolve([]),
        want('telecom') ? fetchTelecomPayload(s).catch((e) => { dbg(`[sync-all] telecom: ${e.message}`); return { items: [], diagnostics: { endpoints: ['/crm/telecom', '/telecom/faturas'], error: e.message } }; }) : Promise.resolve({ items: [], diagnostics: { skipped: true } }),
        want('seguros') ? fetchSegurosPayload(s).catch((e) => { dbg(`[sync-all] seguros: ${e.message}`); return { items: [], diagnostics: { endpoints: ['/crm/seguros'], error: e.message } }; }) : Promise.resolve({ items: [], diagnostics: { skipped: true } }),
        want('devolutivas') ? fetchDevolutivas(s, body.month).catch((e) => { dbg(`[sync-all] devolutivas: ${e.message}`); return []; }) : Promise.resolve([]),
        want('cashback') ? fetchCashback(s).catch((e) => { dbg(`[sync-all] cashback: ${e.message}`); return {}; }) : Promise.resolve({}),
      ]);
      const telecom = telecomPayload.items || [];
      const seguros = segurosPayload.items || [];
      // Enriquecimento: ficha COMPLETA (endereço, CEP, bairro, número,
      // concessionária, PJ, procurador, login distribuidora) de TODOS os
      // clientes do Kanban — sem filtro de status. Pool paralelo (concurrency=6)
      // para caber dentro do timeout de 150s da edge function.
      let details = [];
      if (body.enrich === true) {
        const targets = customers.filter((c) => !!c.codigo);
        const limit = Number(body.enrich_limit) > 0 ? Math.min(targets.length, Number(body.enrich_limit)) : Math.min(targets.length, 30);
        details = await enrichMany(s, targets.slice(0, limit).map((t) => t.codigo));
        dbg(`[sync-all] enrich: ${details.length}/${limit} fichas`);
      }
      return sendJson(res, 200, {
        ok: true,
        consultor_id: s.consultorId,
        customers,
        members,
        metrics,
        boletos,
        details,
        telecom,
        seguros,
        devolutivas,
        cashback,
        diagnostics: {
          telecom: telecomPayload.diagnostics,
          seguros: segurosPayload.diagnostics,
          only: only ? Array.from(only) : null,
        },
      });
    }
    // /debug-customer-scan: dump completo do Kanban /crm/green +
    // varredura em endpoints alternativos de listagem, procurando por
    // { name?, cpf? } no body. NÃO persiste nada, só leitura.
    if (req.url === '/debug-customer-scan') {
      const s = await getOrCreateSession(email, password);
      const needleName = String(body.name || '').trim().toLowerCase();
      const needleCpf = String(body.cpf || '').replace(/\D/g, '');
      const matches = (rec) => {
        const n = String(rec?.nome || rec?.name || '').toLowerCase();
        const c = String(rec?.cpf || rec?.documento || '').replace(/\D/g, '');
        return (needleName && n.includes(needleName)) || (needleCpf && c && c === needleCpf);
      };

      // 1) Kanban oficial
      let kanban = null;
      let kanbanErr = null;
      try {
        const j = await apiGet(s, '/crm/green');
        const cols = Array.isArray(j?.data) ? j.data : [];
        const columns = cols.map((c) => ({
          id: c.id, label: c.label, count: (c.cards || []).length,
        }));
        const flat = [];
        for (const c of cols) for (const card of (c.cards || [])) flat.push({ ...card, __col: c.id });
        kanban = {
          total: flat.length,
          columns,
          matches: flat.filter(matches).slice(0, 20),
        };
      } catch (e) { kanbanErr = e.message; }

      // 2) Endpoints alternativos candidatos
      const altPaths = Array.isArray(body.paths) && body.paths.length ? body.paths : [
        '/clientes-green?page=1&perPage=1000&status=todos&search=',
        '/clientes-green?page=1&perPage=1000&search=',
        '/clientes-green/summary',
        `/customer-map/${s.consultorId}?page=1&pageSize=1000`,
        `/customer-map/${s.consultorId}`,
        '/crm/green?status=cancelado',
        '/crm/green?status=inativo',
        '/crm/green?status=todos',
      ];
      const alts = [];
      for (const p of altPaths) {
        try {
          const t0 = Date.now();
          const j = await apiGet(s, p);
          const arr =
            Array.isArray(j) ? j :
            Array.isArray(j?.data) ? j.data :
            Array.isArray(j?.data?.cards) ? j.data.cards :
            Array.isArray(j?.customers) ? j.customers :
            [];
          // Se vier estrutura Kanban (colunas), achatar
          let flat = arr;
          if (arr.length && Array.isArray(arr[0]?.cards)) {
            flat = arr.flatMap((c) => (c.cards || []).map((k) => ({ ...k, __col: c.id })));
          }
          alts.push({
            path: p,
            ms: Date.now() - t0,
            ok: true,
            total: flat.length,
            sample_keys: flat[0] ? Object.keys(flat[0]).slice(0, 20) : [],
            matches: flat.filter(matches).slice(0, 20),
          });
        } catch (e) {
          alts.push({ path: p, ok: false, error: e.message, status: e.status || null });
        }
        await new Promise((r) => setTimeout(r, 150));
      }

      return sendJson(res, 200, {
        ok: true, consultor_id: s.consultorId,
        needle: { name: needleName || null, cpf: needleCpf || null },
        kanban, kanbanErr, alternatives: alts,
      });
    }
    if (req.url === '/probe-endpoints') {
      const s = await getOrCreateSession(email, password);
      const results = await probeEndpoints(s, body.paths);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, results });
    }
    // /probe-all: varre o catálogo consolidado (só GET) e devolve status,
    // tempo, tamanho, amostra e bucket (ok/denied/missing/bad_request/error_5xx).
    // Persistência fica a cargo da Edge Function `igreen-endpoint-probe`.
    if (req.url === '/probe-all') {
      const s = await getOrCreateSession(email, password);
      const out = await probeAll(s);
      return sendJson(res, 200, { ok: true, consultor_id: s.consultorId, ...out });
    }
    // /probe-customer-detail: descobre qual endpoint da API do escritório
    // devolve o DETALHE de um cliente (endereço + licenciado ainda não mapeados).
    // Body opcional: { idcliente?: string }. Se ausente, usa o 1º de /crm/green.
    // Retorna, por candidato: status HTTP, tamanho do body, top-3-KB de amostra.
    if (req.url === '/probe-customer-detail') {
      const s = await getOrCreateSession(email, password);
      let sampleId = body.idcliente ? String(body.idcliente) : null;
      if (!sampleId) {
        const customers = await fetchCustomers(s);
        sampleId = customers[0]?.idcliente || customers[0]?.id || customers[0]?.codigo || null;
      }
      if (!sampleId) return sendJson(res, 400, { ok: false, error: 'sem clientes para amostrar; passe idcliente no body' });

      // Se o caller passar `paths` no body, usa esses paths custom (substituindo
      // {id} ou {idcliente} pelo sampleId). Senão, usa o catálogo padrão.
      const customPaths = Array.isArray(body.paths) && body.paths.length
        ? body.paths.map((p) => String(p).replace(/\{id(?:cliente)?\}/gi, sampleId))
        : null;
      const candidates = customPaths || [
        `/clientes-green/${sampleId}`,
        `/clientes-green/${sampleId}/detalhe`,
        `/clientes-green/${sampleId}/completo`,
        `/clientes-green/${sampleId}/dados-cadastrais`,
        `/clientes-green/${sampleId}/endereco`,
        `/clientes-green/detalhe/${sampleId}`,
        `/clientes-green/dados/${sampleId}`,
        `/clientes-green/endereco/${sampleId}`,
        `/clientes-green/completo/${sampleId}`,
        `/clientes-green/ficha/${sampleId}`,
        `/clientes-green/full/${sampleId}`,
        `/clientes-green/cadastro/${sampleId}`,
        `/clientes-green/perfil/${sampleId}`,
        `/crm/green/${sampleId}`,
        `/crm/green/card/${sampleId}`,
        `/crm/green/detalhe/${sampleId}`,
        `/crm/green/cliente/${sampleId}`,
        `/customer/${sampleId}`,
        `/customers/${sampleId}`,
        `/clientes/${sampleId}`,
        `/cliente/${sampleId}`,
        `/clientes/detalhe/${sampleId}`,
        `/clientes/full/${sampleId}`,
        `/clientes/ficha/${sampleId}`,
        `/consultores/cliente/${sampleId}`,
        `/licenciado/cliente/${sampleId}`,
        `/rotinas/cliente/${sampleId}`,
        `/painel/cliente/${sampleId}`,
      ];



      const results = [];
      for (const path of candidates) {
        const started = Date.now();
        const out = await s.page.evaluate(async (args) => {
          try {
            const r = await fetch(args.api + args.path, {
              headers: { Authorization: 'Bearer ' + args.token, Accept: 'application/json' },
            });
            const text = await r.text();
            return { status: r.status, size: text.length, sample: text.slice(0, 3000) };
          } catch (e) { return { status: 0, size: 0, sample: String(e?.message || e) }; }
        }, { api: API_BASE, path, token: s.token });
        results.push({
          path,
          status: out.status,
          size: out.size,
          duration_ms: Date.now() - started,
          bucket: out.status === 200 ? 'ok'
            : out.status === 401 || out.status === 403 ? 'denied'
            : out.status === 404 ? 'missing'
            : out.status >= 400 && out.status < 500 ? 'bad_request'
            : out.status >= 500 ? 'error_5xx'
            : 'other',
          sample: out.sample,
        });
        // pequeno delay para não estressar
        await new Promise(r => setTimeout(r, 200));
      }

      const winners = results.filter(r => r.bucket === 'ok');
      return sendJson(res, 200, {
        ok: true,
        consultor_id: s.consultorId,
        sample_idcliente: sampleId,
        api_base: API_BASE,
        winners: winners.map(w => w.path),
        results,
      });
    }

    // /spy-spa-detail: navega o SPA logado (escritorio.igreenenergy.com.br/clientes-green),
    // clica em um card (por idcliente/nome ou o 1º disponível) e captura TODAS as
    // requisições que o front dispara para api-vo.igreenenergy.com.br/v1/*.
    // Retorna as URLs + status + amostra do JSON, e destaca as "winners" que
    // provavelmente representam o detalhe do cliente (contêm o idcliente/nome
    // ou trazem campos de endereço/licenciado). Objetivo: descobrir o endpoint
    // real de detalhe para o próximo passo (enrich em massa).
    if (req.url === '/spy-spa-detail') {
      const s = await getOrCreateSession(email, password);
      const idcliente = body.idcliente ? String(body.idcliente) : null;
      const nomeAlvo = body.nome ? String(body.nome).toUpperCase() : null;

      // Coletor: captura TODO XHR/fetch (não só api-vo — o endpoint real pode
      // estar em outro subdomínio). Filtra apenas responses JSON.
      const captured = new Map();
      const started = Date.now();
      const isInteresting = (u) => {
        if (!u) return false;
        if (u.startsWith('data:') || u.startsWith('blob:')) return false;
        if (/\.(png|jpe?g|gif|svg|webp|ico|css|woff2?|ttf|map|js)(\?|$)/i.test(u)) return false;
        // ignora o próprio bundle/estáticos do escritorio
        if (/escritorio\.igreenenergy\.com\.br\/(assets|static|_next|images)/i.test(u)) return false;
        return true;
      };
      const reqListener = (r) => {
        const u = r.url();
        if (!isInteresting(u)) return;
        const key = r.method() + ' ' + u;
        if (!captured.has(key)) {
          captured.set(key, { method: r.method(), url: u, resource_type: r.resourceType(), t_start: Date.now() - started });
        }
      };
      const respListener = async (resp) => {
        const u = resp.url();
        if (!isInteresting(u)) return;
        const req = resp.request();
        const key = req.method() + ' ' + u;
        const rec = captured.get(key) || { method: req.method(), url: u, resource_type: req.resourceType() };
        rec.status = resp.status();
        rec.content_type = resp.headers()['content-type'] || '';
        try {
          const buf = await resp.body();
          rec.size = buf.length;
          // só guarda amostra se for JSON/text (não binário)
          if (/json|text|xml|javascript/i.test(rec.content_type) || buf.length < 20000) {
            rec.sample = buf.toString('utf8').slice(0, 6000);
          } else {
            rec.sample = `<<binary ${rec.content_type} ${buf.length}b>>`;
          }
        } catch (e) {
          rec.sample = `<<body_err: ${e.message}>>`;
        }
        rec.t_end = Date.now() - started;
        captured.set(key, rec);
      };
      s.page.on('request', reqListener);
      s.page.on('response', respListener);

      const steps = [];
      const step = (name, extra = {}) => steps.push({ t: Date.now() - started, name, ...extra });

      try {
        step('nav_blank_first');
        try { await s.page.goto('about:blank'); } catch {}

        step('nav_clientes_green');
        try {
          await s.page.goto('https://escritorio.igreenenergy.com.br/clientes-green', {
            waitUntil: 'domcontentloaded', timeout: 45000,
          });
        } catch (e) {
          step('nav_err', { message: e.message });
        }
        // Aguarda a listagem HIDRATAR — não confia só em networkidle porque
        // SPAs re-hidratam em background. Espera aparecer algum link/row com número.
        try {
          await s.page.waitForFunction(() => {
            const t = document.body?.innerText || '';
            return t.length > 500 && /\d{6,}/.test(t); // algum idcliente numérico
          }, { timeout: 25000 });
        } catch (e) { step('hydrate_timeout', { message: e.message }); }
        try { await s.page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
        step('list_loaded', {
          url: s.page.url(),
          body_len: await s.page.evaluate(() => document.body?.innerText?.length || 0).catch(() => 0),
          captured_so_far: captured.size,
        });
        await snapStep(s.page, 'spy_lista');


        // Estratégia de clique melhorada: procura link/botão cujo texto/atributos
        // contenham o idcliente/nome. Rejeita elementos de "reveal" (privacidade).
        let clicked = false;
        const alvoTexto = idcliente || nomeAlvo;
        for (let attempt = 1; attempt <= 3 && !clicked; attempt++) {
          if (attempt > 1) await s.page.waitForTimeout(2000);
          const result = await s.page.evaluate((alvo) => {
            const norm = (x) => String(x || '').toUpperCase();
            const target = norm(alvo);
            const REJECT = /REVEAL|CLIQUE PARA|MOSTRAR|OCULT|EYE|OLHO/i;
            const nodes = Array.from(document.querySelectorAll(
              'a[href], button, [role="button"], [class*="card" i], [class*="cliente" i], tr, li'
            ));
            let match = null;
            let matchLen = Infinity;
            if (target) {
              for (const n of nodes) {
                const txt = n.innerText || '';
                if (!txt || txt.length > 1200) continue;
                if (REJECT.test(txt)) continue;
                const up = norm(txt);
                const attrs = norm((n.getAttribute('href') || '') + ' ' + (n.getAttribute('data-id') || '') + ' ' + (n.getAttribute('id') || ''));
                if (up.includes(target) || attrs.includes(target)) {
                  if (txt.length < matchLen) { match = n; matchLen = txt.length; }
                }
              }
            }
            if (!match) {
              // fallback: 1º link/botão que pareça abrir detalhe (href com id)
              match = document.querySelector('a[href*="cliente"]') ||
                      document.querySelector('button[class*="detail" i], button[class*="ver" i]');
            }
            if (match) {
              match.scrollIntoView({ block: 'center' });
              try {
                match.click();
                return {
                  clicked: true,
                  tag: match.tagName,
                  href: match.getAttribute('href') || null,
                  text: (match.innerText || '').slice(0, 200),
                };
              } catch (e) { return { clicked: false, error: String(e.message) }; }
            }
            return { clicked: false, error: 'no_card_found' };
          }, alvoTexto);
          if (result.clicked) {
            clicked = true;
            step('card_clicked', result);
          } else {
            step('card_click_fail', { attempt, error: result.error });
          }
        }

        // Espera adicional para XHRs do detalhe
        await s.page.waitForTimeout(8000);
        try { await s.page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
        step('collected', { url: s.page.url() });
        await snapStep(s.page, 'spy_pos_clique');
      } finally {
        s.page.off('request', reqListener);
        s.page.off('response', respListener);
      }

      const all = Array.from(captured.values()).sort((a, b) => (a.t_start || 0) - (b.t_start || 0));
      // Heurística de "winner": path com id numérico OU sample contém campos de endereço/licenciado
      const alvoUp = (idcliente || nomeAlvo || '').toUpperCase();
      const winners = all.filter((r) => {
        if (!r.sample) return false;
        const upperSample = r.sample.toUpperCase();
        if (alvoUp && upperSample.includes(alvoUp)) return true;
        if (/"endereco|"cep"|"bairro"|"logradouro"|"licenciad/i.test(r.sample)) return true;
        return false;
      });

      return sendJson(res, 200, {
        ok: true,
        consultor_id: s.consultorId,
        target: { idcliente, nome: nomeAlvo },
        elapsed_ms: Date.now() - started,
        total_requests: all.length,
        winners: winners.map((w) => ({
          method: w.method, url: w.url, status: w.status,
          size: w.size, sample: (w.sample || '').slice(0, 2000),
        })),
        requests: all.map((r) => ({
          method: r.method, url: r.url, status: r.status,
          content_type: r.content_type, size: r.size,
          t_start: r.t_start, t_end: r.t_end,
          sample: (r.sample || '').slice(0, 800),
        })),
        steps,
      });
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
    });

  } catch (e) {
    const status = e?.status || 500;
    console.error(`[err] ${req.method} ${req.url} → ${status}: ${e?.message}`);
    return sendJson(res, status, { ok: false, error: e?.message || 'erro interno', error_code: e?.code || null });
  }
});

server.listen(PORT, () => {
  console.log(`[boot] igreen-sync-worker v17 (tor+playwright+api-vo) porta ${PORT}`);
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
