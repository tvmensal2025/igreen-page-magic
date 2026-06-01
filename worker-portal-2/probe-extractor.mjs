// ─────────────────────────────────────────────────────────────────────────────
// PROBE: descobrir o shape de resposta dos extractors do Portal 2
// ─────────────────────────────────────────────────────────────────────────────
//
// OBJETIVO (Task 1): capturar o JSON COMPLETO que /extractor/extract-document
// e /extractor/extract-receipt devolvem, pra mapear se existe campo de veredito
// (aprovado/reprovado/needs_review/confidence). NÃO cria cliente — só faz OCR.
//
// Usa um customer real (CNH + conta de energia já anexadas) e reaproveita o
// Portal2Client de produção (HMAC + Playwright como tunnel Cloudflare).
//
// USO (rodar na VPS onde o worker vive, com .env configurado):
//   node probe-extractor.mjs [customer_id]
//
// Default customer_id: 6d839c38-aa41-4741-bfb2-df46a5591d3d
//   (BENEDITA DE JESUS GALVAO — document_type=cnh, frente JPEG + conta JPEG)
//
// Saída: imprime no console e grava probe-extractor-result.json no diretório
// atual com TODO o retorno (sem truncar) de cada chamada.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { Portal2Client, closeBrowser, onlyDigits } from './portal2-api-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const CUSTOMER_ID = process.argv[2] || '6d839c38-aa41-4741-bfb2-df46a5591d3d';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Decodifica um valor que pode ser base64 puro ou data URL (data:<mime>;base64,...)
// em { buffer, mime, filename }. Retorna null se não der.
function decodeAttachment(value, label) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let mime = 'image/jpeg';
  let b64 = value.trim();
  const m = b64.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) {
    mime = m[1];
    b64 = m[2];
  }
  // sniff por magic bytes quando veio base64 puro sem data URL
  if (!m) {
    if (b64.startsWith('JVBER')) mime = 'application/pdf';      // %PDF
    else if (b64.startsWith('iVBOR')) mime = 'image/png';        // PNG
    else if (b64.startsWith('/9j/')) mime = 'image/jpeg';        // JPEG
  }
  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (buffer.length < 100) return null;
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
  return { buffer, mime, filename: `${label}.${ext}` };
}

// Busca os anexos do customer via Supabase REST (sem precisar do SDK).
async function fetchCustomer(customerId) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no .env');
  }
  const select = [
    'id', 'document_type', 'name', 'cpf',
    'document_front_base64', 'document_front_url',
    'document_back_base64', 'document_back_url',
    'bill_base64', 'electricity_bill_photo_url',
    'consultant_id',
  ].join(',');
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/customers?id=eq.${customerId}&select=${select}`;
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) throw new Error(`Supabase REST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (!rows?.length) throw new Error(`customer ${customerId} não encontrado`);
  return rows[0];
}

// Resolve o igreen_id do consultor do customer (fallback 124170 = Rafael).
async function fetchIgreenId(consultantId) {
  if (!consultantId) return 124170;
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/consultants?id=eq.${consultantId}&select=igreen_id`;
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' },
  });
  if (!r.ok) return 124170;
  const rows = await r.json();
  return Number(rows?.[0]?.igreen_id) || 124170;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔎 PROBE extractor — customer=${CUSTOMER_ID}\n`);

  const c = await fetchCustomer(CUSTOMER_ID);
  const igreenId = await fetchIgreenId(c.consultant_id);
  console.log(`  cliente: ${c.name || '?'} | doc_type=${c.document_type || '?'} | idconsultor=${igreenId}`);

  const isCnh =
    String(c.document_back_url || '') === 'nao_aplicavel' ||
    String(c.document_type || '').toLowerCase().includes('cnh');

  const docFront = decodeAttachment(c.document_front_base64 || c.document_front_url, 'doc-frente');
  const docBack = isCnh ? null : decodeAttachment(c.document_back_base64 || c.document_back_url, 'doc-verso');
  const bill = decodeAttachment(c.bill_base64 || c.electricity_bill_photo_url, 'conta');

  console.log(`  anexos: frente=${docFront ? docFront.mime + ' ' + docFront.buffer.length + 'B' : 'AUSENTE'}`
    + ` | verso=${isCnh ? 'N/A (CNH)' : (docBack ? docBack.mime : 'AUSENTE')}`
    + ` | conta=${bill ? bill.mime + ' ' + bill.buffer.length + 'B' : 'AUSENTE'}`);

  if (!docFront && !bill) throw new Error('sem documento nem conta pra extrair — nada a sondar');

  // Tracer captura cada call (request resumido + response JSON completo).
  const traceEvents = [];
  const tracer = { push: (e) => traceEvents.push(e) };

  const client = new Portal2Client({ idconsultor: igreenId, tracer });

  const out = {
    customer_id: CUSTOMER_ID,
    customer_name: c.name || null,
    document_type: c.document_type || null,
    is_cnh: isCnh,
    idconsultor: igreenId,
    started_at: new Date().toISOString(),
    calls: {},
  };

  try {
    // 1. init-validation — abre a sessão de validação
    console.log(`\n▶ initValidation()`);
    const init = await client.initValidation().catch((e) => ({ __error: e.message, body: e.body }));
    out.calls.initValidation = init;
    const idsol = init?.idsolcontratovalidacao || null;
    console.log(`  → idsolcontratovalidacao = ${idsol}`);
    console.log(`  RAW: ${JSON.stringify(init)}`);

    // 2. extract-document (CNH/RG frente) — É AQUI que esperamos o veredito do doc
    if (docFront) {
      console.log(`\n▶ extractDocument(frente)  [${docFront.mime}, ${docFront.buffer.length}B]`);
      const resp = await client.extractDocument({
        fileBuffer: docFront.buffer,
        filename: docFront.filename,
        mime: docFront.mime,
        idsolcontratovalidacao: idsol,
      }).catch((e) => ({ __error: e.message, status: e.status, body: e.body }));
      out.calls.extractDocumentFront = resp;
      console.log(`  RAW RESPONSE:\n${JSON.stringify(resp, null, 2)}`);
    }

    // 2b. extract-document (verso) — só RG
    if (docBack) {
      console.log(`\n▶ extractDocument(verso)  [${docBack.mime}, ${docBack.buffer.length}B]`);
      const resp = await client.extractDocument({
        fileBuffer: docBack.buffer,
        filename: docBack.filename,
        mime: docBack.mime,
        idsolcontratovalidacao: idsol,
      }).catch((e) => ({ __error: e.message, status: e.status, body: e.body }));
      out.calls.extractDocumentBack = resp;
      console.log(`  RAW RESPONSE:\n${JSON.stringify(resp, null, 2)}`);
    }

    // 3. extract-receipt (conta de energia) — veredito da fatura
    if (bill) {
      console.log(`\n▶ extractReceipt(conta)  [${bill.mime}, ${bill.buffer.length}B]`);
      const resp = await client.extractReceipt({
        fileBuffer: bill.buffer,
        filename: bill.filename,
        mime: bill.mime,
        idsolcontratovalidacao: idsol,
      }).catch((e) => ({ __error: e.message, status: e.status, body: e.body }));
      out.calls.extractReceipt = resp;
      console.log(`  RAW RESPONSE:\n${JSON.stringify(resp, null, 2)}`);
    }
  } finally {
    out.finished_at = new Date().toISOString();
    out.trace_events = traceEvents;
    await closeBrowser().catch(() => {});
  }

  const outPath = join(__dirname, 'probe-extractor-result.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ resultado completo salvo em: ${outPath}`);

  // Resumo: aponta candidatos a campo de veredito em cada resposta
  console.log(`\n── CANDIDATOS A CAMPO DE VEREDITO ──`);
  for (const [name, resp] of Object.entries(out.calls)) {
    const keys = collectKeys(resp);
    const verdictish = keys.filter((k) =>
      /valid|aprov|reprov|approv|reject|status|confid|score|review|success|error|fraud|match|warning|alert/i.test(k));
    console.log(`  ${name}: ${verdictish.length ? verdictish.join(', ') : '(nenhum campo óbvio — ver JSON completo)'}`);
  }
  console.log('');
}

// Coleta todas as chaves (com path) de um objeto aninhado, pra varrer candidatos.
function collectKeys(obj, prefix = '', acc = []) {
  if (obj == null || typeof obj !== 'object') return acc;
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    acc.push(path);
    if (v && typeof v === 'object' && !Array.isArray(v)) collectKeys(v, path, acc);
    else if (Array.isArray(v) && v[0] && typeof v[0] === 'object') collectKeys(v[0], `${path}[0]`, acc);
  }
  return acc;
}

main().catch((e) => {
  console.error(`\n❌ PROBE falhou: ${e.message}\n`);
  closeBrowser().catch(() => {});
  process.exitCode = 1;
});
