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
import { buildExtractionResult } from './portal-errors.mjs';

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
  let d = onlyDigits(c);
  // Remove DDI 55 quando presente (números BR sempre 11 ou 10 dígitos no
  // formato (DD) X XXXX-XXXX). Ex: "5511971254913" → "11971254913".
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return c;
};
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// Envelopa uma promise com timeout (Req 1.4/2.4 — 30s p/ extractor). Em estouro,
// rejeita com Error timeout; o chamador trata como erro de transporte (manual).
function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout após ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const EXTRACTOR_TIMEOUT_MS = 30000;

// ─── Tabelas de mapeamento ──────────────────────────────────────────────────
//
// Áreas de concessão da ANEEL: cada cidade pertence a uma única
// distribuidora. Quando o cliente informa apenas CEP/cidade, a gente já
// resolve sem precisar de OCR ou input do consultor.
//
// IMPORTANTE: as tabelas abaixo refletem APENAS as distribuidoras que a
// iGreen efetivamente atende (descoberto via /bonus/distributors). Áreas
// fora dessa cobertura retornam null e devem ser tratadas como não-elegíveis
// pelo caller.
//
// Cobertura iGreen (verificado em 2026-05-29 via API):
//   SP: CPFL, CPFL PIRATININGA, CPFL SANTA CRUZ, ELEKTRO, ENERGISA SUL SUDESTE
//        (NÃO atende ENEL SP capital, NÃO atende EDP Vale)
//   RJ: ENEL, ENERGISA MINAS RIO
//        (NÃO atende LIGHT — capital+baixada não elegíveis)
//   MG: CEMIG-D, CPFL SANTA CRUZ, ENERGISA MINAS RIO, ENERGISA SUL SUDESTE
//   RS: CEEE, RGE          PR: COPEL, CPFL SANTA CRUZ
//   SC: CELESC             BA: COELBA          CE: ENEL
//   PE: NEO ENERGIA        GO: EQUATORIAL      MT: ENERGISA
//   MS: ELEKTRO, ENERGISA  ES: EDP             PA: EQUATORIAL PA
//   MA/AL/PI: EQUATORIAL   PB: ENERGISA PB     RN: COSERN
//   SE: ENERGISA           TO: ENERGISA TOCANTINS
//   Sem cobertura: DF, AM, AP, AC, RO, RR
const CITY_HINT = {
  SP: {
    // Áreas urbanas conurbadas + interior litoral norte/oeste
    'CPFL PIRATININGA': new Set([
      // Sorocaba e região
      'SOROCABA', 'SALTO', 'ITU', 'BOITUVA', 'PORTO FELIZ', 'TIETÊ', 'TIETE',
      'CAPELA DO ALTO', 'ARAÇOIABA DA SERRA', 'ARACOIABA DA SERRA',
      'ALUMÍNIO', 'ALUMINIO', 'MAIRINQUE', 'IPERÓ', 'IPERO',
      // Jundiaí/Indaiatuba
      'JUNDIAI', 'JUNDIAÍ', 'INDAIATUBA', 'CABREÚVA', 'CABREUVA',
      'ITUPEVA', 'CAJAMAR', 'CAIEIRAS',
      // Baixada Santista
      'SANTOS', 'SAO VICENTE', 'SÃO VICENTE', 'GUARUJA', 'GUARUJÁ',
      'CUBATAO', 'CUBATÃO', 'PRAIA GRANDE', 'BERTIOGA', 'PERUIBE', 'PERUÍBE',
      'ITANHAEM', 'ITANHAÉM', 'MONGAGUA', 'MONGAGUÁ',
      // Sul
      'ITAPETININGA', 'ITAPEVA', 'TATUI', 'TATUÍ', 'CERQUILHO',
      'CESARIO LANGE', 'CESÁRIO LANGE', 'PORANGABA',
    ]),
    'CPFL SANTA CRUZ': new Set([
      'SANTA CRUZ DO RIO PARDO', 'OURINHOS', 'AVARE', 'AVARÉ',
      'SAO MANUEL', 'SÃO MANUEL', 'BOTUCATU', 'AGUDOS',
      'CHAVANTES', 'IPAUSSU', 'PIRAJU', 'TIMBURI',
    ]),
    'ELEKTRO': new Set([
      // ELEKTRO atende grande parte do interior SP (~228 cidades)
      'CAMPINAS', 'LIMEIRA', 'PIRACICABA', 'AMERICANA', 'SUMARÉ', 'SUMARE',
      'HORTOLANDIA', 'HORTOLÂNDIA', 'PAULINIA', 'PAULÍNIA',
      'NOVA ODESSA', 'COSMÓPOLIS', 'COSMOPOLIS', 'ENGENHEIRO COELHO',
      'ARTUR NOGUEIRA', 'JAGUARIUNA', 'JAGUARIÚNA', 'PEDREIRA', 'AMPARO',
      'SAO JOSE DO RIO PRETO', 'SÃO JOSÉ DO RIO PRETO', 'CATANDUVA',
      'BARRETOS', 'JABOTICABAL', 'LINS', 'BAURU', 'JAU', 'JAÚ',
      'MARILIA', 'MARÍLIA', 'PRESIDENTE PRUDENTE', 'ASSIS',
      'ARARAQUARA', 'SAO CARLOS', 'SÃO CARLOS', 'RIO CLARO',
    ]),
    // CPFL Paulista (Campinas-leste/Ribeirão Preto/Franca/Mogi-Guaçu)
    'CPFL': new Set([
      'RIBEIRAO PRETO', 'RIBEIRÃO PRETO', 'FRANCA', 'BATATAIS',
      'SERTAOZINHO', 'SERTÃOZINHO', 'CRAVINHOS', 'BRODOWSKI',
      'BEBEDOURO',
      'ARARAS', 'MOGI MIRIM', 'MOGI GUACU', 'MOGI GUAÇU',
      'LEME', 'PIRASSUNUNGA', 'SAO JOAO DA BOA VISTA',
      'SÃO JOÃO DA BOA VISTA',
    ]),
    // ⚠ NÃO ATENDIDOS pela iGreen (caem em null, lead não-elegível):
    //   - ENEL SP capital + Grande SP (São Paulo, Guarulhos, Osasco etc.)
    //   - EDP Vale do Paraíba (SJ Campos, Taubaté etc.)
  },
  RJ: {
    // ENEL RJ — Norte/Noroeste fluminense + Sul + Niterói
    'ENEL': new Set([
      'NITEROI', 'NITERÓI', 'SAO GONCALO', 'SÃO GONÇALO',
      'MARICA', 'MARICÁ', 'ITABORAI', 'ITABORAÍ', 'TANGUA', 'TANGUÁ',
      'CAMPOS DOS GOYTACAZES', 'MACAE', 'MACAÉ', 'CABO FRIO',
      'ARRAIAL DO CABO', 'BUZIOS', 'BÚZIOS', 'SAQUAREMA', 'ARARUAMA',
      'IGUABA', 'TERESÓPOLIS', 'TERESOPOLIS', 'NOVA FRIBURGO',
      'CACHOEIRAS DE MACACU', 'RIO BONITO', 'CASIMIRO DE ABREU',
      'PETROPOLIS', 'PETRÓPOLIS', 'MAGE', 'MAGÉ', 'GUAPIMIRIM',
    ]),
    // ⚠ NÃO ATENDIDOS pela iGreen:
    //   - LIGHT (Rio capital, Duque, São João Meriti, Nova Iguaçu, Volta
    //     Redonda etc.)
  },
  MG: {
    // CPFL SANTA CRUZ atende um pequeno bolsão no sul de MG
    'CPFL SANTA CRUZ': new Set([
      'POÇOS DE CALDAS', 'POCOS DE CALDAS', 'CALDAS', 'IBITIURA DE MINAS',
      'IPUIUNA', 'IPUIÚNA', 'BOTELHOS',
    ]),
    // ENERGISA MINAS RIO
    'ENERGISA MINAS RIO': new Set([
      'CATAGUASES', 'LEOPOLDINA', 'MURIAE', 'MURIAÉ',
    ]),
    // ENERGISA SUL SUDESTE — sul/sudoeste de MG
    'ENERGISA SUL SUDESTE': new Set([
      'POUSO ALEGRE', 'ITAJUBA', 'ITAJUBÁ', 'OURO FINO',
    ]),
    // CEMIG-D atende todo o resto de MG (default UF)
  },
  RS: {
    // CEEE-D (capital + sul + fronteira)
    'CEEE': new Set([
      'PORTO ALEGRE', 'PELOTAS', 'RIO GRANDE', 'GRAVATAÍ', 'GRAVATAI',
      'CACHOEIRINHA', 'ALVORADA', 'VIAMÃO', 'VIAMAO', 'CANOAS',
      'ESTEIO', 'SAPUCAIA DO SUL', 'NOVO HAMBURGO', 'SÃO LEOPOLDO',
      'SAO LEOPOLDO', 'JAGUARÃO', 'JAGUARAO', 'BAGE', 'BAGÉ',
      'CAMAQUÃ', 'CAMAQUA', 'SANTA VITORIA DO PALMAR',
    ]),
    // RGE (norte/serra) — default UF
  },
  PR: {
    // CPFL SANTA CRUZ tem pequeno bolsão fronteira com SP
    'CPFL SANTA CRUZ': new Set([
      'JOAQUIM TAVORA', 'JOAQUIM TÁVORA', 'JUNDIAI DO SUL',
      'JUNDIAÍ DO SUL', 'SANTO ANTONIO DA PLATINA',
      'SANTO ANTÔNIO DA PLATINA', 'CARLOPOLIS', 'CARLÓPOLIS',
    ]),
    // COPEL atende quase todo PR — default UF
  },
  MS: {
    // ELEKTRO atende sul de MS
    'ELEKTRO': new Set([
      'TRES LAGOAS', 'TRÊS LAGOAS', 'BRASILANDIA', 'BRASILÂNDIA',
      'AGUA CLARA', 'ÁGUA CLARA',
    ]),
    // ENERGISA MS — default
  },
};

// UFs com 1 distribuidora dominante. Quando cidade não cai em CITY_HINT
// (ou nem temos cidade), aqui é a aposta. Os tokens precisam aparecer no
// retorno de /bonus/distributors da iGreen pra UF.
//
// IMPORTANTE: UFs sem cobertura (DF, AM, AP, AC, RO, RR) não têm default —
// caem em null e o lead não é elegível.
const UF_DEFAULT = {
  // UFs com 1 distribuidora dominante
  AL: 'EQUATORIAL',
  BA: 'COELBA',
  CE: 'ENEL',
  ES: 'EDP',
  GO: 'EQUATORIAL',
  MA: 'EQUATORIAL',
  MG: 'CEMIG-D',
  MT: 'ENERGISA',
  PA: 'EQUATORIAL PA',
  PB: 'ENERGISA PB',
  PE: 'NEO ENERGIA',
  PI: 'EQUATORIAL',
  PR: 'COPEL',
  RN: 'COSERN',
  RS: 'RGE',       // norte/serra (capital cai em CEEE via CITY_HINT)
  SC: 'CELESC',
  SE: 'ENERGISA',
  TO: 'ENERGISA TOCANTINS',
  // SP/RJ/MS são ambíguas — sem default seguro, dependem do CITY_HINT
};

// UFs sem cobertura iGreen — sinaliza pro caller que o lead é não-elegível.
const UF_NAO_ATENDIDA = new Set(['DF', 'AM', 'AP', 'AC', 'RO', 'RR']);

// Aliases por nome comercial: regex no nome digitado/OCR → token oficial.
const COMMERCIAL_TO_TOKEN = [
  // CPFL: "Energia"/"Paulista" caem em "CPFL"; Piratininga e Santa Cruz têm
  // nomes próprios. Tolerância pra OCR quebrada: "PRA TININGA"/"PIR TININGA".
  { match: /^CPFL.*PIRA?\s*TININGA/, token: 'CPFL PIRATININGA' },
  { match: /^CPFL.*SANTA\s*CRUZ/,   token: 'CPFL SANTA CRUZ' },
  { match: /PIRA?\s*TININGA/,        token: 'CPFL PIRATININGA' },
  { match: /^CPFL/,                  token: 'CPFL' },
  // Cemig (MG)
  { match: /^CEMIG/,                 token: 'CEMIG-D' },
  // Enel (SP/RJ/CE) e antigas Eletropaulo/Ampla/Coelce
  { match: /^ENEL/,                  token: 'ENEL' },
  { match: /^ELETROPAULO/,           token: 'ENEL' },
  { match: /^AMPLA/,                 token: 'ENEL' },
  { match: /^COELCE/,                token: 'ENEL' },
  // Energisa (MT/MS/SE/PB/MG/SP/AC/RO/TO)
  { match: /^ENERGISA\s*MINAS\s*RIO/,    token: 'ENERGISA MINAS RIO' },
  { match: /^ENERGISA\s*SUL\s*SUDESTE/,  token: 'ENERGISA SUL SUDESTE' },
  { match: /^ENERGISA\s*PARAIBA|^ENERGISA\s*PB/, token: 'ENERGISA PB' },
  { match: /^ENERGISA\s*TOCANTINS/,      token: 'ENERGISA TOCANTINS' },
  { match: /^ENERGISA/,                  token: 'ENERGISA' },
  // EDP (SP/ES) — antiga Bandeirante/Escelsa
  { match: /^EDP/,                   token: 'EDP' },
  { match: /^BANDEIRANTE/,           token: 'EDP' },
  { match: /^ESCELSA/,               token: 'EDP' },
  // Equatorial (MA/PA/AL/PI/GO/RJ)
  { match: /^EQUATORIAL\s*PA/,       token: 'EQUATORIAL PA' },
  { match: /^EQUATORIAL/,            token: 'EQUATORIAL' },
  { match: /^CELPA/,                 token: 'EQUATORIAL PA' },
  { match: /^CEMAR/,                 token: 'EQUATORIAL' },
  { match: /^CEPISA/,                token: 'EQUATORIAL' },
  { match: /^CELG/,                  token: 'EQUATORIAL' },
  { match: /^CEAL/,                  token: 'EQUATORIAL' },
  // Coelba (BA), Cosern (RN), Celpe (PE) — grupo Neoenergia
  { match: /^COELBA/,                token: 'COELBA' },
  { match: /^COSERN/,                token: 'COSERN' },
  { match: /^NEO\s*ENERGIA|^CELPE/,  token: 'NEO ENERGIA' },
  // Light (RJ)
  { match: /^LIGHT/,                 token: 'LIGHT' },
  // Celesc (SC/PR)
  { match: /^CELESC/,                token: 'CELESC' },
  // Copel (PR)
  { match: /^COPEL/,                 token: 'COPEL' },
  // CEEE / RGE (RS)
  { match: /^CEEE/,                  token: 'CEEE' },
  { match: /^RGE/,                   token: 'RGE' },
  // Elektro (SP/MS)
  { match: /^ELEKTRO/,               token: 'ELEKTRO' },
  // Amazonas Energia (AM), Roraima Energia (RR)
  { match: /^AMAZONAS/,              token: 'AMAZONAS' },
  { match: /^RORAIMA/,               token: 'RORAIMA' },
];

// ─── Client ──────────────────────────────────────────────────────────────────
export class Portal2Client {
  constructor({ idconsultor, baseUrl = BASE_URL, tracer = null } = {}) {
    if (!idconsultor) throw new Error('idconsultor é obrigatório');
    this.idconsultor = Number(idconsultor);
    this.baseUrl = baseUrl;
    // Tracer opcional: se setado, recebe { method, path, request, response,
    // status, duration_ms, error } a cada call. Usado pra auditoria IA dos
    // primeiros cadastros (PORTAL2_AI_AUDIT_LIMIT).
    this.tracer = tracer;
  }

  _emitTrace(event) {
    if (!this.tracer) return;
    try { this.tracer.push(event); } catch {}
  }

  // ──── HTTP core via page.evaluate ──────────────────────────────────────────
  async _fetch(method, path, { body, query } = {}) {
    const t0 = Date.now();
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

    const duration_ms = Date.now() - t0;

    if (result.err) {
      this._emitTrace({ method, path: pathname, query: query || null, request: body ?? null,
                        response: null, status: 0, duration_ms, error: result.err });
      throw new Error(`fetch in-page falhou: ${result.err}`);
    }
    const data = result.ct.includes('json') ? safeJson(result.body) : null;
    this._emitTrace({
      method, path: pathname, query: query || null, request: body ?? null,
      response: data ?? (typeof result.body === 'string' ? result.body.slice(0, 2000) : null),
      status: result.status, duration_ms,
      error: result.status >= 400 ? (data?.error?.message || data?.message || result.body.slice(0, 300)) : null,
    });
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
  async _fetchMultipart(method, path, { fields = {}, file, fileField = 'file', query } = {}) {
    const t0 = Date.now();
    const page = await _ensurePage(this.idconsultor);
    const url = new URL(this.baseUrl + path);
    // Query string (ex.: /file-upload/registration usa ?fileType=&idsolcontratovalidacao=).
    // ⚠️ O HMAC assina SOMENTE o pathname (sem query) — mesma regra do _fetch.
    if (query) for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
    }
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
          // ⚠️ O nome do campo varia por endpoint: /extract-receipt espera
          // `file`; /extract-document espera `files` (multer .array). Enviar o
          // nome errado retorna 400 "Unexpected field" e a IA deles nem analisa.
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

    const duration_ms = Date.now() - t0;
    const fileSummary = file ? { filename: file.filename, mime: file.mime, bytes: file.buffer?.length } : null;

    if (result.err) {
      this._emitTrace({ method, path: pathname, request: { fields, file: fileSummary },
                        response: null, status: 0, duration_ms, error: result.err });
      throw new Error(`upload in-page falhou: ${result.err}`);
    }
    const data = result.ct.includes('json') ? safeJson(result.body) : null;
    this._emitTrace({
      method, path: pathname, request: { fields, file: fileSummary },
      response: data ?? (typeof result.body === 'string' ? result.body.slice(0, 2000) : null),
      status: result.status, duration_ms,
      error: result.status >= 400 ? (data?.error?.message || data?.message || result.body.slice(0, 300)) : null,
    });
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

  /**
   * Normaliza nome de concessionária local pra o nome oficial aceito pela iGreen.
   *
   * Exemplos cobertos (nome comercial na fatura → enum iGreen):
   *   "CPFL Energia" / "CPFL Paulista" → "CPFL"
   *   "CPFL Piratininga" → "CPFL PIRATININGA"
   *   "Cemig Distribuição" / "Cemig D" → "CEMIG-D"
   *   "Enel Distribuição São Paulo" → "ENEL"
   *   "Coelba" → "COELBA"
   *   "Light SA" / "Light Energia" → "LIGHT"
   *   "Energisa Mato Grosso" → "ENERGISA"
   *
   * Quando passado `cidade`, desambigua casos como "CPFL ENERGIA" em SP
   * (Salto/Sorocaba/Itu → Piratininga; Campinas/Ribeirão Preto → CPFL).
   *
   * Estratégia:
   *   1. Hint por cidade (resolve antes do alias genérico)
   *   2. Match exato case-insensitive
   *   3. Tabela de aliases comerciais (CPFL/CEMIG/ENEL/...)
   *   4. Match por startsWith (mais específico vence)
   *   5. Match por primeira palavra
   *   6. Sem match: retorna `null`
   */
  async resolveConcessionaria(uf, nome, cidade) {
    if (!uf) return null;
    // Normaliza removendo diacríticos pra match consistente
    // ("São Paulo" === "SAO PAULO", "Niterói" === "NITEROI").
    const norm = s => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().trim().replace(/\s+/g, ' ');
    const target = norm(nome);
    const targetCidade = norm(cidade);

    // Lista oficial pra essa UF
    const list = await this.getDistributors(uf).catch(() => []);
    const officials = (Array.isArray(list) ? list : [])
      .map(d => (typeof d === 'string' ? d : d?.concessionaria))
      .filter(Boolean);

    if (officials.length === 0) return null;

    // 0. Hint por cidade — sempre tenta primeiro, mesmo sem nome.
    //    Em UFs com áreas de concessão definidas (ANEEL), cidade já é
    //    suficiente pra resolver. Os Sets do CITY_HINT podem ter entradas
    //    com/sem acento — comparamos sempre normalizado em ambos os lados.
    const cityMap = CITY_HINT[uf?.toUpperCase()];
    if (cityMap && targetCidade) {
      for (const [official, cidades] of Object.entries(cityMap)) {
        const normalizedSet = new Set([...cidades].map(norm));
        if (!normalizedSet.has(targetCidade)) continue;
        const officialMatch = officials.find(o => norm(o) === norm(official));
        if (!officialMatch) continue;
        // Sem nome ou família compatível -> retorna; senão deixa cair pros
        // próximos passos (caso o customer informe nome divergente da cidade).
        if (!target) return officialMatch;
        const family = official.split(' ')[0];
        if (target.startsWith(family) || target.includes(family) || norm(officialMatch).includes(target)) {
          return officialMatch;
        }
      }
    }

    if (!target) {
      // Sem nome e cidade não resolveu: se a UF tem 1 distribuidora dominante
      // (default), usa.
      const def = UF_DEFAULT[uf?.toUpperCase()];
      if (def) {
        const hit = officials.find(o => norm(o) === norm(def))
                 || officials.find(o => norm(o).startsWith(norm(def)));
        if (hit) return hit;
      }
      return null;
    }

    // 1. Match exato case-insensitive
    const exact = officials.find(o => norm(o) === target);
    if (exact) return exact;

    // 2. Aliases por nome comercial: primeiro pattern que casa wins
    for (const { match, token } of COMMERCIAL_TO_TOKEN) {
      if (!match.test(target)) continue;
      // Pega o nome oficial mais próximo do token (case-insensitive)
      const hit = officials.find(o => norm(o) === norm(token))
                || officials.find(o => norm(o).startsWith(norm(token)));
      if (hit) return hit;
    }

    // 3. startsWith fuzzy (mais específico vence)
    const starts = officials
      .filter(o => target.startsWith(norm(o)) || norm(o).startsWith(target))
      .sort((a, b) => norm(b).length - norm(a).length);
    if (starts.length) return starts[0];

    // 4. Primeira palavra em comum
    const targetFirst = target.split(' ')[0];
    if (targetFirst.length >= 3) {
      const byToken = officials.find(o => norm(o).split(' ')[0] === targetFirst);
      if (byToken) return byToken;
    }

    return null;
  }

  /**
   * Resolve a concessionária a partir do CEP, sem depender de OCR ou input do
   * consultor. Estratégia:
   *   1. ViaCEP → cidade + UF
   *   2. CITY_HINT[uf][cidade] → distribuidora
   *   3. UF_DEFAULT[uf] → distribuidora dominante (fallback)
   *   4. Match contra /bonus/distributors da UF (prefere o dominante quando tem só um)
   *
   * Retorna `{uf, cidade, concessionaria, viacep}` quando resolve.
   * Retorna `{uf, cidade, concessionaria: null, naoAtendida: true}` quando o
   *   CEP é válido mas iGreen não atende a região (ex: Rio capital, SP capital,
   *   DF, AM, AP, AC, RO, RR).
   * Retorna `null` quando CEP inválido ou ViaCEP indisponível.
   */
  async resolveConcessionariaByCep(cep) {
    const digits = onlyDigits(cep);
    if (digits.length !== 8) return null;
    const cepInfo = await this.viacep(digits).catch(() => null);
    if (!cepInfo?.uf) return null;
    const uf = cepInfo.uf.toUpperCase();
    const cidade = cepInfo.localidade || '';

    if (UF_NAO_ATENDIDA.has(uf)) {
      return { uf, cidade, concessionaria: null, naoAtendida: true, viacep: cepInfo };
    }

    const resolved = await this.resolveConcessionaria(uf, '', cidade);
    if (resolved) return { uf, cidade, concessionaria: resolved, viacep: cepInfo };

    // Sem match em CITY_HINT/UF_DEFAULT — provavelmente região fora da
    // cobertura iGreen mesmo com UF presente (ex: SP capital, RJ capital).
    return { uf, cidade, concessionaria: null, naoAtendida: true, viacep: cepInfo };
  }

  /**
   * Escolhe a melhor regra de bônus pra um cadastro a partir do retorno
   * de `/bonus/rules`.
   *
   * Schema de cada regra (descoberto via probe):
   *   { idbonus, uf, concessionaria, fornecedora,
   *     tipo_bonus: 'A'|'B'|'C'|'D',          // tier (A=padrão menor desc, D=maior)
   *     desconto_cliente: '8'|'10'|'12'|'14', // string com %
   *     desconto_padrao: bool,                // tier "padrão" da combinação
   *     kwh_min, kwh_max,                     // faixa de consumo (kWh_max=null = sem limite)
   *     dtvalidade_ini, dtvalidade_fim,       // janela de validade
   *     active: bool,                         // ⚠️ NÃO é "ativo"
   *     ... outros: bonus_direto, fatorcalculo, posvenda, injection_deadline, ... }
   *
   * Regra de negócio (definida pelo cliente):
   *   "O desconto sempre vai ser o mais BAIXO da região."
   *
   * Critério:
   *   1. Filtra `active=true`
   *   2. Filtra janela de validade (hoje entre dtvalidade_ini e dtvalidade_fim)
   *   3. Filtra faixa de consumo (kwh_min <= consumo <= kwh_max, se setados)
   *   4. Prefere `desconto_padrao=true` (tier "A" = menor desconto)
   *   5. Fallback: MENOR `desconto_cliente` (tier mais conservador)
   *
   * Se nenhuma regra casa com a faixa exata, relaxa o filtro de consumo
   * (o backend ainda aceita) e tenta com active+validade.
   */
  _pickActiveBonusRule(rules, consumoMedio) {
    if (!Array.isArray(rules) || rules.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const consumo = Number(consumoMedio) || 0;

    const isActiveAndValid = (r) => {
      if (r.active === false) return false;
      if (r.dtvalidade_ini && today < r.dtvalidade_ini) return false;
      if (r.dtvalidade_fim && today > r.dtvalidade_fim) return false;
      return true;
    };

    const inRange = (r) => {
      const kmin = Number(r.kwh_min ?? 0);
      const kmax = r.kwh_max == null ? Infinity : Number(r.kwh_max);
      if (consumo <= 0) return true; // sem consumo: aceita qualquer faixa
      return consumo >= kmin && consumo <= kmax;
    };

    const pickLowest = (list) => {
      // Preferência 1: desconto_padrao=true (tier A oficial)
      const padrao = list.find(r => r.desconto_padrao === true);
      if (padrao) return padrao;
      // Preferência 2: menor desconto_cliente numericamente (mais baixo da região)
      return [...list].sort((a, b) => {
        const da = Number(String(a.desconto_cliente || '99').replace(',', '.'));
        const db = Number(String(b.desconto_cliente || '99').replace(',', '.'));
        return da - db;
      })[0];
    };

    // 1. Tenta com filtro de consumo
    const valid = rules.filter(r => isActiveAndValid(r) && inRange(r));
    if (valid.length > 0) return pickLowest(valid);

    // 2. Relaxa faixa de consumo (mantém active+validade)
    const relaxed = rules.filter(isActiveAndValid);
    if (relaxed.length > 0) return pickLowest(relaxed);

    // 3. Last resort: ignora active também (backend pode aceitar)
    return pickLowest(rules);
  }

  // ──── Validação / OCR ──────────────────────────────────────────────────────
  initValidation() { return this._fetch('POST', '/extractor/init-validation'); }
  extractDocument({ fileBuffer, filename, mime = 'image/jpeg', idsolcontratovalidacao, pdfPassword }) {
    return this._fetchMultipart('POST', '/extractor/extract-document', {
      fields: {
        ...(idsolcontratovalidacao && { idsolcontratovalidacao: String(idsolcontratovalidacao) }),
        ...(pdfPassword && { pdf_password: pdfPassword }),
      },
      // /extract-document usa multer .array → campo `files` (não `file`).
      // Com `file` a API responde 400 "Unexpected field - file" e a IA não lê o doc.
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

  // ──── Upload de arquivos (anexar ao dossiê) ─────────────────────────────────
  /**
   * Anexa FISICAMENTE um arquivo ao dossiê do cadastro (não é OCR — é o upload
   * que o portal real faz via `qn()`/registration). Sem esta etapa, o cadastro
   * nasce com `documentos_enviados='F'` e `caminhoarquivo*=null`, e vai pra
   * conferência humana da iGreen (demora dias). Com ela, o backend migra o
   * arquivo do bucket temporário pro definitivo (`documentosigreen.s3`) quando
   * o `POST /customers` é feito com o MESMO `idsolcontratovalidacao`.
   *
   * Descoberto via reverse-engineering do bundle oficial + validado em chamadas
   * reais (idcliente 1589744): documento → `caminhoarquivodoc1`, conta →
   * `caminhoarquivo`, ambos no bucket definitivo.
   *
   * @param {object} p
   * @param {Buffer|Uint8Array} p.fileBuffer
   * @param {string} p.filename
   * @param {string} p.mime
   * @param {string} p.fileType  — 'personal-doc-front' | 'personal-doc-back' | 'energy-bill'
   *   (tipos válidos do backend: personal-doc-front, personal-doc-back, energy-bill,
   *    energy-bill-2, payment-proof, cnpj-card, social-contract, statute, procuration,
   *    procurator-personal-doc, witness-doc-front, witness-doc-back)
   * @param {number} p.idsolcontratovalidacao
   * @returns {Promise<{fileId, originalName, status}>}
   */
  uploadFile({ fileBuffer, filename, mime = 'image/jpeg', fileType, idsolcontratovalidacao }) {
    if (!fileType) throw new Error('uploadFile: fileType obrigatório');
    if (!idsolcontratovalidacao) throw new Error('uploadFile: idsolcontratovalidacao obrigatório');
    return this._fetchMultipart('POST', '/file-upload/registration', {
      // fileType e idsolcontratovalidacao vão na QUERY STRING (não no body) —
      // é como o portal real envia (axios `params`).
      query: { fileType, idsolcontratovalidacao: String(idsolcontratovalidacao) },
      file: { buffer: fileBuffer, filename, mime },
      fileField: 'file',
    });
  }

  /**
   * Confirma o que está anexado a um idsol. Retorna
   * `{ energy:{exists,hasUrl,url}, personalDoc:{exists,hasFront,hasBack,...}, receipts:[] }`.
   */
  verifyUpload(idsolcontratovalidacao) {
    return this._fetch('GET', `/file-upload/verify/${idsolcontratovalidacao}`);
  }

  /** Reconcilia uploads pendentes (retry do backend) quando o verify não confirma. */
  reconcileUpload(idsolcontratovalidacao) {
    return this._fetch('POST', `/file-upload/reconcile/${idsolcontratovalidacao}`);
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
   * Cadastro end-to-end. Retorna { idcliente, idsolcontratovalidacao, extraction }.
   * Veja docs/portal-api/PORTAL2_API_COMPLETO.md pro schema do `dados`.
   *
   * `extraction` (Req 1/2/3) = { mode: 'auto'|'manual', doc, bill } derivado dos
   * retornos dos extractors — OBSERVACIONAL, nunca bloqueia o cadastro.
   *
   * Se `dados.idsolcontratovalidacao` já vier preenchido, reaproveita
   * (significa que initValidation/extractReceipt já rodaram externamente,
   * tipicamente pra extrair o consumo da fatura).
   */
  async cadastrarCliente(dados) {
    let idsolcontratovalidacao = dados.idsolcontratovalidacao || null;

    // GATE FINAL (defesa em profundidade): nunca cria cliente sem conta + doc.
    // O server.mjs já valida/anexa, mas chamadas diretas ao client também
    // precisam respeitar a regra. CNH (sem verso) é aceita via dados.isCnh.
    const faltando = [];
    if (!dados.billFile) faltando.push('conta de energia');
    if (!dados.docFile) faltando.push('documento (frente)');
    if (!dados.isCnh && !dados.docBackFile) faltando.push('documento (verso)');
    if (faltando.length) {
      const err = new Error(`Documentos obrigatórios ausentes: ${faltando.join(', ')}`);
      err.code = 'MISSING_DOCUMENTS';
      throw err;
    }

    // Roda initValidation quando ainda não tem idsol (sempre teremos arquivos aqui)
    if (!idsolcontratovalidacao) {
      const init = await this.initValidation();
      idsolcontratovalidacao = init?.idsolcontratovalidacao || null;
    }

    // ─── Extração (OBSERVACIONAL — nunca bloqueia o cadastro) ────────────────
    // Capturamos o retorno dos extractors em vez de descartá-lo, pra derivar o
    // Modo_Extração (auto/manual). Erro de transporte/HTTP/timeout 30s → marca
    // __transport_error e dispara manualFallback (Req 1.4/2.4).
    let docResp = null;
    let docBackResp = null;
    let billResp = null;

    if (dados.docFile) {
      try {
        docResp = await withTimeout(this.extractDocument({
          fileBuffer: dados.docFile.buffer,
          filename: dados.docFile.filename || 'doc.jpg',
          mime: dados.docFile.mime || 'image/jpeg',
          idsolcontratovalidacao,
        }), EXTRACTOR_TIMEOUT_MS, 'extract-document');
      } catch (e) {
        docResp = { __transport_error: e.message };
        if (idsolcontratovalidacao) {
          await this.manualFallback({ idsolcontratovalidacao, originStep: 'document', lastError: e.message }).catch(() => {});
        }
      }
    }
    // Verso do RG — segundo extractDocument no mesmo idsol. CNH não tem verso.
    if (dados.docBackFile) {
      try {
        docBackResp = await withTimeout(this.extractDocument({
          fileBuffer: dados.docBackFile.buffer,
          filename: dados.docBackFile.filename || 'doc-verso.jpg',
          mime: dados.docBackFile.mime || 'image/jpeg',
          idsolcontratovalidacao,
        }), EXTRACTOR_TIMEOUT_MS, 'extract-document(verso)');
      } catch (e) {
        docBackResp = { __transport_error: e.message };
        if (idsolcontratovalidacao) {
          await this.manualFallback({ idsolcontratovalidacao, originStep: 'document_back', lastError: e.message }).catch(() => {});
        }
      }
    }
    // extractReceipt só se ainda não rodou (billAlreadyExtracted=true significa
    // que o server.mjs já fez o OCR da fatura pra extrair consumo — não repete,
    // preserva o resultado já registrado — Req 2.5).
    if (dados.billFile && !dados.billAlreadyExtracted) {
      try {
        billResp = await withTimeout(this.extractReceipt({
          fileBuffer: dados.billFile.buffer,
          filename: dados.billFile.filename || 'conta.jpg',
          mime: dados.billFile.mime || 'image/jpeg',
          idsolcontratovalidacao,
          pdfPassword: dados.billPdfPassword,
        }), EXTRACTOR_TIMEOUT_MS, 'extract-receipt');
      } catch (e) {
        billResp = { __transport_error: e.message };
        if (idsolcontratovalidacao) {
          await this.manualFallback({ idsolcontratovalidacao, originStep: 'invoice', lastError: e.message }).catch(() => {});
        }
      }
    } else if (dados.billAlreadyExtracted) {
      // Preserva o resultado já registrado externamente (server.mjs); pode vir
      // em dados.billExtractionResult quando o chamador o repassa.
      billResp = dados.billExtractionResult ?? null;
    }

    // Deriva o Modo_Extração consolidado (auto/manual) — observacional (Req 3).
    const extraction = buildExtractionResult({
      docResp,
      docBackResp,
      billResp,
      isCnh: dados.isCnh,
      billAlreadyExtracted: !!dados.billAlreadyExtracted,
    });

    // ─── ANEXAR ARQUIVOS AO DOSSIÊ (file-upload/registration) ─────────────────
    // CRÍTICO p/ validação na hora: o `extract*` acima é SÓ OCR (lê os dados),
    // NÃO salva o arquivo. Sem este upload, o cadastro nasce com
    // `documentos_enviados='F'` e `caminhoarquivo*=null` → vai pra conferência
    // humana da iGreen (demora dias). Com o upload no MESMO idsol, o backend
    // migra os arquivos pro bucket definitivo quando o POST /customers roda
    // com esse idsol (documento → caminhoarquivodoc1, conta → caminhoarquivo).
    // Validado em chamadas reais. Tipos: personal-doc-front / -back / energy-bill.
    //
    // Upload obrigatório com retry: OCR sozinho não prova anexo real no Portal.
    // O cadastro só segue quando verifyUpload confirma documento + conta no
    // dossiê do mesmo idsolcontratovalidacao.
    if (idsolcontratovalidacao) {
      const uploads = [];
      if (dados.docFile) uploads.push({ file: dados.docFile, fileType: 'personal-doc-front', label: 'doc-frente' });
      if (dados.docBackFile) uploads.push({ file: dados.docBackFile, fileType: 'personal-doc-back', label: 'doc-verso' });
      if (dados.billFile) uploads.push({ file: dados.billFile, fileType: 'energy-bill', label: 'conta' });
      const uploadFailures = []; // [{ fileType, attempt, reason, transient, at }]
      const uploadAttempts = {}; // { fileType: nTentativas }

      // Backoff exponencial 2s,4s,8s,16s,30s (5 tentativas). Erros transientes
      // (5xx, ECONNRESET, ETIMEDOUT, socket hang up, status 0) são retentados;
      // 4xx do servidor (arquivo inválido) também — pode ser flake de upstream.
      const BACKOFF_MS = [2000, 4000, 8000, 16000, 30000];
      const isTransientUploadErr = (e) => {
        const status = Number(e?.status || 0);
        const msg = String(e?.message || '').toLowerCase();
        if (status >= 500) return true;
        if (status === 0 || status === 408 || status === 429) return true;
        return /econnreset|etimedout|socket hang up|network|timeout|fetch failed|aborted/.test(msg);
      };

      const tryUploadOne = async (u, maxAttempts = 5) => {
        for (let tentativa = 1; tentativa <= maxAttempts; tentativa++) {
          uploadAttempts[u.fileType] = tentativa;
          try {
            const r = await withTimeout(this.uploadFile({
              fileBuffer: u.file.buffer,
              filename: u.file.filename || `${u.label}.jpg`,
              mime: u.file.mime || 'image/jpeg',
              fileType: u.fileType,
              idsolcontratovalidacao,
            }), EXTRACTOR_TIMEOUT_MS, `upload(${u.fileType})`);
            const ok = r?.status === 'UPLOADED' || !!r?.fileId;
            if (ok) {
              console.log(`  📎 anexado ${u.fileType} (${u.label}) fileId=${r?.fileId || '?'} tentativa=${tentativa}`);
              return true;
            }
            uploadFailures.push({ fileType: u.fileType, attempt: tentativa, reason: `resposta sem fileId: ${JSON.stringify(r).slice(0, 200)}`, transient: false, at: new Date().toISOString() });
          } catch (e) {
            const transient = isTransientUploadErr(e);
            uploadFailures.push({ fileType: u.fileType, attempt: tentativa, reason: String(e?.message || e).slice(0, 300), transient, at: new Date().toISOString() });
            console.warn(`  ⚠ upload ${u.fileType} tentativa ${tentativa}/${maxAttempts} falhou${transient ? ' (transiente)' : ''}: ${e.message}`);
          }
          if (tentativa < maxAttempts) {
            await new Promise(res => setTimeout(res, BACKOFF_MS[tentativa - 1] || 30000));
          }
        }
        console.warn(`  ⛔ não anexou ${u.fileType} após ${maxAttempts} tentativas`);
        return false;
      };

      for (const u of uploads) {
        await tryUploadOne(u, 5);
      }

      const summarizeUpload = (v) => ({
        idsolcontratovalidacao,
        docFront: !!v?.personalDoc?.hasFront,
        docBack: !!v?.personalDoc?.hasBack,
        energy: !!v?.energy?.hasUrl,
        verifiedAt: new Date().toISOString(),
        uploadAttempts: { ...uploadAttempts },
        uploadFailures: uploadFailures.slice(-20), // últimas 20 falhas pra auditoria
      });
      const fileTypeToVerifyKey = {
        'personal-doc-front': 'documento_frente',
        'personal-doc-back': 'documento_verso',
        'energy-bill': 'conta_energia',
      };
      const missingFromVerify = (v) => {
        const missing = [];
        if (dados.docFile && !v?.personalDoc?.hasFront) missing.push('documento_frente');
        if (!dados.isCnh && dados.docBackFile && !v?.personalDoc?.hasBack) missing.push('documento_verso');
        if (dados.billFile && !v?.energy?.hasUrl) missing.push('conta_energia');
        return missing;
      };
      const uploadsForMissing = (missing) => uploads.filter(u => missing.includes(fileTypeToVerifyKey[u.fileType]));

      let v = await this.verifyUpload(idsolcontratovalidacao).catch((e) => ({ __verify_error: e.message }));
      let missing = missingFromVerify(v);

      // Rounds de recuperação: reconcile + reverify; se ainda faltar, re-uploada
      // só o que faltou e tenta de novo. Até 2 rounds adicionais.
      for (let round = 1; round <= 2 && missing.length; round++) {
        console.warn(`  ⚠ verify incompleto round=${round} (${missing.join(', ')}) — reconcile+retry`);
        await this.reconcileUpload(idsolcontratovalidacao).catch(() => {});
        await new Promise(res => setTimeout(res, 2000));
        v = await this.verifyUpload(idsolcontratovalidacao).catch((e) => ({ __verify_error: e.message }));
        missing = missingFromVerify(v);
        if (!missing.length) break;
        // Re-upload focado nos que ainda faltam, com 3 tentativas extras cada.
        for (const u of uploadsForMissing(missing)) {
          await tryUploadOne(u, 3);
        }
        await new Promise(res => setTimeout(res, 2000));
        v = await this.verifyUpload(idsolcontratovalidacao).catch((e) => ({ __verify_error: e.message }));
        missing = missingFromVerify(v);
      }

      extraction.upload = summarizeUpload(v);
      console.log(`  ✅ verify anexos: doc.front=${extraction.upload.docFront} doc.back=${extraction.upload.docBack} energy=${extraction.upload.energy} attempts=${JSON.stringify(uploadAttempts)}`);

      if (missing.length) {
        const err = new Error(
          `PORTAL_ATTACHMENTS_NOT_CONFIRMED: anexos obrigatórios não confirmados no Portal (${missing.join(', ')})`
        );
        err.code = 'PORTAL_ATTACHMENTS_NOT_CONFIRMED';
        err.extraction = extraction;
        err.body = { idsolcontratovalidacao, missing, upload: extraction.upload };
        throw err;
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

    // Resolve concessionária via /bonus/distributors quando o nome do customer
    // não bate com a nomenclatura oficial da iGreen. Ex: "CPFL ENERGIA" → "CPFL".
    // Cidade ajuda a desambiguar (ex: Salto/SP → CPFL PIRATININGA).
    if (concessionaria && dados.uf) {
      try {
        const official = await this.resolveConcessionaria(dados.uf, concessionaria, dados.cidade);
        if (official && official !== concessionaria) {
          console.log(`  ↳ concessionária normalizada: "${concessionaria}" → "${official}"`);
          concessionaria = official;
        }
      } catch (e) {
        console.warn(`  ⚠ falha ao normalizar concessionária: ${e.message}`);
      }
    }

    if (!fornecedora) {
      let rules;
      try {
        rules = await this.getBonusRules({
          uf: dados.uf, concessionaria,
          consumo_medio: dados.consumoMedio,
          idsolcontratovalidacao,
        });
      } catch (e) {
        // Se 404 mesmo após normalizar, tenta cada concessionária listada da UF
        if (e.status === 404 && dados.uf) {
          console.warn(`  ⚠ /bonus/rules 404 com "${concessionaria}" — fallback iterando distribuidoras da UF`);
          const distList = await this.getDistributors(dados.uf).catch(() => []);
          for (const d of (Array.isArray(distList) ? distList : [])) {
            const candidate = d.concessionaria || d;
            if (!candidate || candidate === concessionaria) continue;
            try {
              rules = await this.getBonusRules({
                uf: dados.uf, concessionaria: candidate,
                consumo_medio: dados.consumoMedio,
                idsolcontratovalidacao,
              });
              const list = Array.isArray(rules) ? rules : (rules?.rules ?? []);
              if (this._pickActiveBonusRule(list, dados.consumoMedio)) {
                console.log(`  ↳ concessionária ajustada: "${concessionaria}" → "${candidate}"`);
                concessionaria = candidate;
                break;
              }
            } catch {}
          }
          if (!rules) throw e;
        } else {
          throw e;
        }
      }
      const list = Array.isArray(rules) ? rules : (rules?.rules ?? []);
      const match = this._pickActiveBonusRule(list, dados.consumoMedio);
      if (!match) throw new Error(`Sem regra ativa pra UF=${dados.uf} concessionaria=${concessionaria} consumo=${dados.consumoMedio}`);
      concessionaria = concessionaria || match.concessionaria;
      fornecedora = match.fornecedora;
      desconto_cliente = desconto_cliente ?? Number(String(match.desconto_cliente || '8').split(',')[0].trim());
    }

    const payload = this.montarPayloadCadastro({
      ...dados, concessionaria, fornecedora, desconto_cliente, idsolcontratovalidacao,
    });
    const created = await this.createCustomer(payload).catch(e => {
      // 400 do /customers traz o detalhe dos campos inválidos no body — extrai
      // pra mensagem de erro ficar acionável (e não só "Erro de validação").
      const detail = e.body && typeof e.body === 'object'
        ? (e.body.errors || e.body.error?.errors || e.body.error?.details
           || e.body.fields || e.body.details || e.body)
        : null;
      if (detail) {
        const msg = typeof detail === 'string' ? detail
          : Array.isArray(detail) ? detail.map(d => d?.message || d?.field || JSON.stringify(d)).join('; ')
          : JSON.stringify(detail).slice(0, 600);
        e.message = `${e.message} | detail=${msg}`;
      }
      // Carrega o resultado da extração no erro pra o processLead persistir o
      // modo mesmo em falha (Req 3.3 — antes do estado terminal).
      e.extraction = extraction;
      throw e;
    });
    const idcliente = created?.idcliente;
    if (!idcliente) throw new Error(`createCustomer retornou sem idcliente: ${JSON.stringify(created)}`);

    await this.acceptTerms(idcliente).catch(() => {});

    return { idcliente, idsolcontratovalidacao, extraction };
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
