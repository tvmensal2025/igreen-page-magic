// PROBE 2: descobrir o nome correto do campo multipart do /extractor/extract-document
// (extract-receipt aceita "file"; extract-document rejeita com "Unexpected field - file").
//
// Tenta uma lista de nomes de campo candidatos e reporta qual o backend aceita,
// + captura o JSON COMPLETO de resposta do que funcionar (veredito do documento).
//
// USO: node probe-doc-field.mjs [customer_id]

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { chromium } from 'playwright-chromium';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CUSTOMER_ID = process.argv[2] || '6d839c38-aa41-4741-bfb2-df46a5591d3d';

const BASE_URL = 'https://api-green-connection.igreenenergy.com.br';
const PORTAL_LANDING = 'https://green.igreenenergy.com.br/autoconexao/';
const APP_ID = 'igreen-web-v1';
const SECRET = 'e8047bfd04cab6dac3d3d7d276347eddb3da57ec5f2670f476727c2744bf7b05';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Candidatos a nome de campo (multer/NestJS). "file" já falhou.
const FIELD_CANDIDATES = ['document', 'documento', 'image', 'imagem', 'arquivo', 'doc', 'files', 'front', 'frente', 'foto'];

function signRequest(method, pathname) {
  const timestamp = new Date().toISOString();
  const payload = `${method.toUpperCase()}\n${pathname}\n${timestamp}\n${APP_ID}`;
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return {
    'x-frontend-app-id': APP_ID,
    'x-frontend-timestamp': timestamp,
    'x-frontend-signature': signature,
  };
}

function decodeAttachment(value) {
  if (typeof value !== 'string') return null;
  let mime = 'image/jpeg', b64 = value.trim();
  const m = b64.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) { mime = m[1]; b64 = m[2]; }
  const buffer = Buffer.from(b64, 'base64');
  return buffer.length > 100 ? { buffer, mime } : null;
}

async function fetchFront(customerId) {
  const url = `${SUPABASE_URL}/rest/v1/customers?id=eq.${customerId}&select=document_front_base64,document_front_url,document_type,consultant_id`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  const rows = await r.json();
  return rows[0];
}

async function main() {
  const c = await fetchFront(CUSTOMER_ID);
  const front = decodeAttachment(c.document_front_base64 || c.document_front_url);
  if (!front) throw new Error('sem documento frente');
  console.log(`doc frente: ${front.mime} ${front.buffer.length}B (type=${c.document_type})`);

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({ userAgent: UA, locale: 'pt-BR' });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
  const page = await ctx.newPage();
  await page.goto(`${PORTAL_LANDING}?id=124170`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4500);

  // init-validation pra ter idsol
  const initHeaders = signRequest('POST', '/extractor/init-validation');
  const init = await page.evaluate(async ({ url, headers }) => {
    const res = await fetch(url, { method: 'POST', headers });
    return { status: res.status, body: await res.text() };
  }, { url: `${BASE_URL}/extractor/init-validation`, headers: initHeaders });
  const idsol = JSON.parse(init.body || '{}')?.idsolcontratovalidacao || null;
  console.log(`idsol=${idsol}`);

  const fileB64 = front.buffer.toString('base64');
  const results = {};

  for (const field of FIELD_CANDIDATES) {
    const headers = signRequest('POST', '/extractor/extract-document');
    const r = await page.evaluate(async ({ url, headers, fileB64, fileMime, idsol, field }) => {
      try {
        const fd = new FormData();
        if (idsol) fd.append('idsolcontratovalidacao', String(idsol));
        const bin = atob(fileB64); const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        fd.append(field, new Blob([arr], { type: fileMime }), 'doc.jpg');
        const res = await fetch(url, { method: 'POST', headers, body: fd });
        return { status: res.status, body: await res.text() };
      } catch (e) { return { err: String(e) }; }
    }, { url: `${BASE_URL}/extractor/extract-document`, headers, fileB64, fileMime: front.mime, idsol, field });

    let parsed = null; try { parsed = JSON.parse(r.body); } catch {}
    const msg = parsed?.message || r.body?.slice(0, 80) || r.err;
    const ok = r.status >= 200 && r.status < 300;
    results[field] = { status: r.status, ok, body: parsed ?? r.body };
    console.log(`  field="${field}" → ${r.status} ${ok ? '✅' : ''} ${ok ? '' : '| ' + msg}`);
    if (ok) {
      console.log(`\n✅ CAMPO CORRETO: "${field}"\nRESPOSTA COMPLETA:\n${JSON.stringify(parsed, null, 2)}\n`);
      break;
    }
    await page.waitForTimeout(400);
  }

  writeFileSync(join(__dirname, 'probe-doc-field-result.json'), JSON.stringify({ idsol, results }, null, 2));
  await browser.close();
}

main().catch((e) => { console.error('❌', e.message); process.exitCode = 1; });
