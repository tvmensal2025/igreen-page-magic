/**
 * iGreen Club — API Client (serviço próprio).
 *
 * Playwright Chromium como tunnel TLS (Cloudflare bloqueia Node/curl).
 * Auth JWT via POST /auth/consultor — sem HMAC.
 *
 * Fonte: CLUB-OFICIAL.md
 */

import { chromium } from 'playwright-chromium';
import {
  formatCep,
  montarPayloadClubPf,
  maskPii,
  onlyDigits,
  ufToIbgeId,
  normalizeUf,
} from './club-normalize.mjs';

const BASE_URL = 'https://api.igreenenergy.com.br';
const CLUB_LANDING = 'https://club.igreenenergy.com.br/';
const VIACEP_BASE = 'https://viacep.com.br/ws';
const IBGE_ESTADOS = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Token JWT dura 2h — renovamos com folga.
const TOKEN_TTL_MS = 90 * 60 * 1000;
const PAGE_LIFETIME_MS = 25 * 60 * 1000;

let _browser = null;
let _context = null;
let _page = null;
let _pageReadyAt = 0;

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout após ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildProxy() {
  const server = process.env.CLUB_PROXY_SERVER || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  if (!server) return undefined;
  const username = process.env.CLUB_PROXY_USER || process.env.PROXY_USER || undefined;
  const password = process.env.CLUB_PROXY_PASS || process.env.PROXY_PASS || undefined;
  return { server, username, password };
}

async function _ensurePage(idconsultor) {
  if (_page && Date.now() < _pageReadyAt + PAGE_LIFETIME_MS) {
    try { await _page.evaluate(() => 1); return _page; } catch { /* recreate */ }
  }
  await closeBrowser().catch(() => {});

  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  };
  const proxy = buildProxy();
  if (proxy?.server) launchOpts.proxy = proxy;

  _browser = await chromium.launch(launchOpts);
  _context = await _browser.newContext({ userAgent: UA, locale: 'pt-BR' });
  await _context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  _page = await _context.newPage();
  const id = idconsultor || Number(process.env.CLUB_DEFAULT_CONSULTOR || 124170);
  await _page.goto(`${CLUB_LANDING}?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await _page.waitForTimeout(4500); // CF challenge
  _pageReadyAt = Date.now();
  return _page;
}

export async function closeBrowser() {
  try { if (_browser) await _browser.close(); } catch { /* ignore */ }
  _browser = _context = _page = null;
  _pageReadyAt = 0;
}

export class ClubClient {
  constructor({ idconsultor, baseUrl = BASE_URL, tracer = null } = {}) {
    if (!idconsultor) throw new Error('idconsultor é obrigatório');
    this.idconsultor = Number(idconsultor);
    this.baseUrl = baseUrl;
    this.tracer = tracer;
    this._token = null;
    this._tokenAt = 0;
    this._consultorMeta = null;
  }

  _emitTrace(event) {
    if (!this.tracer) return;
    try { this.tracer.push(event); } catch { /* ignore */ }
  }

  async _fetch(method, path, { body, query, auth = true, timeoutMs = 30000 } = {}) {
    const t0 = Date.now();
    const page = await _ensurePage(this.idconsultor);
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
      }
    }

    const headers = {
      Accept: 'application/json',
      Origin: 'https://club.igreenenergy.com.br',
      Referer: 'https://club.igreenenergy.com.br/',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = await this.getToken();
      headers.Authorization = `Bearer ${token}`;
    }

    const result = await withTimeout(
      page.evaluate(async ({ url, method, headers, body }) => {
        try {
          const res = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
          });
          const text = await res.text();
          return { status: res.status, ct: res.headers.get('content-type') || '', body: text };
        } catch (e) {
          return { err: String(e) };
        }
      }, { url: url.toString(), method, headers, body }),
      timeoutMs,
      `${method} ${path}`,
    );

    const duration_ms = Date.now() - t0;
    if (result.err) {
      this._emitTrace({
        method, path, request: body ?? null, response: null, status: 0, duration_ms, error: result.err,
      });
      throw new Error(`fetch in-page falhou: ${result.err}`);
    }

    const data = result.ct.includes('json') ? safeJson(result.body) : null;
    this._emitTrace({
      method,
      path,
      request: body ? maskPii(body) : null,
      response: data ?? (typeof result.body === 'string' ? result.body.slice(0, 1500) : null),
      status: result.status,
      duration_ms,
      error: result.status >= 400
        ? (data?.error?.message || data?.message || String(result.body).slice(0, 300))
        : null,
    });

    if (result.status < 200 || result.status >= 300) {
      // Token expirado → limpa cache e sinaliza
      if (result.status === 401) {
        this._token = null;
        this._tokenAt = 0;
      }
      const msg = data?.error?.message || data?.message || String(result.body).slice(0, 300);
      const err = new Error(`${method} ${path} -> ${result.status}: ${msg}`);
      err.status = result.status;
      err.body = data ?? result.body;
      throw err;
    }
    return data ?? result.body;
  }

  /** POST /auth/consultor — sem Bearer. */
  async loginConsultor() {
    const data = await this._fetch('POST', '/auth/consultor', {
      body: { idconsultor: this.idconsultor },
      auth: false,
    });
    const access = data?.auth?.access;
    if (!access) throw new Error('auth/consultor sem auth.access');
    if (data?.inadimplente === true) {
      const err = new Error(`consultor inadimplente: ${data?.inadimplenteReason || 'sem motivo'}`);
      err.code = 'INADIMPLENTE';
      err.body = data;
      throw err;
    }
    this._token = access;
    this._tokenAt = Date.now();
    this._consultorMeta = {
      name: data?.name || null,
      tipo_licenca: data?.tipo_licenca || null,
      tipo_suporte: data?.tipo_suporte || null,
      inadimplente: false,
    };
    return { token: access, ...this._consultorMeta };
  }

  async getToken() {
    if (this._token && Date.now() < this._tokenAt + TOKEN_TTL_MS) return this._token;
    const { token } = await this.loginConsultor();
    return token;
  }

  /** GET /cliente/clube/planos (PJ). */
  async listPlanos() {
    return this._fetch('GET', '/cliente/clube/planos');
  }

  /**
   * ViaCEP — chamado no Node (não precisa do tunnel Club).
   * Retorna shape útil pro formulário oficial.
   */
  async lookupCep(cepRaw) {
    const cep = formatCep(cepRaw);
    if (!cep) throw Object.assign(new Error('cep inválido'), { code: 'PAYLOAD_INVALID' });
    const digits = onlyDigits(cep);
    const res = await fetch(`${VIACEP_BASE}/${digits}/json/`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`ViaCEP ${res.status}`);
    const data = await res.json();
    if (data?.erro) throw Object.assign(new Error('CEP não encontrado'), { code: 'CEP_NOT_FOUND' });
    const uf = normalizeUf(data.uf);
    return {
      cep,
      endereco: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf,
      uf_select: ufToIbgeId(uf),
      complemento: data.complemento || '',
    };
  }

  /** Lista UFs IBGE (Node direto). */
  async listEstados() {
    const res = await fetch(IBGE_ESTADOS, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`IBGE estados ${res.status}`);
    return res.json();
  }

  /**
   * Monta payload + opcionalmente completa endereço via ViaCEP.
   */
  async buildPayloadPf(dados, { fillCep = true } = {}) {
    let merged = { ...dados, idconsultor: dados.idconsultor ?? this.idconsultor };
    if (fillCep && merged.cep && (!merged.endereco || !merged.cidade || !merged.uf)) {
      try {
        const addr = await this.lookupCep(merged.cep);
        merged = {
          ...addr,
          ...merged,
          endereco: merged.endereco || addr.endereco,
          bairro: merged.bairro || addr.bairro,
          cidade: merged.cidade || addr.cidade,
          uf: merged.uf || addr.uf,
          uf_select: merged.uf_select || addr.uf_select,
        };
      } catch (e) {
        // CEP opcional no fill — montarPayload ainda valida
        if (e.code !== 'CEP_NOT_FOUND') throw e;
      }
    }
    return montarPayloadClubPf(merged);
  }

  /**
   * Cadastra PF no Club.
   *
   * @param {object} dados — campos flexíveis (CRM)
   * @param {{ dryRun?: boolean }} opts
   *   dryRun=true (default de segurança): monta payload + auth, NÃO posta.
   */
  async cadastrarPf(dados, { dryRun = true } = {}) {
    const allowLive = String(process.env.ALLOW_LIVE_CLUB_POST || '').toLowerCase() === 'true';
    const payload = await this.buildPayloadPf(dados);

    // Garante token válido (e bloqueia inadimplente)
    await this.getToken();

    if (dryRun || !allowLive) {
      return {
        success: true,
        dryRun: true,
        wouldPost: true,
        liveBlocked: !allowLive && !dryRun ? 'ALLOW_LIVE_CLUB_POST!=true' : undefined,
        payload: maskPii(payload),
        payloadRaw: payload,
        consultor: this._consultorMeta,
        endpoint: 'POST /cliente/club',
      };
    }

    const response = await this._fetch('POST', '/cliente/club', { body: payload });
    return {
      success: true,
      dryRun: false,
      payload: maskPii(payload),
      response,
      consultor: this._consultorMeta,
    };
  }
}

export { BASE_URL, CLUB_LANDING };
