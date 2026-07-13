/**
 * AUDITORIA — health-check do caminho de DADOS do cadastro.
 * NÃO cria cliente, NÃO gera OTP, NÃO chama manual-fallback.
 * Só: license, init-validation, thresholds, bonus/*, viacep, check-exists, check-installation.
 */
import { Portal2Client, closeBrowser } from './portal2-api-client.mjs';

const c = new Portal2Client({ idconsultor: 124170 });
const results = [];
async function step(label, fn) {
  const t = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t;
    const preview = JSON.stringify(r).slice(0, 260);
    results.push({ label, ok: true, ms, preview });
    console.log(`✓ ${label} (${ms}ms) ${preview}`);
    return r;
  } catch (e) {
    const ms = Date.now() - t;
    results.push({ label, ok: false, ms, status: e.status, error: String(e.message).slice(0, 200) });
    console.log(`✗ ${label} (${ms}ms) status=${e.status} ${String(e.message).slice(0,200)}`);
    return null;
  }
}

// 1. Licença consultor
await step('license', () => c._fetch('GET', '/consultants/124170/license'));

// 2. init-validation (aloca idsol — inofensivo)
const init = await step('init-validation', () => c.initValidation());
const idsol = init?.idsolcontratovalidacao;

// 3. thresholds
await step('validation-thresholds', () => c._fetch('GET', '/form-config/validation-thresholds'));

// 4. bonus states / distributors / rules (SP CPFL, consumo 350)
await step('bonus/states', () => c._fetch('GET', '/bonus/states'));
await step('bonus/distributors?uf=SP', () => c._fetch('GET', '/bonus/distributors', { query: { uf: 'SP' } }));
const rules = await step('bonus/rules SP/CPFL PIRATININGA/350', () =>
  c._fetch('GET', '/bonus/rules', { query: { uf: 'SP', concessionaria: 'CPFL PIRATININGA', consumo_medio: 350, idsolcontratovalidacao: idsol } }));

// 5. viacep
await step('viacep/13323630', () => c._fetch('GET', '/viacep/13323630'));

// 6. check-exists (email+doc claramente de teste — só retorna exists:true/false)
await step('check-exists (teste)', () => c._fetch('GET', '/customers/check-exists', { query: { email: 'nao-existe-xyz-teste@example.com', document: '11144477735', idconsultor: 124170 } }));

// 7. check-installation
await step('check-installation (teste)', () => c._fetch('GET', '/customers/check-installation', { query: { numinstalacao: '0000000000', concessionaria: 'CPFL PIRATININGA', uf: 'SP' } }));

// 8. form-config (state/distributor) — campos dinâmicos exigidos por região
await step('form-config SP/CPFL', () => c._fetch('GET', '/form-config', { query: { state: 'SP', distributor: 'CPFL PIRATININGA' } }).catch(e=>{throw e;}));

console.log('\n==== RESUMO ====');
const ok = results.filter(r => r.ok).length;
console.log(`${ok}/${results.length} endpoints OK`);
for (const r of results) console.log(`${r.ok?'OK ':'ERR'} ${r.label}${r.ok?'':' → '+(r.error||'')}`);

// Detalhe das regras (fornecedora/desconto) — é o que define o payload
if (rules) {
  const list = Array.isArray(rules) ? rules : (rules?.rules ?? []);
  console.log('\nBONUS RULES retornadas:', Array.isArray(list) ? list.length : 'n/a');
  console.log(JSON.stringify(list).slice(0, 700));
}
import fs from 'node:fs';
fs.writeFileSync('/tmp/audit-healthcheck.json', JSON.stringify({ idsol, results, rules }, null, 2));
await closeBrowser();
