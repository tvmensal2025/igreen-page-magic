// ─────────────────────────────────────────────────────────────────────────────
// PROBE: validar o Modo_Extração (auto vs manual) no caminho feliz do Portal 2
// ─────────────────────────────────────────────────────────────────────────────
//
// OBJETIVO (Task 2.2): confirmar que, para o customer de referência (CNH +
// conta de energia já anexadas), a derivação de extração usada por
// `cadastrarCliente` resulta em `extraction.mode === 'auto'` — ou seja, a
// IA do Portal 2 leu e aceitou documento e conta automaticamente (Req 1/2/3).
//
// COMO funciona (não-destrutivo por padrão):
//   Reproduz EXATAMENTE a fase de extração de `cadastrarCliente`
//   (init-validation → extract-document frente [+ verso se RG] → extract-receipt)
//   e roda o MESMO `buildExtractionResult(...)` de `portal-errors.mjs` que o
//   client usa internamente. NÃO chama o `createCustomer`/`acceptTerms`, logo
//   NÃO cria um cliente real no Portal 2 (a criação é um efeito colateral
//   irreversível num sistema externo, e o customer de referência já costuma
//   estar cadastrado — `checkCustomerExists` lançaria antes de retornar).
//
//   Como `buildExtractionResult` é a única fonte do `extraction.mode` em
//   `cadastrarCliente`, reproduzir as mesmas entradas + a mesma função confirma
//   fielmente o `mode='auto'` do caminho feliz sem o efeito colateral.
//
// LGPD (Req 12): este script NUNCA imprime PII em claro. Todo objeto exibido ou
//   salvo passa por `sanitize` de `ai-audit.mjs` (CPF/documento → 4 últimos
//   dígitos; base64/buffers omitidos). O nome do cliente é mascarado. As
//   respostas brutas dos extractors (que contêm `data.nome`/`data.cpf`/`raw`)
//   NÃO são impressas nem persistidas — apenas o `extraction` derivado.
//
// USO (rodar na VPS onde o worker vive, com .env configurado):
//   node probe-extraction-mode.mjs [customer_id]
//
// Variáveis de ambiente necessárias (lidas de worker-portal-2/.env):
//   SUPABASE_URL                (ou VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY   (ou VITE_SUPABASE_PUBLISHABLE_KEY)
//
// Default customer_id: 6d839c38-aa41-4741-bfb2-df46a5591d3d
//   (mesmo customer de referência do probe-extractor.mjs — document_type=cnh,
//    frente JPEG + conta JPEG)
//
// Saída:
//   - console: resumo mascarado (modo do cadastro + modo por extractor + motivo
//     quando manual) e veredito PASS/FAIL.
//   - arquivo: probe-extraction-mode-result.json (SANITIZADO) no diretório atual.
//   - exit code: 0 quando mode==='auto'; 1 caso contrário (ou em erro).
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { Portal2Client, closeBrowser } from './portal2-api-client.mjs';
import { buildExtractionResult } from './portal-errors.mjs';
import { sanitize } from './ai-audit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const CUSTOMER_ID = process.argv[2] || '6d839c38-aa41-4741-bfb2-df46a5591d3d';

// Mesmo timeout que `cadastrarCliente` aplica aos extractors (Req 1.4/2.4).
const EXTRACTOR_TIMEOUT_MS = 30_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Espelha o withTimeout interno do client: erro de transporte/HTTP/timeout 30s
// vira `__transport_error`, que buildExtractionResult interpreta como manual.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${label} (${ms}ms)`)), ms)),
  ]);
}

// Mascara o nome (PII) mantendo só a 1ª letra de cada token. "VIVIANE SILVA" → "V*** S***".
function maskName(name) {
  if (typeof name !== 'string' || !name.trim()) return '(sem nome)';
  return name.trim().split(/\s+/).map(t => `${t[0].toUpperCase()}***`).join(' ');
}

// Decodifica um valor base64 puro ou data URL (data:<mime>;base64,...)
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
    'id', 'document_type', 'name',
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

// Roda um extractor com timeout; em erro de transporte/HTTP/timeout marca
// __transport_error (igual a cadastrarCliente), pra buildExtractionResult tratar
// como manual (Req 1.4/2.4).
async function runExtractor(label, fn) {
  try {
    return await withTimeout(fn(), EXTRACTOR_TIMEOUT_MS, label);
  } catch (e) {
    console.warn(`  ⚠ ${label} falhou: ${e.message}`);
    return { __transport_error: e.message };
  }
}

// Resumo seguro (sem PII) do motivo de uma queda em manual.
function manualReason(extraction) {
  const reasons = [];
  if (extraction.doc?.mode === 'manual') {
    reasons.push(`documento: ${extraction.doc.error || 'leitura não aceita'}`);
  }
  if (extraction.bill?.mode === 'manual') {
    reasons.push(`conta: ${extraction.bill.rejection_reason || extraction.bill.error || 'leitura/autenticidade não aceita'}`);
  }
  return reasons.length ? reasons.join(' | ') : '(motivo não disponível)';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔎 PROBE extraction-mode — customer=${CUSTOMER_ID}\n`);

  const c = await fetchCustomer(CUSTOMER_ID);
  const igreenId = await fetchIgreenId(c.consultant_id);
  console.log(`  cliente: ${maskName(c.name)} | doc_type=${c.document_type || '?'} | idconsultor=${igreenId}`);

  const isCnh =
    String(c.document_back_url || '') === 'nao_aplicavel' ||
    String(c.document_type || '').toLowerCase().includes('cnh');

  const docFront = decodeAttachment(c.document_front_base64 || c.document_front_url, 'doc-frente');
  const docBack = isCnh ? null : decodeAttachment(c.document_back_base64 || c.document_back_url, 'doc-verso');
  const bill = decodeAttachment(c.bill_base64 || c.electricity_bill_photo_url, 'conta');

  console.log(`  anexos: frente=${docFront ? docFront.mime + ' ' + docFront.buffer.length + 'B' : 'AUSENTE'}`
    + ` | verso=${isCnh ? 'N/A (CNH)' : (docBack ? docBack.mime : 'AUSENTE')}`
    + ` | conta=${bill ? bill.mime + ' ' + bill.buffer.length + 'B' : 'AUSENTE'}`);

  // Caminho feliz exige documento (frente) + conta; RG exige também verso.
  const faltando = [];
  if (!bill) faltando.push('conta de energia');
  if (!docFront) faltando.push('documento (frente)');
  if (!isCnh && !docBack) faltando.push('documento (verso)');
  if (faltando.length) {
    throw new Error(`customer de referência sem anexos do caminho feliz: ${faltando.join(', ')}`);
  }

  const client = new Portal2Client({ idconsultor: igreenId });

  let docResp = null;
  let docBackResp = null;
  let billResp = null;

  try {
    // 1. init-validation — abre a sessão de validação (mesmo idsol pros extractors)
    console.log(`\n▶ initValidation()`);
    const init = await client.initValidation();
    const idsol = init?.idsolcontratovalidacao || null;
    console.log(`  → idsolcontratovalidacao = ${idsol}`);

    // 2. extract-document (frente)
    console.log(`▶ extractDocument(frente)  [${docFront.mime}, ${docFront.buffer.length}B]`);
    docResp = await runExtractor('extract-document', () => client.extractDocument({
      fileBuffer: docFront.buffer,
      filename: docFront.filename,
      mime: docFront.mime,
      idsolcontratovalidacao: idsol,
    }));

    // 2b. extract-document (verso) — só RG
    if (docBack) {
      console.log(`▶ extractDocument(verso)  [${docBack.mime}, ${docBack.buffer.length}B]`);
      docBackResp = await runExtractor('extract-document(verso)', () => client.extractDocument({
        fileBuffer: docBack.buffer,
        filename: docBack.filename,
        mime: docBack.mime,
        idsolcontratovalidacao: idsol,
      }));
    }

    // 3. extract-receipt (conta de energia)
    console.log(`▶ extractReceipt(conta)  [${bill.mime}, ${bill.buffer.length}B]`);
    billResp = await runExtractor('extract-receipt', () => client.extractReceipt({
      fileBuffer: bill.buffer,
      filename: bill.filename,
      mime: bill.mime,
      idsolcontratovalidacao: idsol,
    }));
  } finally {
    await closeBrowser().catch(() => {});
  }

  // ── Derivação do Modo_Extração — MESMA função usada por cadastrarCliente ──
  const extraction = buildExtractionResult({
    docResp,
    docBackResp,
    billResp,
    isCnh,
    billAlreadyExtracted: false,
  });

  // Saída sanitizada (Req 12): nunca PII em claro.
  const safeExtraction = sanitize(extraction);
  console.log(`\n── EXTRAÇÃO DERIVADA (sanitizada) ──`);
  console.log(`  modo do cadastro : ${extraction.mode}`);
  console.log(`  documento        : mode=${extraction.doc.mode} success=${extraction.doc.success}`);
  console.log(`  conta            : mode=${extraction.bill.mode} success=${extraction.bill.success} is_authentic=${extraction.bill.is_authentic}`);
  console.log(`  detalhe (safe)   : ${JSON.stringify(safeExtraction)}`);

  const out = {
    probe: 'extraction-mode',
    customer_id: CUSTOMER_ID,
    customer_name_masked: maskName(c.name),
    document_type: c.document_type || null,
    is_cnh: isCnh,
    idconsultor: igreenId,
    at: new Date().toISOString(),
    extraction: safeExtraction,         // já sanitizado
    expected_mode: 'auto',
    actual_mode: extraction.mode,
    pass: extraction.mode === 'auto',
  };
  const outPath = join(__dirname, 'probe-extraction-mode-result.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n💾 resultado (sanitizado) salvo em: ${outPath}`);

  // ── Veredito ──
  if (extraction.mode === 'auto') {
    console.log(`\n✅ PASS — caminho feliz: extraction.mode === 'auto' (IA do Portal 2 aceitou doc + conta).\n`);
    process.exitCode = 0;
  } else {
    console.log(`\n❌ FAIL — esperado 'auto', obtido '${extraction.mode}'. Motivo: ${manualReason(extraction)}\n`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\n❌ PROBE falhou: ${e.message}\n`);
  closeBrowser().catch(() => {});
  process.exitCode = 1;
});
