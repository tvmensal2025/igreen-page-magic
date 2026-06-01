/**
 * Portal 2 (autoconexao) — API Client
 *
 * Estratégia híbrida:
 *   - Mantém um Playwright Chromium vivo navegando em green.igreenenergy.com.br
 *     (página SPA do portal). Cloudflare aceita requests dali.
 *   - Faz as chamadas via `page.evaluate(fetch)` — TLS fingerprint do browser real,
 *     cf_clearance setado, Origin correto. CF entrega 200.
 *   - HMAC-SHA256 calculado em Node, headers passados pra dentro do fetch.
 *
 * Por que não fetch direto: Cloudflare bloqueia 403 mesmo com cookie/HMAC corretos,
 * porque o TLS fingerprint do Node é detectado como bot. Playwright passa.
 *
 * Performance: ~3-5s por call após o navegador estar quente (vs 30-60s do
 * Playwright clicando em cada campo). E o navegador serve dezenas de calls
 * sem reiniciar.
 *
 * Documentação: docs/portal-api/PORTAL2_API_COMPLETO.md
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-chromium';

const BASE_URL = 'https://api-green-connection.igreenenergy.com.br';
const PORTAL_LANDING = 'https://green.igreenenergy.com.br/autoconexao/';
const APP_ID = 'igreen-web-v1';
const SECRET = 'e8047bfd04cab6dac3d3d7d276347eddb3da57ec5f2670f476727c2744bf7b05';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ─── HMAC ────────────────────────────────────────────────────────────────────
export function signRequest(method, pathname) {
  const timestamp = new Date().toISOString();
  const payload = `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${APP_ID}`;
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return {
    'x-frontend-app-id': APP_ID,
    'x-frontend-timestamp': timestamp,
    'x-frontend-signature': signature,
  };
}

// ─── Browser singleton ───────────────────────────────────────────────────────
let _browser = null;
let _context = null;
let _page = null;
let _pageReadyAt = 0;
const PAGE_LIFETIME_MS = 25 * 60 * 1000;

async function _ensurePage(idconsultor) {
  if (_page && Date.now() < _pageReadyAt + PAGE_LIFETIME_MS) {
    try { await _page.evaluate(() => 1); return _page; } catch { /* page died, recreate */ }
  }
  await closeBrowser().catch(() => {});
  _browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  _context = await _browser.newContext({ userAgent: UA, locale: 'pt-BR' });
  await _context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
  _page = await _context.newPage();
  await _page.goto(`${PORTAL_LANDING}?id=${idconsultor || 124170}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await _page.waitForTimeout(4500); // CF challenge resolve
  _pageReadyAt = Date.now();
  return _page;
}

export async function closeBrowser() {
  try { if (_browser) await _browser.close(); } catch {}
  _browser = _context = _page = null;
  _pageReadyAt = 0;
}

// ─── Utilitários ────────────────────────────────────────────────────────────
const onlyDigits = s => String(s ?? '').replace(/\D/g, '');
const toIsoDate = ddmmyyyy => {
  const m = String(ddmmyyyy ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ddmmyyyy;
};
const formatCep = c => {
  const d = onlyDigits(c);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};
const formatPhone = c => {
  const d = onlyDigits(c);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return c;
};
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// ─── Client ──────────────────────────────────────────────────────────────────
export class Portal2Client {
  constructor({ idconsultor, baseUrl = BASE_URL } = {}) {
    if (!idconsultor) throw new Error('idconsultor é obrigatório');
    this.idconsultor = Number(idconsultor);
    this.baseUrl = baseUrl;
  }

  // ──── HTTP core via page.evaluate ──────────────────────────────────────────
  async _fetch(method, path, { body, query } = {}) {
    const page = await _ensurePage(this.idconsultor);
    const url = new URL(this.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
    }
    const pathname = url.pathname; // HMAC só do path
    const headers = signRequest(method, pathname);
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const result = await page.evaluate(async ({ url, method, headers, body }) => {
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        return { status: res.status, ct: res.headers.get('content-type') || '', body: text };
      } catch (e) { return { err: String(e) }; }
    }, { url: url.toString(), method, headers, body });

    if (result.err) throw new Error(`fetch in-page falhou: ${result.err}`);
    const data = result.ct.includes('json') ? safeJson(result.body) : null;
    if (result.status < 200 || result.status >= 300) {
      const msg = data?.error?.message || data?.message || result.body.slice(0, 300);
      const err = new Error(`${method} ${pathname} -> ${result.status}: ${msg}`);
      err.status = result.status;
      err.body = data ?? result.body;
      throw err;
    }
    return data ?? result.body;
  }

  /**
   * Upload com multipart — usa fetch dentro da page com FormData/Blob construídos lá.
   * fileBuffer: Buffer ou Uint8Array (vamos converter pra base64 e remontar no browser).
   */
  async _fetchMultipart(method, path, { fields = {}, file, fileField = 'file' } = {}) {
    const page = await _ensurePage(this.idconsultor);
    const url = new URL(this.baseUrl + path);
    const pathname = url.pathname;
    const headers = signRequest(method, pathname);
    // não setamos Content-Type — boundary é gerado pelo browser

    let fileB64 = null;
    if (file?.buffer) {
      fileB64 = Buffer.from(file.buffer).toString('base64');
    }

    const result = await page.evaluate(async ({ url, method, headers, fields, fileB64, fileName, fileMime, fileField }) => {
      try {
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields || {})) {
          fd.append(k, String(v));
        }
        if (fileB64) {
          // Reconstruir Blob a partir do base64
          const bin = atob(fileB64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          // /extract-receipt espera `file`; /extract-document espera `files`.
          fd.append(fileField || 'file', new Blob([arr], { type: fileMime || 'image/jpeg' }), fileName || 'file.jpg');
        }
        const res = await fetch(url, { method, headers, body: fd });
        const text = await res.text();
        return { status: res.status, ct: res.headers.get('content-type') || '', body: text };
      } catch (e) { return { err: String(e) }; }
    }, {
      url: url.toString(), method, headers, fields,
      fileB64, fileName: file?.filename, fileMime: file?.mime, fileField,
    });

    if (result.err) throw new Error(`upload in-page falhou: ${result.err}`);
    const data = result.ct.includes('json') ? safeJson(result.body) : null;
    if (result.status < 200 || result.status >= 300) {
      const msg = data?.error?.message || data?.message || result.body.slice(0, 300);
      const err = new Error(`${method} ${pathname} -> ${result.status}: ${msg}`);
      err.status = result.status;
      err.body = data ?? result.body;
      throw err;
    }
    return data ?? result.body;
  }

  // ──── Lookups / pré-validações ─────────────────────────────────────────────
  /**
   * Busca dados do cliente na base do iGreen + Receita Federal.
   * Retorna `null` se CPF inválido, não cadastrado, ou backend retornou 5xx
   * (em vez de quebrar). Quem chama decide se cai pro fluxo manual.
   */
  async documentLookup(cpf) {
    const digits = onlyDigits(cpf);
    if (digits.length !== 11 && digits.length !== 14) return null;
    try {
      return await this._fetch('GET', '/document-lookup', { query: { document: digits } });
    } catch (e) {
      if (e.status >= 500 || e.status === 404 || e.status === 400) return null;
      throw e;
    }
  }
  /**
   * Verifica duplicidade. Retorna `{exists, consultantConflict}`.
   *
   * ⚠️ Importante: a API só considera `exists=true` quando o cadastro estiver
   * **completo e assinado**. Cadastros em "pending" / "validação humana" / sem
   * OTP confirmado retornam `exists=false` — então isso NÃO previne criar
   * múltiplos cadastros pro mesmo CPF se nenhum foi finalizado ainda.
   *
   * Pra detecção mais agressiva, combinar com `getCustomerByCpf` (Portal 1) ou
   * checar nosso próprio Supabase.
   */
  checkCustomerExists({ email, document, idconsultor = this.idconsultor }) {
    return this._fetch('GET', '/customers/check-exists', { query: { email, document, idconsultor: String(idconsultor) } });
  }
  checkInstallation({ numinstalacao, concessionaria, uf }) {
    return this._fetch('GET', '/customers/check-installation', { query: { numinstalacao, concessionaria, uf } });
  }
  checkConsultantConflict({ document, idconsultor = this.idconsultor }) {
    return this._fetch('GET', '/customers/check-consultant', { query: { document, idconsultor: String(idconsultor) } });
  }
  /** ViaCEP — retorna `null` quando CEP não existe (em vez de propagar 5xx). */
  async viacep(cep) {
    try {
      const r = await this._fetch('GET', `/viacep/${onlyDigits(cep)}`);
      return r?.erro ? null : r;
    } catch (e) {
      if (e.status >= 500 || e.status === 404) return null;
      throw e;
    }
  }
  consultantLicense(id = this.idconsultor) { return this._fetch('GET', `/consultants/${id}/license`); }
  indicator(id) { return this._fetch('GET', `/customers/indicator/${id}`); }

  // ──── Bonus / fornecedora ──────────────────────────────────────────────────
  getStates() { return this._fetch('GET', '/bonus/states'); }
  getDistributors(uf) { return this._fetch('GET', '/bonus/distributors', { query: { uf } }); }
  getBonusRules({ uf, concessionaria, fornecedora, consumo_medio, idsolcontratovalidacao }) {
    return this._fetch('GET', '/bonus/rules', { query: { uf, concessionaria, fornecedora, consumo_medio, idsolcontratovalidacao } });
  }
  getFormConfig({ state, distributor, supplier } = {}) {
    return this._fetch('GET', '/form-config', { query: { state, distributor, supplier } });
  }

  // ──── Validação / OCR ──────────────────────────────────────────────────────
  initValidation() { return this._fetch('POST', '/extractor/init-validation'); }
  extractDocument({ fileBuffer, filename, mime = 'image/jpeg', idsolcontratovalidacao, pdfPassword }) {
    return this._fetchMultipart('POST', '/extractor/extract-document', {
      fields: {
        ...(idsolcontratovalidacao && { idsolcontratovalidacao: String(idsolcontratovalidacao) }),
        ...(pdfPassword && { pdf_password: pdfPassword }),
      },
      // /extract-document usa campo `files` (não `file`) — senão 400 e a IA não lê.
      file: { buffer: fileBuffer, filename, mime },
      fileField: 'files',
    });
  }
  extractReceipt({ fileBuffer, filename, mime = 'image/jpeg', idsolcontratovalidacao, pdfPassword }) {
    return this._fetchMultipart('POST', '/extractor/extract-receipt', {
      fields: {
        ...(idsolcontratovalidacao && { idsolcontratovalidacao: String(idsolcontratovalidacao) }),
        ...(pdfPassword && { pdf_password: pdfPassword }),
      },
      file: { buffer: fileBuffer, filename, mime },
    });
  }
  manualFallback({ idsolcontratovalidacao, originStep, lastError }) {
    return this._fetch('POST', '/contract-validation/manual-fallback', {
      body: { idsolcontratovalidacao, originStep, ...(lastError ? { lastError } : {}) },
    });
  }

  // ──── Cliente ──────────────────────────────────────────────────────────────
  createCustomer(payload) { return this._fetch('POST', '/customers', { body: payload }); }
  getCustomer(id) { return this._fetch('GET', `/customers/${id}`); }
  getSignatureSummary(id) { return this._fetch('GET', `/customers/${id}/signature-summary`); }
  acceptTerms(id) { return this._fetch('POST', `/customers/${id}/terms-acceptance`); }

  // ──── OTP ──────────────────────────────────────────────────────────────────
  generateVerificationCode(idcliente) { return this._fetch('POST', '/verification-codes/generate', { body: { idcliente: Number(idcliente) } }); }
  validateVerificationCode({ idcliente, code }) { return this._fetch('POST', '/verification-codes/validate', { body: { idcliente: Number(idcliente), code } }); }
  getVerificationCodeStatus(idcliente) { return this._fetch('GET', `/verification-codes/status/${idcliente}`); }

  // ──── Contrato ─────────────────────────────────────────────────────────────
  getContractGenerated(id) { return this._fetch('GET', `/contracts/customer/${id}/generated`); }
  getContractSigned(id) { return this._fetch('GET', `/contracts/customer/${id}/signed`); }

  // ─── Fluxo completo ────────────────────────────────────────────────────────
  /**
   * Cadastro end-to-end. Retorna { idcliente, idsolcontratovalidacao }.
   * Veja docs/portal-api/PORTAL2_API_COMPLETO.md pro schema do `dados`.
   */
  async cadastrarCliente(dados) {
    let idsolcontratovalidacao = null;

    if (dados.docFile || dados.billFile) {
      const init = await this.initValidation();
      idsolcontratovalidacao = init?.idsolcontratovalidacao || null;
    }

    if (dados.docFile) {
      try {
        await this.extractDocument({
          fileBuffer: dados.docFile.buffer,
          filename: dados.docFile.filename || 'doc.jpg',
          mime: dados.docFile.mime || 'image/jpeg',
          idsolcontratovalidacao,
        });
      } catch (e) {
        if (idsolcontratovalidacao) {
          await this.manualFallback({ idsolcontratovalidacao, originStep: 'document', lastError: e.message }).catch(() => {});
        }
      }
    }
    if (dados.billFile) {
      try {
        await this.extractReceipt({
          fileBuffer: dados.billFile.buffer,
          filename: dados.billFile.filename || 'conta.jpg',
          mime: dados.billFile.mime || 'image/jpeg',
          idsolcontratovalidacao,
          pdfPassword: dados.billPdfPassword,
        });
      } catch (e) {
        if (idsolcontratovalidacao) {
          await this.manualFallback({ idsolcontratovalidacao, originStep: 'invoice', lastError: e.message }).catch(() => {});
        }
      }
    }

    const exists = await this.checkCustomerExists({
      email: dados.email,
      document: onlyDigits(dados.cpf),
    });
    if (exists?.exists) {
      throw new Error(`Cliente já cadastrado: ${exists.consultantConflict ? 'em outro consultor' : 'mesmo consultor'}`);
    }

    let { concessionaria, fornecedora, desconto_cliente } = dados;
    if (!fornecedora) {
      const rules = await this.getBonusRules({
        uf: dados.uf, concessionaria,
        consumo_medio: dados.consumoMedio,
        idsolcontratovalidacao,
      });
      const list = Array.isArray(rules) ? rules : (rules?.rules ?? []);
      const match = list.find(r => r.disponibilidade && r.ativo);
      if (!match) throw new Error(`Sem regra ativa pra UF=${dados.uf} consumo=${dados.consumoMedio}`);
      concessionaria = concessionaria || match.concessionaria;
      fornecedora = match.fornecedora;
      desconto_cliente = desconto_cliente ?? Number(String(match.desconto_cliente || '8').split(',')[0].trim());
    }

    const payload = this.montarPayloadCadastro({
      ...dados, concessionaria, fornecedora, desconto_cliente, idsolcontratovalidacao,
    });
    const created = await this.createCustomer(payload);
    const idcliente = created?.idcliente;
    if (!idcliente) throw new Error(`createCustomer retornou sem idcliente: ${JSON.stringify(created)}`);

    await this.acceptTerms(idcliente).catch(() => {});

    return { idcliente, idsolcontratovalidacao };
  }

  montarPayloadCadastro(d) {
    const out = {
      idconsultor: this.idconsultor,
      numinstalacao: String(d.numeroInstalacao || ''),
      cpf_cnpj: onlyDigits(d.cpf),
      nome: String(d.nome || '').trim(),
      dtnasc: toIsoDate(d.dataNascimento),
      celular: formatPhone(d.whatsapp),
      email: String(d.email || '').trim(),
      cep: formatCep(d.cep),
      endereco: d.endereco || '',
      numero: String(d.numero || ''),
      complemento: d.complemento || '',
      bairro: d.bairro || '',
      cidade: d.cidade || '',
      uf: d.uf || '',
      concessionaria: d.concessionaria || '',
      fornecedora: d.fornecedora || '',
      consumomedio: Number(d.consumoMedio) || 0,
      desconto_cliente: d.desconto_cliente != null ? Number(d.desconto_cliente) : undefined,
      possui_placas: !!d.possuiPlacas,
      contaunica: !!d.contaUnica,
      transferir_titularidade: !!d.transferirTitularidade,
      sendcontract: d.sendcontract !== false,
      logindistribuidora: d.loginDistribuidora || '',
      senhadistribuidora: d.senhaDistribuidora || '',
      indcli: d.indcli || 0,
      idsolcontratovalidacao: d.idsolcontratovalidacao || undefined,
    };

    if (d.titularidade === 'pj' && d.cnpj) {
      Object.assign(out, {
        cnpj: onlyDigits(d.cnpj),
        razao: d.razaoSocial || '',
        fantasia: d.nomeFantasia || '',
        ...(d.naturezaJuridica && { naturezajuridica: d.naturezaJuridica }),
        ...(d.cargo && { cargo: d.cargo }),
        ...(d.ie && { ie: d.ie }),
        ...(d.localRegistro && { localregistro: d.localRegistro }),
      });
    }

    if (d.procurador && d.procurador.nome) {
      const p = d.procurador;
      Object.assign(out, {
        testemunha_nome: p.nome,
        testemunha_cpf: onlyDigits(p.cpf),
        testemunha_datanasc: toIsoDate(p.dataNascimento),
        testemunha_email: p.email || '',
        testemunha_celular: formatPhone(p.celular),
      });
    }
    return out;
  }
}

// ─── Helpers exportados ─────────────────────────────────────────────────────
export { onlyDigits, toIsoDate, formatCep, formatPhone };

export function fileFromPath(path, mime) {
  const buffer = readFileSync(path);
  const filename = path.split(/[/\\]/).pop();
  const guessedMime = mime
    || (filename.endsWith('.pdf') ? 'application/pdf'
      : filename.match(/\.(jpe?g)$/i) ? 'image/jpeg'
      : filename.endsWith('.png') ? 'image/png'
      : 'application/octet-stream');
  return { buffer, filename, mime: guessedMime };
}
