/**
 * Contraprova do gate IA_CONTA_ILEGIVEL — manda um arquivo ERRADO (RG frente)
 * no slot da fatura via /extractor/extract e confere que o gate BLOQUEIA.
 * Uso: source /tmp/igreen-probe.env && node _probe-gate-conta-ilegivel.mjs <customer_id>
 * Não faz POST /customers nem upload de dossiê — só OCR + gate local.
 */
import { Portal2Client } from './portal2-api-client.mjs';
import { evaluateIaGate, countInvoiceLegibleFields } from './portal-errors.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CUSTOMER_ID = process.argv[2] || '92b1e988-3919-4d4e-91f3-a74c7466e0a5';

const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/customers?id=eq.${CUSTOMER_ID}&select=document_front_base64,document_front_url,consultant_id,consultants:consultant_id(igreen_id)`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
});
const [cust] = await r.json();
if (!cust) throw new Error('customer não encontrado');

let buffer;
const b64 = cust.document_front_base64;
if (b64) {
  buffer = Buffer.from(String(b64).replace(/^data:[^;]+;base64,/, ''), 'base64');
} else {
  const resp = await fetch(cust.document_front_url);
  buffer = Buffer.from(await resp.arrayBuffer());
}
console.log(`arquivo: RG frente (${buffer.length}B) enviado como "fatura"`);

const withTimeout = (p, ms, tag) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${tag} timeout ${ms}ms`)), ms)),
]);

const c = new Portal2Client({ idconsultor: Number(cust.consultants?.igreen_id) || 124170 });
console.log('init-validation...');
const init = await withTimeout(c.initValidation(), 60_000, 'init');
console.log('idsol=', init?.idsolcontratovalidacao, '— extract (RG como fatura)...');
const t0 = Date.now();
const billResp = await withTimeout(c.extractInvoice({
  fileBuffer: buffer, filename: 'conta.jpg', mime: 'image/jpeg',
  idsolcontratovalidacao: init?.idsolcontratovalidacao,
}), 150_000, 'extract-invoice').catch(e => ({ __transport_error: e.message }));
console.log(`extract levou ${Math.round((Date.now() - t0) / 1000)}s`);

console.log('extract success=', billResp?.success, 'err=', billResp?.error || billResp?.__transport_error || null);
console.log('campos-chave legíveis=', countInvoiceLegibleFields(billResp?.data), 'data keys=', Object.keys(billResp?.data || {}));

const gate = evaluateIaGate({ docResp: { success: true }, billResp });
console.log('\nGATE:', JSON.stringify(gate, null, 2));
console.log('\nVEREDITO:', gate.ok ? '❌ PASSOU (ruim — buraco aberto!)' : `✅ BLOQUEADO (${gate.code})`);
process.exit(gate.ok ? 1 : 0);
