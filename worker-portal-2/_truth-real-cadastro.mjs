/**
 * TESTE REAL com docs do Supabase.
 * - Usa customer existente com CNH + conta
 * - Roda cadastrarCliente (validate → OCR → upload → verify → POST /customers)
 * - NÃO gera OTP / NÃO envia WhatsApp
 */
import { writeFileSync } from 'node:fs';
import { Portal2Client, closeBrowser, fileFromPath } from './portal2-api-client.mjs';
import { evaluateIaGate, buildExtractionResult } from './portal-errors.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CUSTOMER_ID = process.argv[2] || '603d6f4e-f1e3-40b0-8d72-816d0b1d5a35';
const DO_POST = !process.argv.includes('--no-post'); // default: cria idcliente

function decodeAttachment(value, label) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let mime = 'image/jpeg';
  let b64 = value.trim();
  const m = b64.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) { mime = m[1]; b64 = m[2]; }
  else if (b64.startsWith('JVBER')) mime = 'application/pdf';
  else if (b64.startsWith('iVBOR')) mime = 'image/png';
  else if (b64.startsWith('/9j/')) mime = 'image/jpeg';
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length < 500) return null;
  const ext = mime.includes('pdf') ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';
  return { buffer, mime, filename: `${label}.${ext}` };
}

async function fetchUrlAsFile(url, label) {
  if (!url || !String(url).startsWith('http')) return null;
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`download ${label} ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get('content-type') || 'image/jpeg';
  const mime = ct.includes('pdf') ? 'application/pdf' : ct.includes('png') ? 'image/png' : 'image/jpeg';
  const ext = mime.includes('pdf') ? 'pdf' : mime.includes('png') ? 'png' : 'jpg';
  return { buffer: buf, mime, filename: `${label}.${ext}` };
}

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`SB ${r.status} ${(await r.text()).slice(0,200)}`);
  return r.json();
}

const rows = await sb(`customers?id=eq.${CUSTOMER_ID}&select=*`);
if (!rows?.length) throw new Error('customer não encontrado');
const cust = rows[0];
console.log(`Customer ${CUSTOMER_ID}`);
console.log(`  type=${cust.document_type} uf=${cust.address_state} city=${cust.address_city}`);
console.log(`  dist=${cust.distribuidora} kwh=${cust.media_consumo} portal2=${cust.portal2_status} idcliente=${cust.portal2_idcliente}`);

let docFile = decodeAttachment(cust.document_front_base64 || cust.document_front_url, 'doc-frente');
if (!docFile) docFile = await fetchUrlAsFile(cust.document_front_url, 'doc-frente');
let docBackFile = decodeAttachment(cust.document_back_base64 || cust.document_back_url, 'doc-verso');
if (!docBackFile) docBackFile = await fetchUrlAsFile(cust.document_back_url, 'doc-verso');
let billFile = decodeAttachment(cust.bill_base64 || cust.electricity_bill_photo_url, 'conta');
if (!billFile) billFile = await fetchUrlAsFile(cust.electricity_bill_photo_url, 'conta');

console.log(`  doc=${docFile?.filename} ${docFile?.buffer?.length}B mime=${docFile?.mime}`);
console.log(`  back=${docBackFile ? `${docBackFile.filename} ${docBackFile.buffer.length}B` : 'n/a'}`);
console.log(`  bill=${billFile?.filename} ${billFile?.buffer?.length}B mime=${billFile?.mime}`);

if (!docFile || !billFile) throw new Error('anexos insuficientes');

const isCnh = String(cust.document_type || '').toLowerCase().includes('cnh');
if (!isCnh && !docBackFile) {
  console.warn('⚠ RG sem verso — pode falhar no gate de anexos');
}

// igreen id do consultor
let idconsultor = 124170;
if (cust.consultant_id) {
  const cs = await sb(`consultants?id=eq.${cust.consultant_id}&select=igreen_id`);
  idconsultor = Number(cs?.[0]?.igreen_id) || 124170;
}
console.log(`  idconsultor=${idconsultor}`);

const c = new Portal2Client({ idconsultor });

// Pré-check exists
const exists = await c.checkCustomerExists({
  email: cust.email || 'probe@example.com',
  document: String(cust.cpf || '').replace(/\D/g, ''),
});
console.log(`  check-exists:`, JSON.stringify(exists));

const dados = {
  cpf: cust.cpf,
  nome: cust.name,
  dataNascimento: cust.data_nascimento, // pode estar YYYY-MM-DD
  whatsapp: cust.phone_whatsapp || cust.portal2_celular_alt,
  email: cust.email,
  cep: cust.cep,
  endereco: cust.address_street,
  numero: cust.address_number,
  complemento: cust.address_complement || '',
  bairro: cust.address_neighborhood,
  cidade: cust.address_city,
  uf: cust.address_state,
  numeroInstalacao: cust.numero_instalacao,
  consumoMedio: Number(cust.media_consumo) || 350,
  concessionaria: cust.distribuidora,
  docFile,
  docBackFile: isCnh ? undefined : docBackFile || undefined,
  billFile,
  isCnh,
  sendcontract: true,
  contaUnica: !!cust.contaunica,
  transferirTitularidade: !!cust.transferir_titularidade,
  orgaoExpedidor: cust.orgao_expedidor || undefined,
};

// Normalizar data se ISO
if (/^\d{4}-\d{2}-\d{2}/.test(String(dados.dataNascimento || ''))) {
  const [y, m, d] = String(dados.dataNascimento).slice(0, 10).split('-');
  dados.dataNascimento = `${d}/${m}/${y}`;
}

if (!DO_POST || exists?.exists) {
  console.log('\n=== MODO SEM POST (exists ou --no-post) — prova validate/OCR/upload/verify ===');
  const init = await c.initValidation();
  const idsol = init?.idsolcontratovalidacao;
  console.log('idsol', idsol);

  const vDoc = await c.validateUpload({
    fileBuffer: docFile.buffer, filename: docFile.filename, mime: docFile.mime,
    context: 'document', idsolcontratovalidacao: idsol,
  }).catch(e => ({ error: e.message }));
  console.log('validate doc:', vDoc?.is_valid, 'score', vDoc?.score, vDoc?.error || '');

  const vBill = await c.validateUpload({
    fileBuffer: billFile.buffer, filename: billFile.filename, mime: billFile.mime,
    context: 'invoice', idsolcontratovalidacao: idsol,
  }).catch(e => ({ error: e.message }));
  console.log('validate bill:', vBill?.is_valid, 'score', vBill?.score, vBill?.error || '');

  const docResp = await c.extractDocument({
    fileBuffer: docFile.buffer, filename: docFile.filename, mime: docFile.mime, idsolcontratovalidacao: idsol,
  }).catch(e => ({ __transport_error: e.message }));
  console.log('extract doc success=', docResp?.success, 'err=', docResp?.error || docResp?.__transport_error || null);

  let docBackResp = null;
  if (!isCnh && docBackFile) {
    docBackResp = await c.extractDocument({
      fileBuffer: docBackFile.buffer, filename: docBackFile.filename, mime: docBackFile.mime, idsolcontratovalidacao: idsol,
    }).catch(e => ({ __transport_error: e.message }));
    console.log('extract verso success=', docBackResp?.success);
  }

  // Fatura → /extractor/extract (endpoint oficial do passo 2; sem is_authentic)
  const billResp = await c.extractInvoice({
    fileBuffer: billFile.buffer, filename: billFile.filename, mime: billFile.mime, idsolcontratovalidacao: idsol,
    personalDocName: docResp?.data?.nome || cust.name || undefined,
  }).catch(e => ({ __transport_error: e.message }));
  const bd = billResp?.data || {};
  const lista = Array.isArray(bd.lista_consumo) ? bd.lista_consumo.filter(x => Number(x?.consumo) > 0) : [];
  const mediaOcr = lista.length ? Math.round(lista.reduce((s, x) => s + Number(x.consumo), 0) / lista.length) : null;
  console.log('extract bill success=', billResp?.success, 'err=', billResp?.error || billResp?.__transport_error || null);
  console.log('  fatura: nome=', bd.nome_cliente, '| instal=', bd.num_instalacao, '| meses=', lista.length, '| mediaOcr=', mediaOcr, '| name_validation=', JSON.stringify(billResp?.name_validation));

  // uploads
  await c.uploadFile({ fileBuffer: docFile.buffer, filename: docFile.filename, mime: docFile.mime, fileType: 'personal-doc-front', idsolcontratovalidacao: idsol });
  if (!isCnh && docBackFile) {
    await c.uploadFile({ fileBuffer: docBackFile.buffer, filename: docBackFile.filename, mime: docBackFile.mime, fileType: 'personal-doc-back', idsolcontratovalidacao: idsol });
  }
  await c.uploadFile({ fileBuffer: billFile.buffer, filename: billFile.filename, mime: billFile.mime, fileType: 'energy-bill', idsolcontratovalidacao: idsol });
  await new Promise(r => setTimeout(r, 8000));
  let v = await c.verifyUpload(idsol);
  console.log('verify:', JSON.stringify({
    docFront: !!v?.personalDoc?.hasFront,
    docBack: !!v?.personalDoc?.hasBack,
    energy: !!v?.energy?.hasUrl,
  }));

  const extraction = buildExtractionResult({ docResp, docBackResp, billResp, isCnh });
  const gate = evaluateIaGate({ docResp, billResp, dados });
  console.log('extraction.mode=', extraction.mode, 'gate=', gate);

  // resolve + rules
  const conc = await c.resolveConcessionaria(dados.uf, dados.concessionaria, dados.cidade);
  console.log('concessionaria resolvida=', conc);
  const rules = await c.getBonusRules({ uf: dados.uf, concessionaria: conc, consumo_medio: dados.consumoMedio, idsolcontratovalidacao: idsol });
  const list = Array.isArray(rules) ? rules : (rules?.rules ?? []);
  const pick = c._pickActiveBonusRule(list, dados.consumoMedio);
  console.log('bonus=', pick?.fornecedora, pick?.desconto_cliente);

  const out = {
    customer_id: CUSTOMER_ID,
    mode: 'no-post',
    exists,
    validate: { doc: { is_valid: vDoc?.is_valid, score: vDoc?.score }, bill: { is_valid: vBill?.is_valid, score: vBill?.score } },
    extraction: { mode: extraction.mode, doc: extraction.doc?.mode, bill: extraction.bill?.mode },
    gate,
    verify: { docFront: !!v?.personalDoc?.hasFront, docBack: !!v?.personalDoc?.hasBack, energy: !!v?.energy?.hasUrl },
    concessionaria: conc,
    bonus: pick ? { fornecedora: pick.fornecedora, desconto: pick.desconto_cliente } : null,
    // Espelha o fluxo real: extraction.mode é OBSERVACIONAL (não bloqueia POST);
    // o que bloqueia é exists / gate IA / anexos não confirmados.
    wouldPost: !exists?.exists && gate.ok && !!v?.personalDoc?.hasFront && !!v?.energy?.hasUrl,
  };
  writeFileSync('/tmp/truth-real-result.json', JSON.stringify(out, null, 2));
  console.log('\nVEREDITO:', out.wouldPost
    ? `PRONTO PARA POST${extraction.mode === 'manual' ? ' (extração parcial → análise manual, não bloqueia)' : ''}`
    : 'BLOQUEADO / DUPLICADO');
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('\n=== POST REAL /customers (sem OTP) ===');
  try {
    const result = await c.cadastrarCliente(dados);
    console.log('✓ CRIADO idcliente=', result.idcliente, 'idsol=', result.idsolcontratovalidacao);
    console.log('  extraction.mode=', result.extraction?.mode);
    console.log('  fornecedora=', result.fornecedora, 'terms=', result.termsAccepted);
    // NÃO chama generateVerificationCode
    // Persistir no supabase best-effort
    await fetch(`${SUPABASE_URL}/rest/v1/customers?id=eq.${CUSTOMER_ID}`, {
      method: 'PATCH',
      headers: {
        apikey: KEY, Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        portal2_idcliente: result.idcliente,
        portal2_idsolcontratovalidacao: result.idsolcontratovalidacao,
        portal2_status: 'created_truth_test',
        portal2_created_at: new Date().toISOString(),
        portal2_extraction_mode: result.extraction?.mode ?? null,
        fornecedora: result.fornecedora || null,
      }),
    }).then(async (r) => console.log('  supabase patch', r.status), (e) => console.warn('  patch fail', e.message));

    writeFileSync('/tmp/truth-real-result.json', JSON.stringify({
      customer_id: CUSTOMER_ID,
      mode: 'post',
      idcliente: result.idcliente,
      idsol: result.idsolcontratovalidacao,
      extraction_mode: result.extraction?.mode,
      fornecedora: result.fornecedora,
      termsAccepted: result.termsAccepted,
      otp: false,
    }, null, 2));
  } catch (e) {
    console.error('✗ FALHOU:', e.message);
    writeFileSync('/tmp/truth-real-result.json', JSON.stringify({
      customer_id: CUSTOMER_ID,
      mode: 'post',
      error: e.message,
      code: e.code || null,
      body: e.body || null,
    }, null, 2));
    await closeBrowser();
    process.exit(1);
  }
}

await closeBrowser();
