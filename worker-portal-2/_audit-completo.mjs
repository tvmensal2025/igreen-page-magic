/**
 * Auditoria COMPLETA — todas UFs/distribuidoras + aliases + gaps CITY_HINT.
 * SEM POST /customers.
 */
import { Portal2Client, closeBrowser } from './portal2-api-client.mjs';
import fs from 'node:fs';

const c = new Portal2Client({ idconsultor: 124170 });

const UFS = ['SP','MG','PR','RJ','RS','SC','BA','GO','MS','MT','ES','CE','PE','PB','AL','SE','PI','MA','RN','TO','DF','PA','AM','AP','AC','RO','RR'];

// Aliases OCR/lead comuns que costumam aparecer no WhatsApp
const ALIAS_BATTERY = [
  ['SP','CPFL PAULISTA','RIBEIRAO PRETO'],
  ['SP','PAULISTA','RIBEIRAO PRETO'],
  ['SP','CPFL ENERGIA','CAMPINAS'],
  ['SP','CPFL PIRATININGA','SALTO'],
  ['SP','PIRATININGA','SOROCABA'],
  ['SP','CPFL STA CRUZ','OURINHOS'],
  ['SP','ELEKTRO','CAMPINAS'],
  ['SP','ELEKTRO','BAURU'],
  ['SP','ENEL','SAO PAULO'],
  ['SP','ENEL SP','GUARULHOS'],
  ['SP','ELETROPAULO','SAO PAULO'],
  ['SP','EDP','SAO JOSE DOS CAMPOS'],
  ['SP','BANDEIRANTE','TAUBATE'],
  ['MG','CEMIG','BELO HORIZONTE'],
  ['MG','CEMIG D','UBERLANDIA'],
  ['MG','CEMIG-D','CONTAGEM'],
  ['PR','COPEL','CURITIBA'],
  ['PR','COPEL DIS','LONDRINA'],
  ['PR','COPEL-DIS','MARINGA'],
  ['RJ','ENEL','NITEROI'],
  ['RJ','ENEL RJ','CAMPOS DOS GOYTACAZES'],
  ['RJ','LIGHT','RIO DE JANEIRO'],
  ['RJ','AMPLA','MACAE'],
  ['RS','CEEE','PORTO ALEGRE'],
  ['RS','RGE','CAXIAS DO SUL'],
  ['SC','CELESC','FLORIANOPOLIS'],
  ['BA','COELBA','SALVADOR'],
  ['CE','ENEL','FORTALEZA'],
  ['CE','COELCE','FORTALEZA'],
  ['PE','CELPE','RECIFE'],
  ['PE','NEO ENERGIA','RECIFE'],
  ['GO','CELG','GOIANIA'],
  ['GO','EQUATORIAL','GOIANIA'],
  ['MT','ENERGISA','CUIABA'],
  ['MS','ENERGISA','CAMPO GRANDE'],
  ['MS','ELEKTRO','TRES LAGOAS'],
  ['ES','EDP','VITORIA'],
  ['ES','ESCELSA','VITORIA'],
  ['PB','ENERGISA','JOAO PESSOA'],
  ['RN','COSERN','NATAL'],
  ['AL','EQUATORIAL','MACEIO'],
  ['SE','ENERGISA','ARACAJU'],
  ['TO','ENERGISA','PALMAS'],
  ['MA','CEMAR','SAO LUIS'],
  ['PI','CEPISA','TERESINA'],
  ['PA','CELPA','BELEM'],
  ['PA','EQUATORIAL PA','BELEM'],
  ['DF','CEB','BRASILIA'],
];

const distByUf = {};
console.log('=== 1) TODAS as distribuidoras oficiais + /bonus/rules ===');
const rulesMatrix = [];
for (const uf of UFS) {
  let dists = [];
  try {
    const d = await c._fetch('GET', '/bonus/distributors', { query: { uf } });
    dists = (Array.isArray(d) ? d : []).map(x => x.concessionaria || x).filter(Boolean);
  } catch (e) {
    distByUf[uf] = { error: String(e.message).slice(0,120) };
    console.log(`${uf}: ERR list ${e.status}`);
    continue;
  }
  distByUf[uf] = dists;
  if (!dists.length) {
    console.log(`${uf}: (sem cobertura)`);
    continue;
  }
  for (const conc of dists) {
    try {
      const data = await c._fetch('GET', '/bonus/rules', {
        query: { uf, concessionaria: conc, consumo_medio: 350 },
      });
      const list = Array.isArray(data) ? data : (data?.rules ?? []);
      const pick = list.find(x => x.desconto_padrao === true) || list[0] || null;
      const row = {
        uf, concessionaria: conc, ok: true, n: list.length,
        fornecedora: pick?.fornecedora ?? null,
        desconto: pick?.desconto_cliente ?? null,
        padrao: pick?.desconto_padrao ?? null,
        kwh_min: pick?.kwh_min ?? pick?.consumo_min ?? null,
        kwh_max: pick?.kwh_max ?? pick?.consumo_max ?? null,
      };
      rulesMatrix.push(row);
      console.log(`✓ ${uf}/${conc} → ${list.length} | ${pick?.fornecedora} ${pick?.desconto_cliente}%`);
    } catch (e) {
      rulesMatrix.push({ uf, concessionaria: conc, ok: false, status: e.status, error: String(e.message).slice(0,160) });
      console.log(`✗ ${uf}/${conc} → ${e.status} ${String(e.message).slice(0,100)}`);
    }
  }
}

console.log('\n=== 2) ALIASES OCR/lead ===');
const aliasResults = [];
for (const [uf, name, city] of ALIAS_BATTERY) {
  let resolved = null, err = null;
  try {
    resolved = await c.resolveConcessionaria(uf, name, city);
  } catch (e) {
    err = e.message;
  }
  let rulesOk = null, rulesErr = null, fornecedora = null, desconto = null;
  if (resolved) {
    try {
      const data = await c._fetch('GET', '/bonus/rules', {
        query: { uf, concessionaria: resolved, consumo_medio: 350 },
      });
      const list = Array.isArray(data) ? data : (data?.rules ?? []);
      const pick = list.find(x => x.desconto_padrao === true) || list[0];
      rulesOk = true;
      fornecedora = pick?.fornecedora;
      desconto = pick?.desconto_cliente;
    } catch (e) {
      rulesOk = false;
      rulesErr = String(e.message).slice(0,120);
    }
  }
  const row = { uf, name, city, resolved, err, rulesOk, rulesErr, fornecedora, desconto };
  aliasResults.push(row);
  const mark = resolved && rulesOk ? '✓' : (resolved && rulesOk === false ? '⚠' : '✗');
  console.log(`${mark} ${uf} "${name}" @${city} → ${resolved}${rulesOk===false?' RULES_FAIL '+rulesErr:''}${!resolved?' (null)':''}`);
}

// CEP→concessionaria samples for ambiguous cities
console.log('\n=== 3) CEP samples (ambíguas) ===');
const ceps = [
  ['13323630','Salto/SP esperado CPFL'],
  ['13010000','Campinas/SP'],
  ['14010000','Ribeirão Preto/SP'],
  ['11010000','Santos/SP'],
  ['30110000','BH/MG'],
  ['80010000','Curitiba/PR'],
  ['20010000','Rio/RJ LIGHT?'],
  ['24020000','Niterói/RJ ENEL'],
  ['90010000','POA/RS'],
  ['88010000','Floripa/SC'],
];
const cepResults = [];
for (const [cep, note] of ceps) {
  try {
    const r = await c.resolveConcessionariaByCep(cep);
    cepResults.push({ cep, note, ...r });
    console.log(`CEP ${cep} (${note}) → ${JSON.stringify(r)}`);
  } catch (e) {
    cepResults.push({ cep, note, error: e.message });
    console.log(`CEP ${cep} ERR ${e.message}`);
  }
}

const summary = {
  totalOfficial: rulesMatrix.length,
  officialOk: rulesMatrix.filter(r => r.ok).length,
  officialFail: rulesMatrix.filter(r => !r.ok),
  ufsSemCobertura: UFS.filter(uf => !distByUf[uf] || (Array.isArray(distByUf[uf]) && !distByUf[uf].length) || distByUf[uf]?.error),
  aliasOk: aliasResults.filter(a => a.resolved && a.rulesOk).length,
  aliasFailResolve: aliasResults.filter(a => !a.resolved),
  aliasFailRules: aliasResults.filter(a => a.resolved && a.rulesOk === false),
};

console.log('\n==== RESUMO ====');
console.log(`Oficiais: ${summary.officialOk}/${summary.totalOfficial} OK`);
console.log(`UFs sem cobertura: ${summary.ufsSemCobertura.join(',')}`);
console.log(`Aliases OK: ${summary.aliasOk}/${aliasResults.length}`);
console.log(`Aliases FAIL resolve:`, summary.aliasFailResolve.map(a=>`${a.uf}/${a.name}`).join(', '));
console.log(`Aliases FAIL rules:`, summary.aliasFailRules.map(a=>`${a.uf}/${a.name}→${a.resolved}`).join(', '));

fs.writeFileSync('/tmp/audit-completo.json', JSON.stringify({
  distByUf, rulesMatrix, aliasResults, cepResults, summary,
}, null, 2));
await closeBrowser();
