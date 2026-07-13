/**
 * Auditoria de cobertura por distribuidora — SEM POST /customers.
 * Testa: listagem oficial + resolveConcessionaria + /bonus/rules.
 */
import { Portal2Client, closeBrowser } from './portal2-api-client.mjs';

const c = new Portal2Client({ idconsultor: 124170 });

const UFS = ['SP','MG','PR','RJ','RS','SC','BA','GO','MS','MT','ES','CE','PE','PB','AL','SE','PI','MA','RN','TO','DF'];
const ALIASES = [
  // Paulista / CPFL
  ['SP','CPFL PAULISTA','CAMPINAS'],
  ['SP','PAULISTA','CAMPINAS'],
  ['SP','CPFL','CAMPINAS'],
  ['SP','CPFL PIRATININGA','SALTO'],
  ['SP','PIRATININGA','SOROCABA'],
  ['SP','CPFL SANTA CRUZ','BAURU'],
  ['SP','ELEKTRO','SANTOS'],
  ['SP','ELEKTRO','RIO CLARO'],
  ['SP','ENERGISA SUL SUDESTE','PRESIDENTE PRUDENTE'],
  // CEMIG
  ['MG','CEMIG','BELO HORIZONTE'],
  ['MG','CEMIG-D','BELO HORIZONTE'],
  ['MG','CEMIG DISTRIBUICAO','UBERLANDIA'],
  ['MG','CEMIG DISTRIBUIÇÃO','CONTAGEM'],
  // Copel
  ['PR','COPEL','CURITIBA'],
  ['PR','COPEL DISTRIBUICAO','LONDRINA'],
  ['PR','COPEL-DIS','MARINGA'],
  // RJ
  ['RJ','ENEL','RIO DE JANEIRO'],
  ['RJ','LIGHT','RIO DE JANEIRO'],
  ['RJ','ENEL RJ','NITEROI'],
];

console.log('=== 1) Distribuidoras oficiais por UF ===');
const distByUf = {};
for (const uf of UFS) {
  try {
    const d = await c._fetch('GET', '/bonus/distributors', { query: { uf } });
    const names = (Array.isArray(d) ? d : []).map(x => x.concessionaria || x);
    distByUf[uf] = names;
    console.log(`${uf}: ${names.join(' | ') || '(vazio)'}`);
  } catch (e) {
    distByUf[uf] = { error: e.message };
    console.log(`${uf}: ERR ${e.status} ${e.message}`);
  }
}

console.log('\n=== 2) resolveConcessionaria (aliases comuns) ===');
const resolved = [];
for (const [uf, name, city] of ALIASES) {
  try {
    const off = await c.resolveConcessionaria(uf, name, city);
    resolved.push({ uf, name, city, resolved: off });
    console.log(`resolve(${uf},"${name}","${city}") → "${off}"`);
  } catch (e) {
    resolved.push({ uf, name, city, error: e.message });
    console.log(`resolve(${uf},"${name}","${city}") ERR ${e.message}`);
  }
}

console.log('\n=== 3) /bonus/rules com nome RESOLVIDO (consumo 350) ===');
const rulesOk = [];
const rulesFail = [];
const seen = new Set();
for (const r of resolved) {
  const conc = r.resolved;
  if (!conc || r.error) { rulesFail.push({ ...r, reason: 'resolve_null' }); continue; }
  const key = `${r.uf}|${conc}`;
  if (seen.has(key)) continue;
  seen.add(key);
  try {
    const data = await c._fetch('GET', '/bonus/rules', {
      query: { uf: r.uf, concessionaria: conc, consumo_medio: 350 },
    });
    const list = Array.isArray(data) ? data : (data?.rules ?? []);
    const pick = list.find(x => x.desconto_padrao === true) || list[0];
    rulesOk.push({
      uf: r.uf, concessionaria: conc,
      n: list.length,
      fornecedora: pick?.fornecedora,
      desconto: pick?.desconto_cliente,
      padrao: pick?.desconto_padrao,
    });
    console.log(`✓ ${r.uf}/${conc} → ${list.length} regras | fornecedora=${pick?.fornecedora} desconto=${pick?.desconto_cliente}% padrao=${pick?.desconto_padrao}`);
  } catch (e) {
    rulesFail.push({ uf: r.uf, concessionaria: conc, status: e.status, error: String(e.message).slice(0,160) });
    console.log(`✗ ${r.uf}/${conc} → ${e.status} ${String(e.message).slice(0,120)}`);
  }
}

// Também testar nomes oficiais crus (sem alias) de cada UF importante
console.log('\n=== 4) /bonus/rules com TODOS os nomes oficiais SP/MG/PR/RJ ===');
for (const uf of ['SP','MG','PR','RJ']) {
  for (const conc of (distByUf[uf] || [])) {
    const key = `${uf}|${conc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const data = await c._fetch('GET', '/bonus/rules', {
        query: { uf, concessionaria: conc, consumo_medio: 350 },
      });
      const list = Array.isArray(data) ? data : (data?.rules ?? []);
      const pick = list.find(x => x.desconto_padrao === true) || list[0];
      rulesOk.push({ uf, concessionaria: conc, n: list.length, fornecedora: pick?.fornecedora, desconto: pick?.desconto_cliente, padrao: pick?.desconto_padrao });
      console.log(`✓ ${uf}/${conc} → ${list.length} | ${pick?.fornecedora} ${pick?.desconto_cliente}%`);
    } catch (e) {
      rulesFail.push({ uf, concessionaria: conc, status: e.status, error: String(e.message).slice(0,160) });
      console.log(`✗ ${uf}/${conc} → ${e.status} ${String(e.message).slice(0,120)}`);
    }
  }
}

console.log('\n==== RESUMO ====');
console.log(`UFs com distribuidora: ${Object.entries(distByUf).filter(([,v])=>Array.isArray(v)&&v.length).length}`);
console.log(`rules OK: ${rulesOk.length} | FAIL: ${rulesFail.length}`);
console.log('OK:', rulesOk.map(r=>`${r.uf}/${r.concessionaria}`).join(', '));
console.log('FAIL:', rulesFail.map(r=>`${r.uf}/${r.concessionaria||r.name}`).join(', '));

import fs from 'node:fs';
fs.writeFileSync('/tmp/audit-distribuidoras.json', JSON.stringify({ distByUf, resolved, rulesOk, rulesFail }, null, 2));
await closeBrowser();
